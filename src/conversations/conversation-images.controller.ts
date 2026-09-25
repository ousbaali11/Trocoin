import { Controller, Get, Param, ParseUUIDPipe, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ConversationsService } from './conversations.service';
import { IMAGE_COOKIE, parseCookies, readImageCookie } from './image-access';

/**
 * AUDIT §74 : images envoyées dans une conversation — servies uniquement aux deux participants (et à l'administration),
 * identité vérifiée à CHAQUE requête : jeton de session (Authorization) ou cookie signé posé à l'ouverture de la
 * conversation (les balises <img> n'envoient pas d'en-tête). Avant : fichiers publics sous /uploads, protégés par un nom
 * imprévisible seulement. Hors quota de requêtes : une conversation charge plusieurs images d'un coup.
 */
@SkipThrottle()
@Controller('conversations')
export class ConversationImagesController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  private async identify(req: Request): Promise<string | null> {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string; purpose?: string }>(auth.slice(7));
        if (!payload.purpose && payload.sub) return payload.sub; // jamais un jeton intermédiaire de double authentification
      } catch {
        /* jeton invalide : on tente le cookie */
      }
    }
    return readImageCookie(this.config.get<string>('JWT_SECRET') || '', parseCookies(req.headers.cookie)[IMAGE_COOKIE]);
  }

  @Get(':id/images/:name')
  async serve(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Param('name') name: string, @Res() res: Response): Promise<void> {
    const viewerId = await this.identify(req);
    if (!viewerId) throw new UnauthorizedException('Connectez-vous pour voir cette image.');
    const obj = await this.conversations.serveImage(id, name, viewerId);
    // Contenu immuable pour un nom donné : un rechargement revalide en 304 (contrôle d'accès déjà rejoué ci-dessus)
    const etag = `"${name}"`;
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      obj.body.destroy();
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', obj.contentType);
    // Cache privé (navigateur du membre seulement, jamais un cache partagé) : l'image ne change jamais, le contrôle d'accès
    // est rejoué à chaque nouvelle requête
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    if (obj.contentLength) res.setHeader('Content-Length', String(obj.contentLength));
    obj.body.on('error', () => res.destroy());
    obj.body.pipe(res);
  }
}
