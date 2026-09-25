// Planche-contact de contrôle (AUDIT §71) : N annonces tirées au hasard, première photo résolue + titre, pour vérifier à
// l'œil que les photos correspondent aux objets. Sortie : private/demo-catalogue-sheet-<n>.jpg (hors dépôt).
// Usage : node scripts/demo-catalogue/contact-sheet.js [--n 24] [--seed 1] [--family mode] [--only clé1,clé2]
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'src', 'demo-catalogue', 'data');
const PRIVATE = path.join(ROOT, 'private');
const CACHE = path.join(PRIVATE, 'demo-catalogue-sheet-cache');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : [])).filter((x) => x.length));
const N = Number(args.n || 24);
const seed = Number(args.seed || 1);
const listings = JSON.parse(fs.readFileSync(path.join(DATA, 'listings.json'), 'utf8')).filter((l) => !args.family || l.family === args.family);
const photos = JSON.parse(fs.readFileSync(path.join(DATA, 'photos.json'), 'utf8'));
let a = seed * 2654435761 >>> 0;
const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  const withPhotos = listings.filter((l) => (photos[l.key] || []).length > 0);
  // --only clé1,clé2 : contrôle ciblé (cas signalés) ; sinon tirage aléatoire reproductible par --seed
  const only = args.only ? args.only.split(',') : null;
  const chosen = only ? only.map((k) => withPhotos.find((l) => l.key === k)).filter(Boolean) : [...withPhotos].sort(() => rng() - 0.5).slice(0, N);
  const W = 300, H = 225, LABEL = 46, COLS = 4;
  const tiles = [];
  for (const [i, l] of chosen.entries()) {
    const p = photos[l.key][0];
    const file = path.join(CACHE, p.id.replace(/[^a-z0-9]/gi, '_') + '.jpg');
    try {
      if (!fs.existsSync(file)) {
        const res = await fetch(p.url, { headers: { 'User-Agent': 'Trocoin-demo-catalogue/1.0 (https://www.trocoin.fr)' }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
      const img = await sharp(file).rotate().resize(W, H, { fit: 'cover' }).jpeg().toBuffer();
      const label = Buffer.from(`<svg width="${W}" height="${LABEL}"><rect width="100%" height="100%" fill="#111"/><text x="6" y="17" font-family="Arial" font-size="12" fill="#fff">${esc((i + 1) + '. ' + l.title.slice(0, 44))}</text><text x="6" y="34" font-family="Arial" font-size="10" fill="#bbb">${esc(l.key + ' · ' + p.source + ' · ' + l.photoQueries[0].slice(0, 30))}</text></svg>`);
      tiles.push(await sharp({ create: { width: W, height: H + LABEL, channels: 3, background: '#111' } }).composite([{ input: img, top: 0, left: 0 }, { input: label, top: H, left: 0 }]).jpeg().toBuffer());
    } catch (e) {
      console.log('× ' + l.key + ' : ' + e.message);
    }
  }
  const rows = Math.ceil(tiles.length / COLS);
  const sheet = sharp({ create: { width: COLS * W, height: rows * (H + LABEL), channels: 3, background: '#222' } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % COLS) * W, top: Math.floor(i / COLS) * (H + LABEL) })))
    .jpeg({ quality: 80 });
  const out = path.join(PRIVATE, `demo-catalogue-sheet-${args.only ? 'cibles' : seed}${args.family ? '-' + args.family : ''}.jpg`);
  await sheet.toFile(out);
  console.log(`${tiles.length} vignettes → ${out}`);
})();
