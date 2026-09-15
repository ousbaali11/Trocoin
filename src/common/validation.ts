import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

/**
 * Validation des corps de requête, messages en français.
 *
 * class-validator produit par défaut des messages en anglais (« identifier must be longer than or
 * equal to 3 characters »). Les DTO qui portent un message personnalisé (déjà en français) le
 * conservent ; les autres reçoivent un message générique lisible par l'utilisateur. Le nom du champ
 * reste indiqué pour le diagnostic.
 */
const ENGLISH_DEFAULT = /\b(must|should|cannot|is not|does not|contains|each value)\b/i;

const LABELS: Record<string, string> = {
  identifier: "l'identifiant",
  password: 'le mot de passe',
  passwordConfirmation: 'la confirmation du mot de passe',
  email: "l'adresse e-mail",
  username: "le nom d'utilisateur",
  phoneNumber: 'le numéro de mobile',
  firstName: 'le prénom',
  lastName: 'le nom',
  title: 'le titre',
  description: 'la description',
  price: 'le prix',
  city: 'la ville',
  postalCode: 'le code postal',
  content: 'le message',
  reason: 'le motif',
  rating: 'la note',
  comment: 'le commentaire',
  code: 'le code',
  siret: 'le SIRET',
  companyName: 'la raison sociale',
};

function firstMessage(error: ValidationError, path = ''): string | null {
  const property = path ? `${path}.${error.property}` : error.property;
  const constraints = error.constraints ? Object.values(error.constraints) : [];
  const custom = constraints.find((m) => !ENGLISH_DEFAULT.test(m));
  if (custom) return custom;
  if (constraints.length) {
    const label = LABELS[error.property] ? LABELS[error.property] : `le champ « ${property} »`;
    const missing = constraints.some((m) => /should not be empty|must be defined|should not be null/i.test(m));
    return missing ? `Veuillez renseigner ${label}.` : `La valeur de ${label} n'est pas valide.`;
  }
  for (const child of error.children ?? []) {
    const m = firstMessage(child, property);
    if (m) return m;
  }
  return null;
}

export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => {
      const messages = errors.map((e) => firstMessage(e)).filter((m): m is string => !!m);
      return new BadRequestException(messages.length === 1 ? messages[0] : messages.length ? messages : 'Requête invalide.');
    },
  });
}

/** Traduction des messages par défaut de NestJS (routes inconnues, gardes sans message). */
export const DEFAULT_HTTP_MESSAGES: Record<string, string> = {
  Unauthorized: 'Connexion requise.',
  Forbidden: 'Accès refusé.',
  'Not Found': 'Introuvable.',
  'Bad Request': 'Requête invalide.',
  Conflict: 'Conflit avec une donnée existante.',
  'Too Many Requests': 'Trop de tentatives en peu de temps. Patientez une minute puis réessayez.',
  'Internal server error': 'Erreur interne. Réessayez plus tard.',
  'Service Unavailable': 'Service momentanément indisponible.',
  'Payload Too Large': 'Contenu trop volumineux.',
};

export function translateDefaultMessage(message: unknown): unknown {
  if (typeof message !== 'string') return message;
  if (DEFAULT_HTTP_MESSAGES[message]) return DEFAULT_HTTP_MESSAGES[message];
  if (/^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(message)) return 'Cette adresse n\'existe pas.';
  return message;
}
