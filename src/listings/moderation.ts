/**
 * Pré-modération automatique (cahier des charges §3.8) : liste noire
 * d'objets interdits en France et de signaux d'arnaque. Une annonce qui
 * déclenche une règle n'est pas publiée immédiatement : elle passe en
 * "en_attente" avec le motif, et un administrateur décide.
 *
 * Ce n'est pas un filtre parfait (un mot dans un contexte légitime peut
 * déclencher une revue) : c'est voulu, le coût d'un faux positif est une
 * revue humaine, celui d'un faux négatif est une infraction.
 */
const RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: 'armes', pattern: /\b(arme[s]? à feu|pistolet|revolver|fusil|carabine|munition[s]?|taser|poing américain|matraque|couteau papillon|nunchaku)\b/i },
  { label: 'stupéfiants', pattern: /\b(cannabis|weed|beuh|shit|résine|cocaïne|coke|mdma|ecstasy|lsd|héroïne|champignons hallucinogènes|protoxyde|ballons d'azote)\b/i },
  { label: 'tabac / vapotage', pattern: /\b(cigarettes?|tabac à rouler|cartouches? de cigarettes|puff|e-liquide nicotin)\b/i },
  { label: 'médicaments', pattern: /\b(médicament[s]?|ordonnance|xanax|lexomil|tramadol|viagra|antibiotique[s]?|codéine|subutex)\b/i },
  { label: 'contrefaçon', pattern: /\b(contrefaçon|contrefait|réplique (?:de )?(?:sac|montre|marque)|copie (?:parfaite|conforme)|imitation (?:de marque|louis vuitton|rolex)|aaa\+?)\b/i },
  { label: 'documents officiels / identité', pattern: /\b(carte d'identité|passeport vierge|permis de conduire (?:vierge|sans examen)|faux papiers|carte vitale)\b/i },
  { label: 'espèces protégées', pattern: /\b(ivoire|corne de rhinocéros|écaille de tortue|peau de tigre|espèce protégée)\b/i },
  { label: 'contenu adulte', pattern: /\b(escort|massage (?:coquin|érotique)|sextoy|porno|xxx)\b/i },
  { label: 'services financiers', pattern: /\b(prêt (?:rapide|entre particuliers|d'argent)|crédit sans justificatif|rachat de crédit|investissement garanti|crypto[- ]?arbitrage)\b/i },
  { label: 'coordonnées dans l\'annonce', pattern: /(?:\+33|0033|\b0)[67](?:[\s.\-]?\d{2}){4}\b|\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b|https?:\/\/|www\./i },
  { label: 'animaux : chiots / chatons sans identification', pattern: /\b(chiot[s]?|chaton[s]?)\b(?![\s\S]*\b(?:i-?cad|siren|lof|loof|identifi))/i },
];

export interface ModerationResult {
  flagged: boolean;
  reasons: string[];
}

export function moderateText(...texts: Array<string | undefined>): ModerationResult {
  const corpus = texts.filter(Boolean).join('\n');
  const reasons = RULES.filter((r) => r.pattern.test(corpus)).map((r) => r.label);
  return { flagged: reasons.length > 0, reasons };
}
