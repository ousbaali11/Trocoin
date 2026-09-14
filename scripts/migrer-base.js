#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Copie intégrale d'une base PostgreSQL Trocoin vers une autre (ex. Neon us-east-2 → Neon Frankfurt),
 * sans pg_dump : uniquement le pilote `pg` déjà présent dans le projet.
 *
 *   SOURCE_DATABASE_URL=postgresql://… TARGET_DATABASE_URL=postgresql://… node scripts/migrer-base.js
 *   … --verifier-seulement   : ne copie rien, compare seulement (comptages + empreintes)
 *
 * Déroulement :
 *  1. Vérifie que la cible a déjà reçu les migrations (table `migrations` ⊇ celle de la source).
 *  2. Ordonne les tables selon leurs clés étrangères (les tables référencées d'abord ;
 *     une table auto-référencée est insérée par vagues : parents avant enfants).
 *  3. Dans UNE transaction sur la cible : TRUNCATE de toutes les tables de données puis copie
 *     par lots de 500 lignes (colonnes communes aux deux schémas), puis remise à niveau des
 *     séquences. Rejouable : chaque exécution repart d'une cible vide.
 *     Chaque valeur est lue en TEXTE (rendu exact de PostgreSQL : microsecondes des dates,
 *     flottants au chiffre près, JSON tel quel) et réinsérée avec un transtypage explicite :
 *     le pilote ne convertit rien en types JavaScript (une Date JS n'a que la milliseconde).
 *  4. Preuve d'intégrité : pour chaque table, nombre de lignes ET empreinte md5 du contenu
 *     (md5 de chaque ligne en JSON, agrégé dans un ordre déterministe ; fuseau, style de date et
 *     précision des flottants fixés dans la transaction de chaque requête, car un pooler en mode
 *     transaction ne conserve pas les SET de session). Sortie non nulle à la moindre différence.
 * La source n'est jamais modifiée (lecture seule).
 */
const { Client } = require('pg');

const SOURCE = process.env.SOURCE_DATABASE_URL;
const TARGET = process.env.TARGET_DATABASE_URL;
const VERIFY_ONLY = process.argv.includes('--verifier-seulement');
const BATCH = 500;
if (!SOURCE || !TARGET) {
  console.error('Variables requises : SOURCE_DATABASE_URL et TARGET_DATABASE_URL.');
  process.exit(2);
}
if (SOURCE === TARGET) {
  console.error('Source et cible identiques : rien à faire.');
  process.exit(2);
}

const q = (s) => '"' + s.replace(/"/g, '""') + '"';

async function connect(url, label) {
  const c = new Client({ connectionString: url, ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined, statement_timeout: 600_000 });
  await c.connect();
  const v = await c.query('SELECT version() AS v, current_database() AS db');
  console.log(`${label} : ${v.rows[0].v.split(' on ')[0]} · base ${v.rows[0].db}`);
  return c;
}

async function tables(c) {
  const r = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'migrations' ORDER BY table_name`);
  return r.rows.map((x) => x.table_name);
}

async function columns(c, table) {
  const r = await c.query(`SELECT column_name, data_type, udt_name, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table]);
  return r.rows;
}

/** Arêtes de clés étrangères : [table_enfant, table_parent, colonne_enfant]. */
async function foreignKeys(c) {
  const r = await c.query(`
    SELECT tc.table_name AS child, ccu.table_name AS parent, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
  return r.rows;
}

/** Tri topologique : les tables référencées avant celles qui les référencent (auto-références ignorées ici). */
function order(names, fks) {
  const deps = new Map(names.map((n) => [n, new Set()]));
  for (const { child, parent } of fks) if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child).add(parent);
  const out = [];
  const seen = new Set();
  const visit = (n, stack = []) => {
    if (seen.has(n)) return;
    if (stack.includes(n)) throw new Error(`Cycle de clés étrangères : ${[...stack, n].join(' → ')}`);
    for (const d of deps.get(n)) visit(d, [...stack, n]);
    seen.add(n);
    out.push(n);
  };
  for (const n of names) visit(n);
  return out;
}

async function migrationsOf(c) {
  const r = await c.query(`SELECT name FROM migrations ORDER BY id`).catch(() => ({ rows: [] }));
  return r.rows.map((x) => x.name);
}

/** Type SQL vers lequel retranstyper une valeur transmise en texte. */
function castOf(col) {
  if (col.data_type === 'ARRAY') return col.udt_name.replace(/^_/, '') + '[]';
  if (col.data_type === 'USER-DEFINED') return q(col.udt_name);
  return col.data_type;
}

async function copyTable(src, dst, table, cols, colDefs, selfRefCols) {
  const colList = cols.map(q).join(', ');
  const casts = cols.map((c) => castOf(colDefs.find((d) => d.column_name === c)));
  const all = (await src.query(`SELECT ${cols.map((c) => `${q(c)}::text AS ${q(c)}`).join(', ')} FROM ${q(table)}`)).rows;
  let rows = all;
  // Table auto-référencée : insérer par vagues (les lignes dont le parent est déjà inséré)
  if (selfRefCols.length && rows.length && cols.includes('id')) {
    const inserted = new Set();
    const ordered = [];
    let pending = rows;
    while (pending.length) {
      const ready = pending.filter((r) => selfRefCols.every((c) => r[c] == null || inserted.has(String(r[c]))));
      if (!ready.length) throw new Error(`Table ${table} : références circulaires, copie impossible.`);
      for (const r of ready) {
        inserted.add(String(r.id));
        ordered.push(r);
      }
      pending = pending.filter((r) => !ready.includes(r));
    }
    rows = ordered;
  }
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params = [];
    const values = chunk.map((r) => '(' + cols.map((c, j) => {
      params.push(r[c]);
      return `$${params.length}::${casts[j]}`;
    }).join(', ') + ')');
    await dst.query(`INSERT INTO ${q(table)} (${colList}) VALUES ${values.join(', ')}`, params);
  }
  return rows.length;
}

async function resetSequences(dst, table, cols) {
  for (const col of cols) {
    if (!col.column_default || !/nextval\(/.test(col.column_default)) continue;
    await dst.query(`SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT max(${q(col.column_name)}) FROM ${q(table)}), 1), (SELECT max(${q(col.column_name)}) IS NOT NULL FROM ${q(table)}))`, [q(table), col.column_name]);
  }
}

/** Empreinte d'une table (colonnes données) avec un rendu texte déterministe, fixé dans la transaction. */
async function fingerprint(c, table, cols) {
  await c.query('BEGIN');
  try {
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    await c.query('SET LOCAL extra_float_digits = 3');
    await c.query("SET LOCAL DateStyle = 'ISO, YMD'");
    const list = cols.map(q).join(', ');
    const r = await c.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(md5(row_to_json(r)::text), '|' ORDER BY md5(row_to_json(r)::text)), '')) AS h FROM (SELECT ${list} FROM ${q(table)}) r`);
    return r.rows[0];
  } finally {
    await c.query('COMMIT');
  }
}

(async () => {
  const src = await connect(SOURCE, 'Source');
  const dst = await connect(TARGET, 'Cible ');

  const srcMig = await migrationsOf(src);
  const dstMig = await migrationsOf(dst);
  const missing = srcMig.filter((m) => !dstMig.includes(m));
  if (missing.length) throw new Error(`La cible n'a pas reçu les migrations : ${missing.join(', ')}. Lancez d'abord les migrations dessus.`);
  console.log(`Migrations : source ${srcMig.length}, cible ${dstMig.length} (${dstMig.length - srcMig.length} en plus sur la cible)`);

  const srcTables = await tables(src);
  const dstTables = await tables(dst);
  const absent = srcTables.filter((t) => !dstTables.includes(t));
  if (absent.length) throw new Error(`Tables absentes de la cible : ${absent.join(', ')}`);
  const fks = await foreignKeys(src);
  const ordered = order(srcTables, fks);

  const plan = [];
  for (const t of ordered) {
    const sc = await columns(src, t);
    const dc = await columns(dst, t);
    const common = sc.map((c) => c.column_name).filter((n) => dc.some((d) => d.column_name === n));
    const onlySrc = sc.map((c) => c.column_name).filter((n) => !common.includes(n));
    if (onlySrc.length) console.warn(`  ! ${t} : colonnes ignorées (absentes de la cible) : ${onlySrc.join(', ')}`);
    const selfRef = fks.filter((f) => f.child === t && f.parent === t).map((f) => f.col);
    plan.push({ t, common, srcCols: sc, dstCols: dc, selfRef });
  }

  if (!VERIFY_ONLY) {
    console.log(`\nCopie de ${plan.length} tables (ordre : ${ordered.join(' → ')})`);
    await dst.query('BEGIN');
    try {
      await dst.query(`TRUNCATE TABLE ${ordered.map(q).join(', ')} RESTART IDENTITY CASCADE`);
      for (const p of plan) {
        const n = await copyTable(src, dst, p.t, p.common, p.srcCols, p.selfRef);
        await resetSequences(dst, p.t, p.dstCols);
        console.log(`  ${p.t.padEnd(24)} ${String(n).padStart(7)} lignes`);
      }
      await dst.query('COMMIT');
    } catch (e) {
      await dst.query('ROLLBACK');
      throw e;
    }
  }

  console.log('\nVérification (comptage + empreinte md5 du contenu, colonnes communes) :');
  let ok = true;
  console.log('  table                    source   cible   empreinte');
  for (const p of plan) {
    const a = await fingerprint(src, p.t, p.common);
    const b = await fingerprint(dst, p.t, p.common);
    const same = a.n === b.n && a.h === b.h;
    if (!same) ok = false;
    console.log(`  ${p.t.padEnd(24)} ${String(a.n).padStart(6)} ${String(b.n).padStart(7)}   ${same ? 'identique' : 'DIFFÉRENTE ✗'}`);
  }
  await src.end();
  await dst.end();
  if (!ok) {
    console.error('\n✗ Différences détectées : ne basculez pas DATABASE_URL.');
    process.exit(1);
  }
  console.log(`\n✓ ${plan.length} tables identiques (comptages et empreintes).`);
})().catch((e) => {
  console.error('\n✗', e.message);
  process.exit(1);
});
