import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { diskStorage } from 'multer';
import { basename, resolve } from 'path';
import sharp from 'sharp';
import { getStorage, privateConversationKey, publicUploadPath, UPLOAD_DIR } from './storage.service';

export { UPLOAD_DIR } from './storage.service';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 Mo
/** Plus grand côté conservé après redimensionnement (les originaux ne sont jamais servis). */
export const MAX_IMAGE_SIDE = 1600;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

/**
 * Réception multer : le fichier brut est écrit temporairement dans UPLOAD_DIR
 * sous un UUID + « .tmp », puis analysé, ré-encodé et envoyé au stockage
 * (disque local ou S3/R2). Le fichier temporaire est toujours supprimé.
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
 * Redimensionne (≤ 1600 px, jamais agrandi), applique l'orientation EXIF puis
 * renvoie une image SANS métadonnées, dans le format d'origine (JPEG 82 %,
 * PNG compressé, WEBP 82 %). Une image illisible (fichier corrompu, bombe de
 * décompression) est rejetée.
 */
export const THUMB_SIDE = 480;

export async function processImage(src: string | Buffer, ext: 'jpg' | 'png' | 'webp', maxSide = MAX_IMAGE_SIDE): Promise<Buffer> {
  let pipeline = sharp(src, { failOn: 'error', limitInputPixels: 50_000_000 })
    .rotate() // applique l'orientation EXIF avant de la supprimer
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  const thumb = maxSide < MAX_IMAGE_SIDE;
  if (ext === 'jpg') pipeline = pipeline.jpeg({ quality: thumb ? 74 : 82, mozjpeg: true });
  else if (ext === 'png') pipeline = pipeline.png({ compressionLevel: 9, palette: false });
  else pipeline = pipeline.webp({ quality: thumb ? 74 : 82 });
  try {
    return await pipeline.toBuffer(); // pas de .withMetadata() : EXIF/GPS/ICC/XMP purgés
  } catch {
    throw new BadRequestException("Image illisible ou corrompue : réessayez avec un autre fichier.");
  }
}

/**
 * Vérifie la signature binaire de chaque fichier reçu, le ré-encode, l'envoie
 * au stockage courant et renvoie les URL publiques. Tout fichier non conforme
 * entraîne le rejet de la requête et la suppression de ce qui a déjà été stocké.
 */
export async function finalizeUploadedImages(
  files: Array<{ path: string; filename: string }>,
): Promise<string[]> {
  return (await finalizeUploadedImagesWithThumbs(files, false)).map((r) => r.url);
}

/**
 * Variante pour les photos d'annonce : produit aussi une vignette (480 px, même format)
 * utilisée par les listes et les miniatures, pour ne pas charger l'original dans les grilles.
 */
export async function finalizeUploadedImagesWithThumbs(
  files: Array<{ path: string; filename: string }>,
  withThumbs = true,
): Promise<Array<{ url: string; thumbUrl: string | null }>> {
  const storage = getStorage();
  const urls: string[] = [];
  const out: Array<{ url: string; thumbUrl: string | null }> = [];
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
      if (!ext) throw new BadRequestException("Le fichier envoyé n'est pas une image JPEG, PNG ou WEBP valide.");

      const processed = await processImage(safePath, ext);
      const base = basename(file.filename, '.tmp');
      const url = await storage.put(publicUploadPath(`${base}.${ext}`), processed, CONTENT_TYPES[ext]);
      urls.push(url);
      let thumbUrl: string | null = null;
      if (withThumbs) {
        const thumb = await processImage(processed, ext, THUMB_SIDE);
        thumbUrl = await storage.put(publicUploadPath(`${base}-min.${ext}`), thumb, CONTENT_TYPES[ext]);
        urls.push(thumbUrl);
      }
      out.push({ url, thumbUrl });
    }
    return out;
  } catch (err) {
    await Promise.all(urls.map((u) => storage.delete(u).catch(() => undefined)));
    throw err;
  } finally {
    await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => undefined)));
  }
}

/**
 * AUDIT §74 : images de conversation — ré-encodées comme les autres, mais rangées dans l'espace privé
 * (`private/conversations/<uuid>.<ext>`) : la valeur renvoyée est la CLÉ, servie uniquement par la route contrôlée.
 */
export async function finalizePrivateConversationImages(files: Array<{ path: string; filename: string }>): Promise<string[]> {
  const storage = getStorage();
  const keys: string[] = [];
  try {
    for (const file of files) {
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
      if (!ext) throw new BadRequestException("Le fichier envoyé n'est pas une image JPEG, PNG ou WEBP valide.");
      const processed = await processImage(safePath, ext);
      const base = basename(file.filename, '.tmp');
      keys.push(await storage.put(privateConversationKey(`${base}.${ext}`), processed, CONTENT_TYPES[ext]));
    }
    return keys;
  } catch (err) {
    await Promise.all(keys.map((k) => storage.delete(k).catch(() => undefined)));
    throw err;
  } finally {
    await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => undefined)));
  }
}

/** Supprime un fichier stocké à partir de son URL publique (/uploads/… ou URL S3 de notre bucket). */
export async function deleteUploadedFile(url: string | undefined | null): Promise<void> {
  if (!url) return;
  await getStorage().delete(url).catch(() => undefined);
}
