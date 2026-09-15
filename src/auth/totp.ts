import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Mots de passe à usage unique basés sur le temps (TOTP, RFC 6238) : HMAC-SHA1, 6 chiffres,
 * pas de 30 secondes — le format lu par Google Authenticator, Aegis, Authy, 1Password…
 * Implémentation locale (Node crypto), sans dépendance.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secret aléatoire de 20 octets (160 bits), encodé en base32 pour le QR code. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

/** Code à 6 chiffres pour un pas de temps donné (par défaut : maintenant). */
export function totpCode(secret: string, step = totpStep()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * Vérifie un code en tolérant un pas avant / après (dérive d'horloge du téléphone).
 * Renvoie le pas de temps qui a validé le code (à mémoriser pour refuser un rejeu), ou null.
 */
export function verifyTotp(secret: string, code: string, { now = Date.now(), window = 1, notBeforeStep }: { now?: number; window?: number; notBeforeStep?: number | null } = {}): number | null {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const current = totpStep(now);
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    if (notBeforeStep !== undefined && notBeforeStep !== null && step <= notBeforeStep) continue;
    const expected = totpCode(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) return step;
  }
  return null;
}

/** URI otpauth:// lue par les applications d'authentification (QR code). */
export function otpauthUrl(secret: string, accountLabel: string, issuer = 'Trocoin'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** Codes de récupération lisibles : 8 codes de 10 caractères (xxxxx-xxxxx), sans caractères ambigus. */
export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    codes.push(`${chars.slice(0, 5)}-${chars.slice(5)}`);
  }
  return codes;
}

/** Forme canonique d'un code de récupération saisi (minuscules, sans espaces ni tiret). */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}
