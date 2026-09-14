import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isProduction } from '../config/env.validation';

/**
 * Envoi d'e-mails transactionnels (réinitialisation de mot de passe), sur le
 * même modèle que ISmsProvider / IPaymentProvider : fournisseur interchangeable.
 *
 *   EMAIL_PROVIDER=mock   : rien n'est envoyé, le lien est journalisé et exposé
 *                           en dev via GET /dev/last-reset-link/:email (jamais en production).
 *   EMAIL_PROVIDER=none   : aucun envoi possible → « mot de passe oublié » répond 503
 *                           avec un message clair (autorisé en production le temps
 *                           de brancher un fournisseur ; l'admin peut réinitialiser).
 *   EMAIL_PROVIDER=resend : RESEND_API_KEY + EMAIL_FROM requis — appel HTTP réel (POST /emails de
 *                           api.resend.com), testé le 14 septembre 2026 avec un envoi réel (AUDIT.md §15).
 *                           RESEND_API_URL (tests) permet de viser un faux serveur.
 *   EMAIL_PROVIDER=brevo  : BREVO_API_KEY + EMAIL_FROM requis — appel HTTP NON implémenté (aucune clé
 *                           pour le tester) : chaque envoi répond 503. Le démarrage vérifie les clés.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface IEmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor(public readonly provider: string, public readonly reason: string) {
    super(`E-mail non envoyé (${provider}) : ${reason}`);
  }
}

class MockEmailProvider implements IEmailProvider {
  private readonly logger = new Logger('Email(mock)');
  async send(m: EmailMessage): Promise<void> {
    if (process.env.EMAIL_MOCK_FAIL === 'true') throw new EmailDeliveryError('mock', 'panne simulée');
    this.logger.log(`--> ${m.to} · ${m.subject}\n${m.text}`);
  }
}

/** Resend (https://resend.com) : POST https://api.resend.com/emails, jeton Bearer. */
export class ResendEmailProvider implements IEmailProvider {
  private readonly logger = new Logger('Email(resend)');
  lastMessageId: string | null = null;
  constructor(private readonly apiKey: string, private readonly from: string, private readonly apiUrl = process.env.RESEND_API_URL || 'https://api.resend.com') {}
  async send(m: EmailMessage): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.apiUrl.replace(/\/$/, '')}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
      });
    } catch (err) {
      throw new EmailDeliveryError('resend', `réseau : ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
    if (!res.ok) throw new EmailDeliveryError('resend', `HTTP ${res.status} ${[body.name, body.message].filter(Boolean).join(' : ')}`.trim());
    this.lastMessageId = body.id ?? null;
    this.logger.log(`Envoyé à ${m.to.replace(/^(.{2}).*(@.*)$/, '$1…$2')} (id ${body.id ?? '?'})`);
  }
}

class UnconfiguredEmailProvider implements IEmailProvider {
  constructor(private name: string) {}
  async send(): Promise<void> {
    throw new EmailDeliveryError(this.name, 'fournisseur non implémenté / identifiants absents');
  }
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger('Email');
  private readonly provider: IEmailProvider | null;
  readonly providerName: string;
  private readonly isMock: boolean;
  private lastResetLinksForDev = new Map<string, string>();

  constructor(private config: ConfigService) {
    // Défaut : mock hors production, none en production (jamais de mock en prod, et pas de panne au déploiement si la variable manque)
    this.providerName = this.config.get<string>('EMAIL_PROVIDER') || (isProduction() ? 'none' : 'mock');
    this.isMock = this.providerName === 'mock' && !isProduction();
    if (this.isMock) this.provider = new MockEmailProvider();
    else if (this.providerName === 'none' || this.providerName === 'mock') this.provider = null;
    else if (this.providerName === 'resend') this.provider = new ResendEmailProvider(this.config.get<string>('RESEND_API_KEY')!, this.config.get<string>('EMAIL_FROM')!);
    else this.provider = new UnconfiguredEmailProvider(this.providerName);
    this.logger.log(`Fournisseur e-mail : ${this.providerName}${this.provider ? '' : ' (aucun envoi possible)'}`);
  }

  /** Vrai si un envoi est possible (mock hors production, ou fournisseur réel). */
  get available(): boolean {
    return this.provider !== null;
  }

  /** Lien public du site pour les e-mails (SITE_URL, sinon première origine CORS, sinon le front local). */
  siteUrl(): string {
    const explicit = this.config.get<string>('SITE_URL');
    if (explicit) return explicit.replace(/\/$/, '');
    const cors = (this.config.get<string>('CORS_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean);
    return (cors[0] || 'http://localhost:3001').replace(/\/$/, '');
  }

  async sendPasswordReset(to: string, link: string, displayName: string): Promise<void> {
    if (!this.provider) {
      throw new ServiceUnavailableException(
        "La réinitialisation par e-mail n'est pas encore disponible. Contactez le support pour recevoir un mot de passe temporaire.",
      );
    }
    const subject = 'Trocoin — réinitialisation de votre mot de passe';
    const text = `Bonjour ${displayName},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.\n\nL'équipe Trocoin`;
    const html = `<p>Bonjour ${escapeHtml(displayName)},</p><p>Pour choisir un nouveau mot de passe, cliquez sur ce lien (valable 1 heure) :</p><p><a href="${link}">${link}</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.</p><p>L'équipe Trocoin</p>`;
    try {
      await withTimeout(this.provider.send({ to, subject, text, html }), 10_000);
    } catch (err) {
      const reason = err instanceof EmailDeliveryError ? err.reason : (err as Error).message;
      this.logger.error(`Envoi e-mail impossible vers ${to.replace(/^(.{2}).*(@.*)$/, '$1…$2')} via ${this.providerName} : ${reason}`);
      throw new ServiceUnavailableException("L'envoi de l'e-mail a échoué. Réessayez dans quelques instants.");
    }
    // Hors production, le dernier lien reste consultable via GET /dev/last-reset-link/:email (module dev
    // absent en production) : permet de vérifier un envoi réel de bout en bout sans lire la boîte mail.
    if (!isProduction()) this.lastResetLinksForDev.set(to.toLowerCase(), link);
  }

  getLastResetLinkForDev(email: string): string | undefined {
    if (isProduction()) return undefined;
    return this.lastResetLinksForDev.get(email.toLowerCase());
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new EmailDeliveryError('timeout', `aucune réponse en ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
