import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { getStorage } from './storage.service';

/**
 * Relais des fichiers envoyés quand le stockage objet n'a pas d'URL publique
 * (STORAGE_PROVIDER=s3 sans S3_PUBLIC_URL) : GET /uploads/<uuid>[-min].<ext> lit l'objet
 * dans le bucket et le renvoie avec un cache long (les clés sont uniques et immuables).
 * En stockage local, les fichiers sont servis en statique avant d'arriver ici (404 sinon).
 * Hors quota de requêtes : une page de résultats charge plusieurs dizaines d'images.
 */
@SkipThrottle()
@Controller('uploads')
export class MediaController {
  @Get(':name')
  async serve(@Param('name') name: string, @Res() res: Response): Promise<void> {
    const storage = getStorage();
    const key = `uploads/${name}`;
    const obj = storage.get ? await storage.get(key) : null;
    if (!obj) throw new NotFoundException('Fichier introuvable.');
    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    if (obj.contentLength) res.setHeader('Content-Length', String(obj.contentLength));
    obj.body.on('error', () => res.destroy());
    obj.body.pipe(res);
  }
}
