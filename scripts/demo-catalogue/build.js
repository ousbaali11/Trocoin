// Générateur du catalogue de démonstration (AUDIT §71) : 600 annonces déterministes à partir des archétypes,
// réparties entre 50 comptes, attributs validés contre les schémas de catégories. Sortie : src/demo-catalogue/data/.
// Usage : node scripts/demo-catalogue/build.js
const fs = require('fs');
const path = require('path');
require('ts-node/register/transpile-only');
const { getSchemaForSlugs, validateAttributes } = require('../../src/categories/category-schemas.ts');
const { moderateText } = require('../../src/listings/moderation.ts');
const { CITIES, ACCOUNTS } = require('./accounts');
const { mulberry32, hash, pick, between, roundPrice, fill, CLOSINGS } = require('./lib');

const ARCHETYPES = [...require('./archetypes-1'), ...require('./archetypes-2'), ...require('./archetypes-3')];
const TARGET = 600;
const OUT_DIR = path.join(__dirname, '..', '..', 'src', 'demo-catalogue', 'data');

const FAMILY_OF = {
  immobilier: ['ventes-immobilieres', 'locations', 'colocations', 'bureaux-commerces', 'terrains'],
  vehicules: ['voitures', 'motos', 'caravaning', 'utilitaires', 'nautisme', 'pieces-auto'],
  'materiel-professionnel': ['btp', 'agricole', 'restauration-hotellerie', 'fournitures-bureau'],
  emploi: ['offres-emploi', 'formations'],
  mode: ['vetements', 'chaussures', 'accessoires-bagagerie', 'montres-bijoux'],
  'maison-jardin': ['ameublement', 'electromenager', 'decoration', 'bricolage', 'jardinage'],
  famille: ['puericulture', 'mobilier-bebe', 'vetements-bebe'],
  multimedia: ['telephonie', 'informatique', 'consoles-jeux-video', 'image-son'],
  loisirs: ['livres', 'musique-instruments', 'sports-hobbies', 'velos', 'jeux-jouets', 'collection'],
  vacances: ['vacances'],
  services: ['demenagement', 'reparations-mecaniques', 'jardinerie-bricolage', 'services-a-la-personne', 'services-animaux', 'baby-sitting', 'artistes-musiciens', 'evenementiel', 'reparations-electroniques', 'entraide-voisins', 'billetterie', 'evenements', 'covoiturage', 'cours-particuliers', 'autres-services'],
  animaux: ['animaux-vente-don', 'accessoires-animaux', 'animaux-perdus', 'animaux-dons', 'animaux-autres'],
};
const familyOf = (slug) => Object.keys(FAMILY_OF).find((f) => FAMILY_OF[f].includes(slug)) || (FAMILY_OF[slug] ? slug : null);

/** Choix des options d'une variante : la première option « pilote » cycle avec l'index de variante, les autres sont tirées ; `pair` aligne les index. */
function choose(arch, v, rng) {
  const opts = arch.opts || {};
  const keys = Object.keys(opts);
  const idx = {};
  const pair = arch.pair || {};
  const sourceOf = (target) => { const e = Object.entries(pair).find(([, t]) => t === target); return e ? e[0].replace(/\d+$/, '') : null; };
  const offset = Math.floor(rng() * 1000);
  for (const k of keys) {
    if (sourceOf(k)) continue;
    idx[k] = keys.indexOf(k) === 0 ? (v + offset) % opts[k].length : Math.floor(rng() * opts[k].length);
  }
  let guard = 0;
  while (Object.keys(idx).length < keys.length && guard++ < 10) {
    for (const k of keys) {
      if (idx[k] !== undefined) continue;
      const src = sourceOf(k);
      if (src && idx[src] !== undefined) idx[k] = idx[src] % opts[k].length;
    }
  }
  const chosen = {};
  for (const k of keys) chosen[k] = opts[k][idx[k] ?? 0];
  return { chosen, idx };
}

const listings = [];
const errors = [];
ARCHETYPES.forEach((arch, ai) => {
  const family = familyOf(arch.slug);
  if (!family) errors.push(`${arch.slug} : famille inconnue`);
  const rootSlug = family === arch.slug ? undefined : family;
  const schema = getSchemaForSlugs(arch.slug, rootSlug);
  for (let v = 0; v < arch.n; v += 1) {
    const key = `${arch.slug}-${ai}-${v}`;
    const rng = mulberry32(hash(key));
    const { chosen, idx } = choose(arch, v, rng);
    const title = fill(arch.title, chosen).replace(/\s+/g, ' ').trim();
    let description = fill(arch.desc, chosen).replace(/\s+/g, ' ').trim();
    const closing = rng() < 0.7 ? pick(rng, CLOSINGS) : '';
    if (closing && !description.includes(closing)) description += ' ' + closing;
    const attrs = {};
    for (const [k, tpl] of Object.entries(arch.attrs || {})) {
      const val = fill(tpl, chosen);
      if (val === '' || val === undefined || val === null) continue;
      attrs[k] = val;
    }
    const { errors: attrErrors, clean } = validateAttributes(schema, attrs, { requireRequired: true });
    if (attrErrors.length) errors.push(`${key} (${title}) : ${attrErrors.join(' ; ')}`);
    const priceType = arch.priceType || 'fixe';
    let price = null;
    if (!['gratuit', 'sur_demande', 'echange'].includes(priceType)) {
      price = Array.isArray(arch.price) ? roundPrice(between(rng, arch.price[0], arch.price[1])) : arch.price;
    }
    const condition = arch.noCondition ? undefined : Array.isArray(arch.cond) ? pick(rng, arch.cond) : arch.cond;
    const [pmin, pmax] = arch.photos || [2, 4];
    const photosWanted = pmin + Math.floor(rng() * (pmax - pmin + 1));
    let queries = Array.isArray(arch.q) ? arch.q : [arch.q];
    if (arch.qByOpt) queries = [arch.q[idx[arch.qByOpt] % arch.q.length], ...(arch.qFallback || [])]; // requête propre à l'option, puis repli générique
    else if (queries.length > 1 && !arch.qFirst) queries = [pick(rng, queries), ...queries]; // qFirst : ordre figé (première requête = couverture)
    let cityKey = null;
    if (arch.city) cityKey = arch.cityByOpt ? arch.city[idx[arch.cityByOpt] % arch.city.length] : Array.isArray(arch.city) ? pick(rng, arch.city) : arch.city;
    const mod = moderateText(title, description);
    if (mod.flagged) errors.push(`${key} (${title}) : texte signalé par la modération (${mod.reasons.join(', ')})`);
    listings.push({ key, slug: arch.slug, family, title, description, price, priceType, condition, attributes: clean, photosWanted, photoQueries: [...new Set(queries)], cityKey, publishedDaysAgo: Math.floor(Math.pow(rng(), 1.6) * 45) });
  }
});

if (listings.length > TARGET) {
  // Excédent retiré dans la famille la plus fournie (dernières variantes)
  const counts = {};
  for (const l of listings) counts[l.family] = (counts[l.family] || 0) + 1;
  while (listings.length > TARGET) {
    const biggest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const i = listings.map((l) => l.family).lastIndexOf(biggest);
    listings.splice(i, 1);
    counts[biggest] -= 1;
  }
}

// Répartition entre les comptes : 10 à 15 annonces chacun (poids tirés, ajustés pour tomber juste), ordre mélangé
const rng = mulberry32(hash('affectation'));
const shuffled = [...listings].sort(() => rng() - 0.5);
const weights = ACCOUNTS.map(() => 10 + Math.floor(rng() * 6));
let diff = listings.length - weights.reduce((a, b) => a + b, 0);
for (let i = 0; diff !== 0; i = (i + 1) % weights.length) {
  if (diff > 0 && weights[i] < 15) { weights[i] += 1; diff -= 1; } else if (diff < 0 && weights[i] > 10) { weights[i] -= 1; diff += 1; }
}
let cursor = 0;
ACCOUNTS.forEach((a, i) => {
  for (let k = 0; k < weights[i] && cursor < shuffled.length; k += 1, cursor += 1) {
    const l = shuffled[cursor];
    l.sellerKey = a.key;
    const c = CITIES[l.cityKey || a.city];
    if (!c) errors.push(`${l.key} : ville inconnue ${l.cityKey || a.city}`);
    l.city = c?.city;
    l.postalCode = c?.postalCode;
    delete l.cityKey;
  }
});
listings.sort((a, b) => a.key.localeCompare(b.key));

if (errors.length) {
  console.error(`${errors.length} erreur(s) :\n- ` + errors.join('\n- '));
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'accounts.json'), JSON.stringify(ACCOUNTS.map((a) => ({ ...a, ...CITIES[a.city] })), null, 1) + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'listings.json'), JSON.stringify(listings, null, 1) + '\n');
const byFamily = {};
const bySlug = {};
for (const l of listings) { byFamily[l.family] = (byFamily[l.family] || 0) + 1; bySlug[l.slug] = (bySlug[l.slug] || 0) + 1; }
const perAccount = {};
for (const l of listings) perAccount[l.sellerKey] = (perAccount[l.sellerKey] || 0) + 1;
console.log(`${listings.length} annonces, ${ACCOUNTS.length} comptes (${Math.min(...Object.values(perAccount))} à ${Math.max(...Object.values(perAccount))} annonces chacun), ${listings.reduce((s, l) => s + l.photosWanted, 0)} photos souhaitées`);
console.log('Par famille :', JSON.stringify(byFamily));
console.log('Par sous-catégorie :', JSON.stringify(bySlug));
