// Répétition locale du catalogue de démonstration (AUDIT §71) : API compilée sur une base SQLite jetable (e2e/start-api.js),
// administrateur créé puis promu en base, ensemencement lancé par la route d'administration, état suivi jusqu'à la fin.
// Usage : E2E_API_URL=http://localhost:3010 E2E_FRONT_URL=http://localhost:3011 node scripts/demo-catalogue/rehearse.js [--limit 60] [--keep]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const API = process.env.E2E_API_URL || 'http://localhost:3010';
const DB = path.join(ROOT, 'data', 'e2e.sqlite');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : [])).filter((x) => x.length));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, url, body, token) => {
  const res = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
};

(async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'e2e', 'start-api.js')], { cwd: ROOT, env: { ...process.env, E2E_API_URL: API }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(ROOT, 'private', 'demo-catalogue-rehearse-api.log'));
  child.stdout.pipe(log); child.stderr.pipe(log);
  for (let i = 0; i < 120; i += 1) { try { await call('GET', '/health'); break; } catch { await sleep(1000); } }
  const stamp = Date.now().toString().slice(-6);
  const admin = { accountType: 'particulier', firstName: 'Admin', lastName: 'Répétition', username: `admin_rep_${stamp}`, email: `admin.${stamp}@e2e.test`, phoneNumber: '0611000099', password: 'MotDePasse!Rep42', passwordConfirmation: 'MotDePasse!Rep42' };
  await call('POST', '/auth/register', admin);
  const sqlite3 = require('sqlite3');
  await new Promise((resolve, reject) => { const db = new sqlite3.Database(DB); db.run(`UPDATE users SET accountType = 'admin' WHERE username = ?`, [admin.username], function (err) { db.close(); if (err) return reject(err); resolve(this.changes); }); });
  const relogin = async () => (await call('POST', '/auth/login', { identifier: admin.email, password: admin.password })).accessToken;
  let token = await relogin();
  const before = await call('GET', '/admin/demo-catalogue', null, token);
  console.log('Jeu de données :', JSON.stringify(before.dataset.byFamily), '| photos prévues', before.dataset.photosPlanned, '| annonces avec photos', before.dataset.listingsWithPhotos);
  const t0 = Date.now();
  await call('POST', '/admin/demo-catalogue/run', { ...(args.limit ? { limit: Number(args.limit) } : {}), force: true }, token); // répétition locale : photos Commons partielles acceptées
  let state;
  for (;;) {
    await sleep(5000);
    try {
      state = (await call('GET', '/admin/demo-catalogue', null, token)).run;
    } catch (e) {
      if (!/401/.test(e.message)) throw e;
      token = await relogin(); // jeton d'accès de 15 min : l'ensemencement dure plus longtemps
      continue;
    }
    process.stdout.write(`\r${state.done}/${state.total} · comptes ${state.accounts.created} · annonces ${state.listings.created} (échecs ${state.listings.failed}) · photos ${state.photos.created} (échecs ${state.photos.failed})   `);
    if (state.status !== 'running') break;
  }
  console.log(`\nStatut ${state.status} en ${Math.round((Date.now() - t0) / 1000)} s`);
  if (state.errors.length) console.log('Erreurs :\n- ' + state.errors.slice(0, 40).join('\n- '));
  const creds = await call('POST', '/admin/demo-catalogue/credentials', {}, token);
  const credFile = path.join(ROOT, 'private', `demo-catalogue-accounts-${API.replace(/[^a-z0-9]/gi, '_')}.md`);
  fs.writeFileSync(credFile, ['# Comptes du catalogue de démonstration — ' + API + ' (répétition locale)', '', '| Nom | E-mail | Pseudo | Mot de passe | Numéro |', '|---|---|---|---|---|', ...creds.items.map((c) => `| ${c.name} | ${c.email} | ${c.username} | \`${c.password}\` | ${c.phone} |`), ''].join('\n'));
  console.log(`${creds.items.length} identifiants écrits dans ${credFile}`);
  const after = await call('GET', '/admin/demo-catalogue', null, token);
  console.log('En base :', JSON.stringify(after.database));
  // Répartition réelle par famille (recherche publique)
  const tree = await call('GET', '/categories/tree');
  const dist = {};
  for (const c of tree) dist[c.slug] = (await call('GET', `/listings?category=${c.slug}&page_size=1`)).total;
  console.log('En ligne par famille :', JSON.stringify(dist));
  fs.writeFileSync(path.join(ROOT, 'private', 'demo-catalogue-rehearse-result.json'), JSON.stringify({ state, database: after.database, distribution: dist, adminEmail: admin.email }, null, 1));
  if (!args.keep) child.kill();
  else console.log('API laissée en marche (--keep) ; administrateur :', admin.email);
})().catch((e) => { console.error(e.message); process.exit(1); });
