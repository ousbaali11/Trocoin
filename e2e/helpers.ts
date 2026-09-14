import { expect, type Page, type Route } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export const API = process.env.E2E_API_URL || 'http://localhost:3000';
export const TMP = path.join(__dirname, '.tmp');

export interface SeedUser {
  email: string;
  username: string;
  password: string;
  phone: string;
  id: string;
  displayName: string;
}
export interface Seed {
  admin: SeedUser;
  seller: SeedUser;
  buyer: SeedUser;
  listings: Record<string, { id: string; title: string }>;
  photos: string[];
}

export function readSeed(): Seed {
  return JSON.parse(fs.readFileSync(path.join(TMP, 'seed.json'), 'utf8'));
}

/** Suffixe unique par exécution : les inscriptions des tests ne se percutent jamais avec le seed. */
export function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/** Numéro de mobile français unique (06 + 8 chiffres dérivés de l'horloge). */
export function uniquePhone(): string {
  const n = String(Date.now() % 100_000_000).padStart(8, '0');
  return `06${n}`;
}

/**
 * Suggestions de communes simulées : la saisie « Ville ou code postal » interroge
 * api-adresse.data.gouv.fr depuis le navigateur ; en test on répond localement, sans réseau.
 */
export async function mockGeo(page: Page) {
  const cities = [
    { label: 'Lyon (69003)', name: 'Lyon 3e Arrondissement', city: 'Lyon', postcode: '69003', lat: 45.764, lon: 4.8357 },
    { label: 'Villeurbanne (69100)', name: 'Villeurbanne', city: 'Villeurbanne', postcode: '69100', lat: 45.7719, lon: 4.8902 },
    { label: 'Annecy (74000)', name: 'Annecy', city: 'Annecy', postcode: '74000', lat: 45.8992, lon: 6.1294 },
    { label: 'Paris (75011)', name: 'Paris 11e Arrondissement', city: 'Paris', postcode: '75011', lat: 48.8566, lon: 2.3522 },
  ];
  await page.route('https://api-adresse.data.gouv.fr/**', (route: Route) => {
    const q = decodeURIComponent(new URL(route.request().url()).searchParams.get('q') || '').toLowerCase();
    const features = cities
      .filter((c) => c.city.toLowerCase().startsWith(q.slice(0, 3)) || c.postcode.startsWith(q))
      .map((c) => ({ properties: { label: c.label, name: c.name, city: c.city, postcode: c.postcode }, geometry: { coordinates: [c.lon, c.lat] } }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features }) });
  });
}

/** Connexion par le formulaire du site (e-mail ou username + mot de passe). */
export async function loginAs(page: Page, user: { email: string; password: string }, next = '/compte') {
  await page.goto(`/connexion?next=${encodeURIComponent(next)}`);
  await page.getByLabel("E-mail ou nom d'utilisateur").fill(user.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await expect(page).toHaveURL(new RegExp(next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

/** Déconnexion : menu du compte (grand écran) ou menu burger (mobile). */
export async function logout(page: Page) {
  const burger = page.getByRole('button', { name: 'Menu', exact: true });
  if (await burger.isVisible()) {
    await burger.click();
  } else {
    await page.getByRole('button', { name: /^Mon compte/ }).click();
  }
  // Menu déroulant (role=menuitem) sur grand écran, bouton simple dans le menu mobile
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).or(page.getByRole('button', { name: 'Se déconnecter' })).click();
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Aucun défilement horizontal : c'est exactement la régression trouvée lors du tour de polish
 * (menus empilés, tableaux débordants). Vérifie aussi qu'aucun élément ne dépasse le bord droit.
 */
export async function expectNoHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => {
    const w = window.innerWidth;
    const bad: string[] = [];
    document.querySelectorAll('body *').forEach((el) => {
      const rect = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (rect.width > 0 && rect.right > w + 1 && st.position !== 'fixed' && !el.closest('[style*="overflow-x: auto"], .table-wrap, .leaflet-container, nav[aria-label="Mon compte"], .admin-side, [role="menu"]')) {
        bad.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} right=${Math.round(rect.right)}`);
      }
    });
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: w, bad: bad.slice(0, 5) };
  });
  expect(r.scrollWidth, `la page défile horizontalement (${r.scrollWidth} > ${r.innerWidth})`).toBeLessThanOrEqual(r.innerWidth);
  expect(r.bad, 'éléments qui dépassent le bord droit').toEqual([]);
}

/** Message d'erreur du site (le lecteur de route de Next porte aussi role=alert : on cible la classe). */
export function errorAlert(page: Page) {
  return page.locator('.alert-error');
}

/** Appel API direct (préparation de données, jamais pour remplacer un geste utilisateur testé). */
export async function api<T = unknown>(pathname: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(`${API}${pathname}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${pathname} -> ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}
