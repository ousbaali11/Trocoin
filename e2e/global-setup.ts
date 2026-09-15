/* eslint-disable @typescript-eslint/no-require-imports */
import fs from 'fs';
import path from 'path';
import { API, TMP, type Seed, type SeedUser } from './helpers';

/**
 * Données de départ, créées PAR L'API (comme le ferait un utilisateur) sur la base jetable :
 *  - un administrateur (inscrit par le formulaire puis promu directement en base : il n'existe
 *    volontairement aucune route HTTP pour devenir admin) ;
 *  - un vendeur et un acheteur ;
 *  - cinq annonces géolocalisées (Lyon, Villeurbanne, Paris, Marseille) pour la recherche ;
 *  - deux photos JPEG générées pour le dépôt d'annonce.
 */
const PASSWORD = 'Trocoin!E2E-2026';

async function call<T = unknown>(pathname: string, method: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

async function register(u: Omit<SeedUser, 'id' | 'displayName'> & { firstName: string; lastName: string }): Promise<{ user: SeedUser; token: string }> {
  const r = await call<{ accessToken: string; user: { id: string; displayName: string } }>('/auth/register', 'POST', {
    accountType: 'particulier',
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    email: u.email,
    phoneNumber: u.phone,
    password: u.password,
    passwordConfirmation: u.password,
  });
  return { user: { email: u.email, username: u.username, password: u.password, phone: u.phone, id: r.user.id, displayName: r.user.displayName }, token: r.accessToken };
}

/** Remplit les critères obligatoires d'une catégorie à partir de son schéma (première option, texte, nombre). */
async function requiredAttributes(slug: string, overrides: Record<string, unknown>): Promise<Record<string, unknown>> {
  const schema = await call<{ fields: Array<{ key: string; type: string; required?: boolean; options?: string[]; min?: number; dependsOn?: string; optionsByParent?: Record<string, string[]> }> }>(`/categories/${slug}/schema`, 'GET');
  const attrs: Record<string, unknown> = {};
  for (const f of schema.fields) {
    if (!f.required) continue;
    // Liste dépendante (modèle selon la marque) : première option de la marque déjà choisie
    const options = f.dependsOn && f.optionsByParent ? f.optionsByParent[String(attrs[f.dependsOn])] : f.options;
    attrs[f.key] = f.type === 'select' ? options?.[0] : f.type === 'number' ? Math.max(f.min ?? 1, 2020) : f.type === 'boolean' ? true : 'Test';
  }
  return { ...attrs, ...overrides };
}

async function promoteToAdmin(dbPath: string, phone: string) {
  const sqlite3 = require('sqlite3');
  await new Promise<void>((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    db.run(`UPDATE users SET accountType = 'admin' WHERE phoneNumber = ?`, [phone], function (this: { changes: number }, err: Error | null) {
      db.close();
      if (err) return reject(err);
      if (this.changes !== 1) return reject(new Error(`Promotion admin : ${this.changes} ligne modifiée pour ${phone}`));
      resolve();
    });
  });
}

async function makePhotos(): Promise<string[]> {
  const sharp = require('sharp');
  const out: string[] = [];
  for (const [i, color] of [['#0f7b5f', 1], ['#d89a2b', 2]].entries()) {
    const p = path.join(TMP, `photo-${i + 1}.jpg`);
    await sharp({ create: { width: 1200, height: 900, channels: 3, background: color[0] as string } })
      .composite([{ input: Buffer.from(`<svg width="1200" height="900"><text x="80" y="480" font-size="160" fill="white" font-family="sans-serif">Photo ${color[1]}</text></svg>`) }])
      .jpeg({ quality: 80 })
      .toFile(p);
    out.push(p);
  }
  return out;
}

export default async function globalSetup() {
  fs.mkdirSync(TMP, { recursive: true });
  const dbPath = path.resolve(__dirname, '..', 'data', 'e2e.sqlite');
  const health = await call<{ status: string; database: string }>('/health', 'GET');
  if (health.database !== 'sqlite') throw new Error(`L'API de test doit tourner sur SQLite (e2e/start-api.js), vue : ${health.database}`);

  const stamp = Date.now().toString().slice(-6);
  const admin = await register({ firstName: 'Admin', lastName: 'Trocoin', username: `e2e_admin_${stamp}`, email: `admin.${stamp}@e2e.test`, phone: '0611000001', password: PASSWORD });
  await promoteToAdmin(dbPath, '+33611000001');
  const seller = await register({ firstName: 'Camille', lastName: 'Vendeur', username: `e2e_vendeur_${stamp}`, email: `vendeur.${stamp}@e2e.test`, phone: '0611000002', password: PASSWORD });
  const buyer = await register({ firstName: 'Nora', lastName: 'Acheteur', username: `e2e_acheteur_${stamp}`, email: `acheteur.${stamp}@e2e.test`, phone: '0611000003', password: PASSWORD });

  const listings: Seed['listings'] = {};
  const defs = [
    { key: 'vtt', slug: 'velos', title: 'VTT électrique Rockrider E-ST 500 taille M', price: 890, condition: 'tres_bon_etat', city: 'Lyon', postalCode: '69003', latitude: 45.764, longitude: 4.8357, attrs: { type_velo: 'VTT' } },
    { key: 'ps5', slug: 'consoles-jeux-video', title: 'PlayStation 5 édition standard avec deux manettes', price: 380, condition: 'bon_etat', city: 'Villeurbanne', postalCode: '69100', latitude: 45.7719, longitude: 4.8902, attrs: { plateforme: 'PlayStation 5' } },
    { key: 'poussette', slug: 'puericulture', title: 'Poussette Yoyo noire avec habillage pluie', price: 260, condition: 'bon_etat', city: 'Lyon', postalCode: '69007', latitude: 45.7485, longitude: 4.8467, attrs: {} },
    { key: 'canape', slug: 'ameublement', title: 'Canapé trois places en velours vert', price: 450, condition: 'tres_bon_etat', city: 'Paris', postalCode: '75011', latitude: 48.8566, longitude: 2.3522, attrs: {} },
    { key: 'tondeuse', slug: 'jardinage', title: 'Tondeuse thermique Honda 46 cm', price: 220, condition: 'bon_etat', city: 'Marseille', postalCode: '13001', latitude: 43.2965, longitude: 5.3698, attrs: {} },
  ];
  for (const d of defs) {
    const attributes = await requiredAttributes(d.slug, d.attrs);
    const created = await call<{ id: string; status: string }>('/listings', 'POST', {
      categorySlug: d.slug,
      title: d.title,
      description: `${d.title}. Article en ${d.condition.replace(/_/g, ' ')}, visible sur rendez-vous, remise en main propre possible. Description rédigée pour les tests automatisés.`,
      priceType: 'fixe',
      price: d.price,
      condition: d.condition,
      attributes,
      city: d.city,
      postalCode: d.postalCode,
      latitude: d.latitude,
      longitude: d.longitude,
      deliveryAvailable: false,
    }, seller.token);
    if (created.status !== 'en_ligne') throw new Error(`Annonce du seed « ${d.title} » non publiée : ${created.status}`);
    listings[d.key] = { id: created.id, title: d.title };
  }

  const photos = await makePhotos();
  const seed: Seed = { admin: admin.user, seller: seller.user, buyer: buyer.user, listings, photos };
  fs.writeFileSync(path.join(TMP, 'seed.json'), JSON.stringify(seed, null, 2));
}
