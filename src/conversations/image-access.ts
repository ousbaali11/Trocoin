import { createHmac, timingSafeEqual } from 'crypto';

/**
 * AUDIT §74 : identité du visiteur pour les images de conversation. Une balise <img> n'envoie pas d'en-tête
 * Authorization ; l'API pose donc, à l'ouverture d'une conversation, un cookie HttpOnly signé (membre + expiration)
 * que le navigateur renvoie sur chaque requête d'image (même site : www.trocoin.fr → api.trocoin.fr). La route vérifie
 * ensuite, à chaque requête, que ce membre participe à la conversation (ou est administrateur) et que le fichier lui
 * appartient bien. Un lien copié ne sert à rien sans ce cookie ou un jeton de session.
 */
export const IMAGE_COOKIE = 'trocoin_img';
export const IMAGE_COOKIE_TTL_S = 24 * 3600;

const sign = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function issueImageCookie(secret: string, userId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + IMAGE_COOKIE_TTL_S;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** Membre désigné par le cookie, ou null (absent, altéré, expiré). */
export function readImageCookie(secret: string, value: string | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [userId, expText, sig] = parts;
  const exp = Number(expText);
  if (!/^[0-9a-f-]{36}$/.test(userId) || !Number.isFinite(exp) || exp * 1000 < now) return null;
  const expected = sign(secret, `${userId}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}

/** Lecture minimale de l'en-tête Cookie (pas de dépendance cookie-parser). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
