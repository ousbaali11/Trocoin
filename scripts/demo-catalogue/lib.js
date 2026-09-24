// Outils du générateur de catalogue de démonstration (AUDIT §71) : aléa déterministe, substitution d'options, prix.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const between = (rng, min, max) => min + rng() * (max - min);
const capitalize = (s) => (typeof s === 'string' && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Prix réaliste : arrondi selon l'ordre de grandeur (5 000 → 50 près, 350 → 5 près, 12 → entier). */
function roundPrice(p) {
  if (p >= 5000) return Math.round(p / 50) * 50;
  if (p >= 500) return Math.round(p / 10) * 10;
  if (p >= 60) return Math.round(p / 5) * 5;
  return Math.max(1, Math.round(p));
}

/** Remplace {token} / {Token} par la valeur choisie (Token = première lettre en majuscule). */
function fill(template, chosen) {
  if (typeof template !== 'string') return template;
  const exact = template.match(/^\{(\w+)\}$/);
  if (exact) {
    const key = exact[1];
    const lower = key.charAt(0).toLowerCase() + key.slice(1);
    const v = chosen[key] ?? chosen[lower];
    if (v === undefined) return template;
    return key[0] === key[0].toUpperCase() && key[0] !== key[0].toLowerCase() ? capitalize(v) : v;
  }
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    const lower = key.charAt(0).toLowerCase() + key.slice(1);
    const v = chosen[key] ?? chosen[lower];
    if (v === undefined) return m;
    const s = String(v);
    return key[0] === key[0].toUpperCase() && key[0] !== key[0].toLowerCase() ? capitalize(s) : s;
  });
}

const CLOSINGS = [
  'Remise en main propre uniquement.',
  'Pas d\'envoi, à venir chercher sur place.',
  'Visible sur rendez-vous en semaine ou le week-end.',
  'Prix légèrement négociable pour un enlèvement rapide.',
  'Paiement à la remise, en main propre.',
  'Je réponds vite par messagerie.',
  'Photos prises ce week-end, le produit est tel que sur les images.',
  '',
  '',
];

module.exports = { mulberry32, hash, pick, between, capitalize, roundPrice, fill, CLOSINGS };
