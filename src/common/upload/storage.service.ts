import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { basename, join, resolve } from 'path';
import type { Readable } from 'stream';

/**
 * Stockage des fichiers envoyés (photos d'annonces, avatars, logos), derrière
 * une interface interchangeable, comme ISmsProvider / IEmailProvider :
 *
 *   STORAGE_PROVIDER=local (défaut) : disque local ./uploads, servi par l'API
 *     sous /uploads/… — ÉPHÉMÈRE sur Render (perdu à chaque déploiement).
 *   STORAGE_PROVIDER=s3 : bucket S3 ou compatible (Cloudflare R2, Scaleway,
 *     OVH, MinIO…). Variables exactes : S3_ENDPOINT (ex. https://<account>.r2.cloudflarestorage.com),
 *     S3_REGION (« auto » pour R2), S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
 *     S3_PUBLIC_URL (facultative) : URL publique du bucket (ex. https://pub-xxxx.r2.dev ou
 *     un domaine personnalisé) → les URL stockées sont absolues et le navigateur charge
 *     les images directement depuis le CDN. Sans elle, les URL restent relatives
 *     (/uploads/<uuid>.<ext>) et l'API relaie l'objet depuis le bucket (MediaController),
 *     avec un cache long : aucune configuration d'accès public n'est nécessaire côté bucket.
 *     Les clés sont stockées sous « uploads/<uuid>.<ext> » (et « uploads/<uuid>-min.<ext> »
 *     pour les vignettes) pour que les URL gardent la forme …/uploads/… (motif autorisé
 *     par next.config.ts).
 *
 * Testé en e2e contre un faux serveur S3 en mémoire (test/phase9) et, le 14 septembre 2026,
 * contre le bucket Cloudflare R2 réel (AUDIT.md §15).
 */
export interface StoredObject {
  body: Readable;
  contentType: string;
  contentLength?: number;
}

export interface IStorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<string>; // → URL (absolue ou relative /uploads/…)
  delete(url: string): Promise<void>;
  /** Lecture d'un objet par sa clé (relais par l'API) ; absent pour le disque local, servi en statique. */
  get?(key: string): Promise<StoredObject | null>;
}

export const UPLOAD_DIR = resolve(process.cwd(), 'uploads');
/** Clés autorisées : photo ré-encodée ou sa vignette « -min », nommées par UUID. */
export const UPLOAD_KEY_PATTERN = /^uploads\/[0-9a-f-]{36}(-min)?\.(jpg|png|webp)$/;
/**
 * AUDIT §74 : images de conversation — jamais servies en statique ni par une URL publique du bucket. Sur disque : dossier
 * `uploads-prives` (hors du dossier statique) ; sur S3 : bucket `S3_PRIVATE_BUCKET` s'il est défini, sinon le préfixe
 * `private/` du bucket courant (à ne pas exposer publiquement). Lecture uniquement par la route contrôlée.
 */
export const PRIVATE_DIR = resolve(process.cwd(), 'uploads-prives');
export const PRIVATE_KEY_PATTERN = /^private\/conversations\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
export const isPrivateKey = (key: string): boolean => PRIVATE_KEY_PATTERN.test(key);
const CONTENT_TYPE_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export const privateConversationKey = (name: string): string => `private/conversations/${name}`;

export class LocalDiskStorage implements IStorageProvider {
  readonly name = 'local';
  async put(key: string, body: Buffer): Promise<string> {
    const name = basename(key);
    if (isPrivateKey(key)) {
      const target = resolve(PRIVATE_DIR, name);
      if (!target.startsWith(PRIVATE_DIR)) throw new Error('Chemin de fichier invalide.');
      await fs.mkdir(PRIVATE_DIR, { recursive: true });
      await fs.writeFile(target, body);
      return key; // clé, jamais une URL : seule la route contrôlée sait la lire
    }
    const target = resolve(UPLOAD_DIR, name);
    if (!target.startsWith(UPLOAD_DIR)) throw new Error('Chemin de fichier invalide.');
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(target, body);
    return `/uploads/${name}`;
  }
  async delete(url: string): Promise<void> {
    if (!url) return;
    if (isPrivateKey(url)) {
      const target = resolve(PRIVATE_DIR, basename(url));
      if (target.startsWith(PRIVATE_DIR)) await fs.unlink(target).catch(() => undefined);
      return;
    }
    if (!url.startsWith('/uploads/')) return;
    const target = resolve(UPLOAD_DIR, basename(url));
    if (!target.startsWith(UPLOAD_DIR)) return;
    await fs.unlink(target).catch(() => undefined);
  }
  /** Lecture d'un objet (images privées ; aussi les envois publics, pour les migrations). */
  async get(key: string): Promise<StoredObject | null> {
    const priv = isPrivateKey(key);
    if (!priv && !UPLOAD_KEY_PATTERN.test(key)) return null;
    const target = resolve(priv ? PRIVATE_DIR : UPLOAD_DIR, basename(key));
    if (!target.startsWith(priv ? PRIVATE_DIR : UPLOAD_DIR)) return null;
    let size: number;
    try {
      size = (await fs.stat(target)).size;
    } catch {
      return null;
    }
    const { createReadStream } = await import('fs');
    return { body: createReadStream(target), contentType: CONTENT_TYPE_BY_EXT[key.split('.').pop() || ''] || 'application/octet-stream', contentLength: size };
  }
}

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** URL publique du bucket ; absente → URL relatives relayées par l'API. */
  publicUrl?: string;
  /** AUDIT §74 : bucket privé des images de conversation (sinon préfixe private/ du bucket courant). */
  privateBucket?: string;
  forcePathStyle?: boolean;
}

export class S3Storage implements IStorageProvider {
  readonly name = 's3';
  private readonly client: S3Client;
  private readonly logger = new Logger('Storage(s3)');
  private readonly publicBase: string | null;
  constructor(private readonly opts: S3StorageOptions) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region || 'auto',
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      forcePathStyle: opts.forcePathStyle ?? true,
    });
    this.publicBase = opts.publicUrl ? opts.publicUrl.replace(/\/$/, '') : null;
  }

  private bucketFor(key: string): string {
    return isPrivateKey(key) ? this.opts.privateBucket || this.opts.bucket : this.opts.bucket;
  }
  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    const priv = isPrivateKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucketFor(key), Key: key, Body: body, ContentType: contentType, CacheControl: priv ? 'private, max-age=0' : 'public, max-age=31536000, immutable' }),
    );
    if (priv) return key; // clé, jamais une URL publique
    return this.publicBase ? `${this.publicBase}/${key}` : `/${key}`;
  }

  /** Clé d'objet correspondant à une URL produite par `put` (absolue ou relative) ; null si elle n'est pas à nous. */
  keyFor(url: string): string | null {
    if (!url) return null;
    if (isPrivateKey(url)) return url;
    let key: string | null = null;
    if (this.publicBase && url.startsWith(this.publicBase + '/')) key = url.slice(this.publicBase.length + 1);
    else if (url.startsWith('/uploads/')) key = url.slice(1);
    return key && UPLOAD_KEY_PATTERN.test(key) ? key : null;
  }

  async delete(url: string): Promise<void> {
    const key = this.keyFor(url);
    if (!key) return; // jamais de suppression hors de notre bucket
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketFor(key), Key: key }));
    } catch (e) {
      this.logger.warn(`Suppression impossible de ${key} : ${(e as Error).message}`);
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    if (!UPLOAD_KEY_PATTERN.test(key) && !isPrivateKey(key)) return null;
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucketFor(key), Key: key }));
      if (!out.Body) return null;
      return { body: out.Body as Readable, contentType: out.ContentType || 'application/octet-stream', contentLength: out.ContentLength };
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound' || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
}

let current: IStorageProvider | null = null;

/** Fournisseur courant, construit à partir de l'environnement (mémoïsé). */
export function getStorage(): IStorageProvider {
  if (current) return current;
  const provider = process.env.STORAGE_PROVIDER || 'local';
  if (provider === 's3') {
    const need = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
    const missing = need.filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`STORAGE_PROVIDER=s3 : variables manquantes ${missing.join(', ')}.`);
    current = new S3Storage({
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION || 'auto',
      bucket: process.env.S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      publicUrl: process.env.S3_PUBLIC_URL || undefined,
      privateBucket: process.env.S3_PRIVATE_BUCKET || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    });
    // AUDIT §74 : avec une URL publique de bucket, les images de conversation doivent avoir leur propre bucket privé
    if (process.env.S3_PUBLIC_URL && !process.env.S3_PRIVATE_BUCKET) {
      new Logger('Storage(s3)').warn("S3_PUBLIC_URL défini sans S3_PRIVATE_BUCKET : le préfixe private/ des images de conversation est lisible par l'URL publique du bucket. Créez un bucket privé et renseignez S3_PRIVATE_BUCKET.");
    }
  } else {
    current = new LocalDiskStorage();
  }
  const detail = current.name === 'local' ? ' (disque local, éphémère sur Render)' : process.env.S3_PUBLIC_URL ? ` (bucket ${process.env.S3_BUCKET}, URL publiques ${process.env.S3_PUBLIC_URL})` : ` (bucket ${process.env.S3_BUCKET}, relais /uploads/… par l'API)`;
  new Logger('Storage').log(`Stockage des fichiers : ${current.name}${detail}`);
  return current;
}

/** Tests uniquement : remplace le fournisseur courant. */
export function setStorageForTests(provider: IStorageProvider | null): void {
  current = provider;
}

/** AUDIT §74 : ce que /health dit du stockage (jamais de clé ni d'URL) — pour vérifier depuis l'extérieur que les images privées ont un bucket dédié. */
export function storageInfo(): { provider: string; publicBase: boolean; privateBucket: boolean } {
  const provider = process.env.STORAGE_PROVIDER || 'local';
  return { provider, publicBase: provider === 's3' && !!process.env.S3_PUBLIC_URL, privateBucket: provider === 's3' && !!process.env.S3_PRIVATE_BUCKET };
}

export function publicUploadPath(name: string): string {
  return join('uploads', name).replace(/\\/g, '/');
}
