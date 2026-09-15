import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Sentry, SENTRY_ENABLED } from '../../monitoring/sentry';

/**
 * Filtre global : les erreurs HTTP prévues sont renvoyées telles quelles ;
 * toute autre erreur est journalisée côté serveur et renvoyée au client
 * sous forme générique (jamais de stack trace, de chemin ni de requête SQL).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status >= 500) {
        this.logger.error(`${req.method} ${req.url} -> ${status}`, (exception as Error).stack);
      }
      // Limite de débit : message en français pour l'utilisateur (jamais le libellé technique du garde)
      if (status === 429) {
        return res.status(429).json({ statusCode: 429, message: 'Trop de tentatives en peu de temps. Patientez une minute puis réessayez.' });
      }
      return res
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);
    }

    // Erreurs multer (taille, nombre de fichiers) : message utile, pas de détail interne
    const anyErr = exception as { code?: string; message?: string; stack?: string };
    if (anyErr?.code === 'LIMIT_FILE_SIZE') {
      return res
        .status(413)
        .json({ statusCode: 413, message: 'Fichier trop volumineux (8 Mo maximum par photo).' });
    }
    if (anyErr?.code === 'LIMIT_FILE_COUNT' || anyErr?.code === 'LIMIT_UNEXPECTED_FILE') {
      return res
        .status(400)
        .json({ statusCode: 400, message: 'Trop de fichiers ou champ de fichier inattendu.' });
    }
    if (anyErr?.message?.startsWith('Origine non autorisée par CORS')) {
      return res.status(403).json({ statusCode: 403, message: 'Origine non autorisée.' });
    }

    this.logger.error(`${req.method} ${req.url} -> 500 : ${anyErr?.message}`, anyErr?.stack);
    if (SENTRY_ENABLED) Sentry.captureException(exception, { tags: { route: req.url, method: req.method } });
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Erreur interne. Réessayez plus tard.',
    });
  }
}
