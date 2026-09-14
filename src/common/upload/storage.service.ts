import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { basename, join, resolve } from 'path';

/**
 * Stockage des fichiers envoyés (photos d'annonces, avatars, logos), derrière
 * une interface interchangeable, comme ISmsProvider / IEmailProvider :
 *
 *   STORAGE_PROVIDER=local (défaut) : disque local ./uploads, servi par l'API
 *     sous /uploads/… — ÉPHÉMÈRE sur Render (perdu à chaque déploiement).
 *   STORAGE_PROVIDER=s3 : bucket S3 ou compatible (Cloudflare R2, Scaleway,
 *     OVH, MinIO…). Variables exactes : S3_ENDPOINT (ex. https://<account>.r2.cloudflarestorage.com),
 *     S3_REGION (« auto » pour R2), S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *     S3_PUBLIC_URL (URL publique du bucket, ex. https://pub-xxxx.r2.dev ou un
 *     domaine personnalisé). Les clés sont stockées sous « uploads/<uuid>.<ext> »
 *     pour que les URL publiques gardent la forme …/uploads/… (motif autorisé
 *     par next.config.ts).
 *
 * Testé en e2e contre un faux serveur S3 en mémoire (test/phase9) ; l'appel
 * réel vers R2 n'a pas pu être exécuté sans compte (voir AUDIT.md).
 */
export interface IStorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<string>; // → URL publique
  delete(url: string): Promise<void>;
}

export const UPLOAD_DIR = resolve(process.cwd(), 'uploads');

export class LocalDiskStorage implements IStorageProvider {
  readonly name = 'local';
  async put(key: string, body: Buffer): Promise<string> {
    const name = basename(key);
    const target = resolve(UPLOAD_DIR, name);
    if (!target.startsWith(UPLOAD_DIR)) throw new Error('Chemin de fichier invalide.');
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(target, body);
    return `/uploads/${name}`;
  }
  async delete(url: string): Promise<void> {
    if (!url || !url.startsWith('/uploads/')) return;
    const target = resolve(UPLOAD_DIR, basename(url));
    if (!target.startsWith(UPLOAD_DIR)) return;
    await fs.unlink(target).catch(() => undefined);
  }
}

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  forcePathStyle?: boolean;
}

export class S3Storage implements IStorageProvider {
  readonly name = 's3';
  private readonly client: S3Client;
  private readonly logger = new Logger('Storage(s3)');
  constructor(private readonly opts: S3StorageOptions) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region || 'auto',
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      forcePathStyle: opts.forcePathStyle ?? true,
    });
  }
  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
    );
    return `${this.opts.publicUrl.replace(/\/$/, '')}/${key}`;
  }
  async delete(url: string): Promise<void> {
    const base = this.opts.publicUrl.replace(/\/$/, '') + '/';
    if (!url || !url.startsWith(base)) return; // jamais de suppression hors de notre bucket
    const key = url.slice(base.length);
    if (!/^uploads\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) return;
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    } catch (e) {
      this.logger.warn(`Suppression impossible de ${key} : ${(e as Error).message}`);
    }
  }
}

let current: IStorageProvider | null = null;

/** Fournisseur courant, construit à partir de l'environnement (mémoïsé). */
export function getStorage(): IStorageProvider {
  if (current) return current;
  const provider = process.env.STORAGE_PROVIDER || 'local';
  if (provider === 's3') {
    const need = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'];
    const missing = need.filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`STORAGE_PROVIDER=s3 : variables manquantes ${missing.join(', ')}.`);
    current = new S3Storage({
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION || 'auto',
      bucket: process.env.S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      publicUrl: process.env.S3_PUBLIC_URL!,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    });
  } else {
    current = new LocalDiskStorage();
  }
  new Logger('Storage').log(`Stockage des fichiers : ${current.name}${current.name === 'local' ? ' (disque local, éphémère sur Render)' : ''}`);
  return current;
}

/** Tests uniquement : remplace le fournisseur courant. */
export function setStorageForTests(provider: IStorageProvider | null): void {
  current = provider;
}

export function publicUploadPath(name: string): string {
  return join('uploads', name).replace(/\\/g, '/');
}
