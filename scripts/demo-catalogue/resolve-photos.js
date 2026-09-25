// Résolution des photos du catalogue de démonstration (AUDIT §71) : pour chaque annonce, 2 à 5 photos libres de droits à
// usage commercial, jamais réutilisées d'une annonce à l'autre, avec source, auteur, licence et page d'origine consignés.
// Sources : Pexels (licence Pexels, clé d'API dans private/pexels.key ou PEXELS_API_KEY) puis, à défaut, Wikimedia Commons
// (fichiers CC0 : données structurées P275 = Q6938433). Cache dans private/demo-catalogue-photo-cache.json.
// Usage : node scripts/demo-catalogue/resolve-photos.js [--only key1,key2] [--source pexels|commons] [--dry]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'src', 'demo-catalogue', 'data');
const PRIVATE = path.join(ROOT, 'private');
const CACHE_FILE = path.join(PRIVATE, 'demo-catalogue-photo-cache.json');
const OUT_FILE = path.join(DATA, 'photos.json');
const UA = 'Trocoin-demo-catalogue/1.0 (https://www.trocoin.fr)';
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : [])).filter((x) => x.length));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const listings = JSON.parse(fs.readFileSync(path.join(DATA, 'listings.json'), 'utf8'));
const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : { pexels: {}, commons: {} };
const saveCache = () => { fs.mkdirSync(PRIVATE, { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); };
const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : {};
const pexelsKey = process.env.PEXELS_API_KEY || (fs.existsSync(path.join(PRIVATE, 'pexels.key')) ? fs.readFileSync(path.join(PRIVATE, 'pexels.key'), 'utf8').trim() : '');
const sourcePref = args.source || (pexelsKey ? 'pexels' : 'commons');

async function pexels(q) {
  if (cache.pexels[q]) return cache.pexels[q];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=40&locale=en-US`;
  const res = await fetch(url, { headers: { Authorization: pexelsKey, 'User-Agent': UA } });
  if (res.status === 429) { console.log('  pexels 429 → attente 60 s'); await sleep(60_000); return pexels(q); }
  if (!res.ok) { console.log('  pexels', res.status, (await res.text()).slice(0, 100)); return []; }
  const j = await res.json();
  cache.pexels[q] = (j.photos || []).filter((p) => p.width >= 900 && p.height >= 600).map((p) => ({
    id: `pexels:${p.id}`, url: p.src.large2x || p.src.large, width: p.width, height: p.height, author: p.photographer, authorUrl: p.photographer_url, landing: p.url, source: 'pexels', license: 'Pexels License (usage commercial, sans attribution requise)', alt: p.alt || '',
  }));
  saveCache();
  await sleep(1_100);
  return cache.pexels[q];
}

const STOP = new Set(['car','street','living','room','home','set','with','and','the','for','city','photo','image','modern','bright','interior','exterior','table','desk','outdoor','wall','pair','floor','vintage','france','french']);
// Pénalités (Pexels) : photo d'objet ancien, monochrome, logo ou marque en gros plan, ou marque automobile absente de la
// requête (une Fiat 500 pour une « citadine » Citroën) — sauf si la requête le demande (« vintage wall clock »).
const OLD = /\b(vintage|old|antique|classic|retro|monochrome|black and white|rusty|weathered|logo|emblem|branding|nostalgi\w*|rally|racing|race|drift\w*|motorsport|cosplay\w*|costume|sign|dolls?|pupp\w*|dog)\b/i;
const BRANDS = /\b(fiat|volkswagen|vw|bmw|audi|mercedes|toyota|renault|peugeot|citro[eë]n|ford|opel|honda|tesla|dacia|hyundai|kia|skoda|nissan|mazda|volvo|porsche|ferrari|lamborghini|jeep|jaguar|lexus|suzuki|subaru|chevrolet|dodge|smart|daihatsu|triumph|kawasaki|yamaha|ktm|ducati|vespa|piaggio|beetle)\b/gi;
const score = (q, alt) => {
  const ql = fold(q); const a = fold(alt || '');
  let s = relevant(q, a) ? 2 : 0;
  const old = a.match(OLD); if (old && !old.some((w) => ql.includes(w.toLowerCase()))) s -= 3;
  const brands = a.match(BRANDS) || []; if (brands.some((b) => !ql.includes(b.toLowerCase()))) s -= 3;
  return s;
};
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // « Citroën » ≡ « Citroen »
const relevant = (q, title) => { const t = fold(title); const words = fold(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)); return words.length === 0 || words.some((w) => t.includes(w)); };
async function commons(q) {
  if (cache.commons[q]) return cache.commons[q];
  const search = `${q} filetype:bitmap haswbstatement:P275=Q6938433`;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(search)}&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600&iiextmetadatafilter=LicenseShortName|Artist`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) { console.log('  commons', res.status); return []; }
  const j = await res.json().catch(() => ({}));
  const out = [];
  for (const p of Object.values(j.query?.pages || {})) {
    const ii = p.imageinfo?.[0];
    if (!ii || ii.width < 800 || ii.height < 500 || ii.width / ii.height < 0.6 || ii.width / ii.height > 2.2) continue;
    if (!/\.(jpe?g|png)$/i.test(p.title)) continue;
    const m = ii.extmetadata || {};
    out.push({ id: `commons:${p.pageid}`, url: ii.thumburl || ii.url, width: ii.width, height: ii.height, author: (m.Artist?.value || '').replace(/<[^>]+>/g, '').slice(0, 80), landing: ii.descriptionurl, source: 'wikimedia-commons', license: m.LicenseShortName?.value || 'CC0', alt: p.title.replace(/^File:/, '') });
  }
  cache.commons[q] = out;
  saveCache();
  await sleep(700);
  return out;
}

(async () => {
  const only = args.only ? new Set(args.only.split(',')) : null;
  const used = new Set(args.force ? [] : Object.values(existing).flat().map((p) => p.id));
  const out = args.force ? {} : { ...existing };
  let resolved = 0; let short = 0; let none = 0;
  for (const l of listings) {
    if (only && !only.has(l.key)) continue;
    if (!only && !args.force && existing[l.key] && existing[l.key].length >= 2) continue;
    const wanted = l.photosWanted;
    const picked = [];
    // --source pexels : Pexels seul (pas de repli Commons, dont les images se sont révélées hors sujet — AUDIT §71)
    const sources = sourcePref === 'commons' ? ['commons'] : args.source === 'pexels' ? ['pexels'] : pexelsKey ? ['pexels', 'commons'] : ['commons'];
    for (const src of sources) {
      for (const q of l.photoQueries) {
        // Pexels : les photos dont le texte alternatif cite un mot significatif de la requête passent en premier (la
        // photo de couverture est la première retenue) ; les autres restent disponibles ensuite pour ne pas perdre de couverture
        const cands = src === 'pexels' ? (await pexels(q)).slice().sort((a, b) => score(q, b.alt) - score(q, a.alt)) : (await commons(q)).filter((c) => relevant(q, c.alt || ''));
        for (const c of cands) {
          if (picked.length >= wanted) break;
          if (used.has(c.id)) continue;
          picked.push(c);
          used.add(c.id);
        }
        if (picked.length >= wanted) break;
      }
      if (picked.length >= Math.min(2, wanted)) break;
    }
    if (picked.length === 0) { none += 1; console.log(`× ${l.key} : aucune photo (${l.photoQueries.join(' | ')})`); continue; }
    if (picked.length < wanted) short += 1;
    out[l.key] = picked.map(({ id, url, width, height, author, authorUrl, landing, source, license }) => ({ id, url, width, height, author, authorUrl, landing, source, license }));
    resolved += 1;
    if (resolved % 25 === 0) { console.log(`… ${resolved} annonces résolues`); if (!args.dry) fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + '\n'); }
  }
  if (!args.dry) fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + '\n');
  const total = Object.values(out).reduce((s, a) => s + a.length, 0);
  const bySource = {};
  for (const p of Object.values(out).flat()) bySource[p.source] = (bySource[p.source] || 0) + 1;
  console.log(`${resolved} annonce(s) résolue(s) ce passage · ${Object.keys(out).length} / ${listings.length} annonces avec photos · ${total} photos (${JSON.stringify(bySource)}) · ${short} annonce(s) avec moins de photos que souhaité · ${none} sans aucune photo`);
})();
