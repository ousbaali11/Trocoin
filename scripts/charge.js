#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Test de charge léger et réaliste, sans dépendance : N utilisateurs virtuels rejouent en boucle
 * le parcours « recherche → consultation d'une annonce → annonces similaires », avec un temps de
 * réflexion aléatoire entre les pages, contre l'API et (optionnel) les pages du front.
 *
 * Usage :
 *   node scripts/charge.js --api https://trocoin.onrender.com --front https://trocoin.vercel.app --vus 10 --minutes 3
 *
 * Sortie : nombre de requêtes, erreurs (statut ≥ 400 ou réseau), latences p50 / p95 / p99 / max par
 * point d'entrée, et l'état /health avant et après (uptime : un redémarrage serait visible).
 * Ne crée aucune donnée : lectures publiques uniquement.
 */
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const API = (args.api || 'http://localhost:3000').replace(/\/$/, '');
const FRONT = args.front ? args.front.replace(/\/$/, '') : null;
const VUS = Number(args.vus || 10);
const MINUTES = Number(args.minutes || 3);
const WORDS = ['golf', 'tiguan', 'vélo', 'canapé', 'iphone', 'appartement', 'jardin', 'voiture', 'console', 'poussette'];

const stats = new Map(); // clé → { n, err, times: number[] }
const errors = [];
function record(key, ms, ok, detail) {
  const s = stats.get(key) || { n: 0, err: 0, times: [] };
  s.n += 1;
  s.times.push(ms);
  if (!ok) { s.err += 1; if (errors.length < 20) errors.push(`${key} → ${detail}`); }
  stats.set(key, s);
}
async function hit(key, url, accept = 'application/json') {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { headers: { accept, 'user-agent': 'trocoin-charge/1.0' } });
    const body = await res.text();
    const ms = performance.now() - t0;
    record(key, ms, res.ok, `${res.status} ${body.slice(0, 80).replace(/\s+/g, ' ')}`);
    return res.ok ? body : null;
  } catch (e) {
    record(key, performance.now() - t0, false, e.cause?.code || e.message);
    return null;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const think = () => sleep(800 + Math.random() * 2200);
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0; };

async function vu(id, deadline) {
  await sleep(Math.random() * 3000); // arrivées étalées
  while (Date.now() < deadline) {
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    await hit('API GET /categories/tree', `${API}/categories/tree`);
    const search = await hit('API GET /listings?q=', `${API}/listings?q=${encodeURIComponent(word)}&page_size=24`);
    await think();
    let ids = [];
    try { ids = JSON.parse(search || '{}').items?.map((l) => l.id) || []; } catch { /* réponse non JSON déjà comptée en erreur */ }
    if (ids.length === 0) {
      const all = await hit('API GET /listings (récentes)', `${API}/listings?page_size=8`);
      try { ids = JSON.parse(all || '{}').items?.map((l) => l.id) || []; } catch { /* idem */ }
    }
    if (ids.length) {
      const lid = ids[Math.floor(Math.random() * ids.length)];
      await hit('API GET /listings/:id', `${API}/listings/${lid}`);
      await hit('API GET /listings/:id/similar', `${API}/listings/${lid}/similar`);
      if (FRONT) await hit('FRONT GET /annonces/:id (SSR)', `${FRONT}/annonces/${lid}`, 'text/html');
      await think();
    }
    if (FRONT && Math.random() < 0.5) await hit('FRONT GET /recherche', `${FRONT}/recherche?q=${encodeURIComponent(word)}`, 'text/html');
    if (Math.random() < 0.3) await hit('API GET /listings?category=', `${API}/listings?category=vehicules&page_size=24`);
    await think();
  }
  void id;
}

(async () => {
  const health = async () => { try { return JSON.parse(await (await fetch(`${API}/health`)).text()); } catch (e) { return { error: e.message }; } };
  const before = await health();
  console.log(`API ${API}${FRONT ? ` + front ${FRONT}` : ''} — ${VUS} utilisateurs virtuels pendant ${MINUTES} min — début ${new Date().toISOString()}`);
  console.log('health avant :', JSON.stringify(before));
  const deadline = Date.now() + MINUTES * 60_000;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: VUS }, (_, i) => vu(i, deadline)));
  const elapsed = (Date.now() - t0) / 1000;
  const after = await health();
  console.log('health après :', JSON.stringify(after));
  let total = 0, errs = 0;
  console.log('\n| Point d\'entrée | Requêtes | Erreurs | p50 | p95 | p99 | max |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [k, s] of [...stats.entries()].sort()) {
    total += s.n; errs += s.err;
    console.log(`| ${k} | ${s.n} | ${s.err} | ${Math.round(pct(s.times, 50))} ms | ${Math.round(pct(s.times, 95))} ms | ${Math.round(pct(s.times, 99))} ms | ${Math.round(Math.max(...s.times))} ms |`);
  }
  console.log(`\nTotal : ${total} requêtes en ${elapsed.toFixed(0)} s (${(total / elapsed).toFixed(1)} req/s), ${errs} erreur(s) (${((100 * errs) / Math.max(1, total)).toFixed(2)} %).`);
  if (before.uptimeSeconds != null && after.uptimeSeconds != null) console.log(after.uptimeSeconds >= before.uptimeSeconds ? 'Aucun redémarrage du serveur pendant le test (uptime croissant).' : '⚠ Le serveur a redémarré pendant le test.');
  if (errors.length) { console.log('\nPremières erreurs :'); for (const e of errors) console.log('  -', e); }
  process.exit(errs > total * 0.01 ? 1 : 0);
})();
