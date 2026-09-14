import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { diskStorage } from 'multer';
import { basename, join, resolve } from 'path';
import sharp from 'sharp';

export const UPLOAD_DIR = resolve(process.cwd(), 'uploads');
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 Mo
/** Plus grand côté conservé après redimensionnement (les originaux ne sont jamais servis). */
export const MAX_IMAGE_SIDE = 1600;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Stockage multer commun : le nom de fichier est toujours un UUID généré
 * côté serveur, SANS extension pour l'instant. L'extension définitive est
 * déterminée après écriture, à partir du contenu réel (signature binaire),
 * jamais à partir du nom ou du type MIME envoyés par le client.
 */
export const imageDiskStorage = diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, _file, cb) => cb(null, `${randomUUID()}.tmp`),
});

export function imageFileFilter(
  _req: unknown,
  file: { mimetype: string },
  cb: (err: Error | null, accept: boolean) => void,
) {
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    return cb(new BadRequestException('Formats acceptés : JPEG, PNG, WEBP.'), false);
  }
  cb(null, true);
}

/** Détecte le type réel d'une image via ses premiers octets. */
export function sniffImageExtension(head: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
  if (
    head.length >= 8 &&
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  ) return 'png';
  if (
    head.length >= 12 &&
    head.toString('ascii', 0, 4) === 'RIFF' &&
    head.toString('ascii', 8, 12) === 'WEBP'
  ) return 'webp';
  return null;
}

/**
 * Vérifie la signature binaire de chaque fichier reçu, le renomme avec
 * l'extension correspondant à son contenu réel, et renvoie les URLs publiques.
 * Tout fichier non conforme est supprimé et la requête rejetée.
 */
export async function finalizeUploadedImages(
  files: Array<{ path: string; filename: string }>,
): Promise<string[]> {
  const urls: string[] = [];
  const kept: string[] = [];
  try {
    for (const file of files) {
      // Défense en profondeur : le chemin doit rester dans UPLOAD_DIR
      const safePath = resolve(UPLOAD_DIR, basename(file.path));
      if (!safePath.startsWith(UPLOAD_DIR)) throw new BadRequestException('Chemin de fichier invalide.');

      const handle = await fs.open(safePath, 'r');
      const head = Buffer.alloc(16);
      try {
        await handle.read(head, 0, 16, 0);
      } finally {
        await handle.close();
      }
      const ext = sniffImageExtension(head);
      if (!ext) throw new BadRequestException('Le fichier envoyé n\'est pas une image JPEG, PNG ou WEBP valide.');

      const finalName = `${basename(file.filename, '.tmp')}.${ext}`;
      const finalPath = join(UPLOAD_DIR, finalName);
      // Ré-encodage systématique : orientation appliquée puis TOUTES les métadonnées
      // supprimées (EXIF, GPS, profils, commentaires), côté max 1600 px, poids maîtrisé.
      // Le fichier envoyé par l'utilisateur n'est jamais servi tel quel.
      await processImage(safePath, finalPath, ext);
      await fs.unlink(safePath).catch(() => undefined);
      kept.push(finalName);
      urls.push(`/uploads/${finalName}`);
    }
    return urls;
  } catch (err) {
    await Promise.all([
      ...files.map((f) => fs.unlink(f.path).catch(() => undefined)),
      ...kept.map((n) => fs.unlink(join(UPLOAD_DIR, n)).catch(() => undefined)),
    ]);
    throw err;
  }
}

/**
 * Redimensionne (≤ 1600 px, jamais agrandi), applique l'orientation EXIF puis
 * écrit une image SANS métadonnées, dans le format d'origine (JPEG 82 %,
 * PNG compressé, WEBP 82 %). Une image illisible (fichier corrompu, bombe de
 * décompression) est rejetée.
 */
export async function processImage(src: string, dest: string, ext: 'jpg' | 'png' | 'webp'): Promise<void> {
  let pipeline = sharp(src, { failOn: 'error', limitInputPixels: 50_000_000 })
    .rotate() // applique l'orientation EXIF avant de la supprimer
    .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true });
  if (ext === 'jpg') pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
  else if (ext === 'png') pipeline = pipeline.png({ compressionLevel: 9, palette: false });
  else pipeline = pipeline.webp({ quality: 82 });
  try {
    await pipeline.toFile(dest); // pas de .withMetadata() : EXIF/GPS/ICC/XMP purgés
  } catch {
    throw new BadRequestException("Image illisible ou corrompue : réessayez avec un autre fichier.");
  }
}

/** Supprime physiquement un fichier uploadé à partir de son URL publique (/uploads/xxx.jpg). */
export async function deleteUploadedFile(url: string | undefined | null): Promise<void> {
  if (!url || !url.startsWith('/uploads/')) return;
  const name = basename(url);
  const target = resolve(UPLOAD_DIR, name);
  if (!target.startsWith(UPLOAD_DIR)) return;
  await fs.unlink(target).catch(() => undefined);
}
