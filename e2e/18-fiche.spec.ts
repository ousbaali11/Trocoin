import { expect, test } from '@playwright/test';
import fs from 'fs';
import { API, api, loginAs, readSeed } from './helpers';

/**
 * Fiche annonce complète (brief « inspirée de leboncoin », 16 septembre 2026) : fil d'Ariane avec
 * région, département et ville ; galerie avec compteur de favoris, partage et « Voir les photos » ;
 * bloc prix avec repères de catégorie, position par rapport au marché et ancienneté ; « Les + de
 * cette annonce » ; informations clés en grille dépliable ; équipements ; description « Voir plus » ;
 * carte zoomée ; « Signaler l'annonce » en bas de fiche ; carrousel « Ces annonces peuvent vous
 * intéresser » ; « Suivre » le vendeur ; badge « Déjà vu » sur les cartes de résultats.
 */
const seed = readSeed();
const L = seed.listings;

type Login = { accessToken: string; user: { id: string } };
let sellerToken = '';
const created: string[] = [];
let car = { id: '', title: '' };
const LONG_DESCRIPTION = Array.from({ length: 12 }, (_, i) => `Ligne ${i + 1} : véhicule entretenu, carnet à jour, pneus récents, distribution faite, aucun frais à prévoir.`).join('\n');

test.beforeAll(async ({ request }) => {
  const login = await api<Login>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  sellerToken = login.accessToken;
  const base = { categorySlug: 'voitures', condition: 'bon_etat', city: 'Lyon', postalCode: '69003', priceType: 'fixe' };
  const attrs = { marque: 'Peugeot', modele: '208', annee: 2019, kilometrage: 58000, carburant: 'Essence', boite: 'Manuelle' };
  // Trois annonces comparables pour que la position du prix par rapport au marché existe
  for (const [title, price] of [['Peugeot 208 Active 2019', 8000], ['Peugeot 208 Allure 2019', 9000], ['Peugeot 208 GT Line 2019', 10000]] as const) {
    const l = await api<{ id: string }>('/listings', { method: 'POST', token: sellerToken, body: { ...base, title, price, description: 'Annonce comparable, rédigée pour les tests automatisés.', attributes: attrs } });
    created.push(l.id);
  }
  const full = await api<{ id: string; title: string }>('/listings', {
    method: 'POST',
    token: sellerToken,
    body: {
      ...base,
      title: 'Peugeot 208 Style 1.2 PureTech 2019',
      price: 9200,
      description: LONG_DESCRIPTION,
      deliveryAvailable: false,
      attributes: { ...attrs, puissance_din: 82, portes: '5', places: 5, couleur: 'Gris', sellerie: 'Tissu', critair: '1', controle_technique: true, premiere_main: true },
    },
  });
  created.push(full.id);
  car = full;
  for (const p of seed.photos) {
    const res = await request.post(`${API}/listings/${full.id}/photos`, { headers: { Authorization: `Bearer ${sellerToken}` }, multipart: { files: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(p) } } });
    expect(res.status()).toBe(201);
  }
});

test.afterAll(async () => {
  for (const id of created) await api(`/listings/${id}`, { method: 'DELETE', token: sellerToken }).catch(() => undefined);
});

test('fil d\'Ariane complet, galerie, bloc prix, informations clés, équipements, description, carte, signalement, carrousel', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'bureau uniquement');
  await page.goto(`/annonces/${car.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(car.title);

  // Fil d'Ariane : Accueil › Véhicules › Voitures › Auvergne-Rhône-Alpes › Rhône › Lyon › Titre
  const crumbs = page.getByRole('navigation', { name: "Fil d'Ariane" });
  await expect(crumbs.locator('li')).toHaveText(['Accueil', 'Véhicules', 'Voitures', 'Auvergne-Rhône-Alpes', 'Rhône', 'Lyon', car.title]);
  await expect(crumbs.getByRole('link', { name: 'Rhône', exact: true })).toHaveAttribute('href', '/recherche?category=voitures&postal_code=69');
  await expect(crumbs.getByRole('link', { name: 'Auvergne-Rhône-Alpes' })).toHaveAttribute('href', '/recherche?category=voitures&region=auvergne-rhone-alpes');
  await expect(crumbs.getByRole('link', { name: 'Lyon' })).toHaveAttribute('href', '/recherche?category=voitures&city=Lyon');
  const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
  const breadcrumbLd = (JSON.parse(jsonLd!) as Array<{ '@type': string; itemListElement?: Array<{ name: string }> }>).find((d) => d['@type'] === 'BreadcrumbList')!;
  expect(breadcrumbLd.itemListElement!.map((i) => i.name)).toEqual(['Accueil', 'Véhicules', 'Voitures', 'Auvergne-Rhône-Alpes', 'Rhône', 'Lyon', car.title]);

  // Galerie : compteur, favoris visibles, partage, « Voir les photos » ouvre le plein écran avec navigation
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.getByTestId('favorites-count')).toHaveText(/^0/);
  await expect(page.getByTestId('gallery-actions').getByRole('button', { name: 'Partager' })).toBeVisible();
  await page.getByRole('button', { name: 'Voir les photos' }).click();
  const fullscreen = page.getByRole('dialog', { name: 'Photos en plein écran' });
  await expect(fullscreen).toBeVisible();
  await fullscreen.getByRole('button', { name: 'Photo suivante' }).click();
  await expect(fullscreen).toContainText('2 / 2');
  await page.keyboard.press('Escape');
  await expect(fullscreen).toBeHidden();

  // Bloc prix : lieu + année · kilométrage · carburant, prix, position par rapport au marché (estimation existante), ancienneté
  await expect(page.getByTestId('listing-summary')).toHaveText(/Lyon \(69003\)\s*2019\s*58[\s ]000 km\s*Essence/);
  await expect(page.getByTestId('listing-price')).toHaveText('9 200 €');
  const market = page.getByTestId('market-position');
  await expect(market).toBeVisible();
  await expect(market).toHaveAttribute('data-verdict', 'dans-la-fourchette');
  await expect(market).toContainText('Prix dans la fourchette');
  await expect(page.getByTestId('published-ago')).toHaveText("Publiée aujourd'hui");

  // « Les + de cette annonce » : uniquement des faits connus (récente, 2 photos < 3 donc pas de badge photos, options cochées)
  const highlights = page.getByTestId('highlights');
  await expect(highlights).toContainText('Annonce récente');
  await expect(highlights).toContainText('Contrôle technique à jour');
  await expect(highlights).not.toContainText('Livraison possible');

  // Informations clés : grille à deux colonnes, six visibles, le reste derrière « Voir les critères supplémentaires »
  const keyInfo = page.getByTestId('key-info');
  await expect(keyInfo.locator('dt')).toHaveCount(6);
  const cols = await keyInfo.locator('dl').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(2);
  const more = keyInfo.getByRole('button', { name: /Voir les critères supplémentaires \(\d+\)/ });
  await more.click();
  expect(await keyInfo.locator('dt').count()).toBeGreaterThan(6);
  await expect(keyInfo).toContainText('Sellerie');
  await keyInfo.getByRole('button', { name: 'Voir moins de critères' }).click();
  await expect(keyInfo.locator('dt')).toHaveCount(6);
  // Équipements : options cochées, hors informations clés
  const equipments = page.getByTestId('equipments');
  await expect(equipments).toContainText('Contrôle technique à jour');
  await expect(equipments).toContainText('Première main');
  await expect(keyInfo).not.toContainText('Première main');

  // Description longue : tronquée puis « Voir plus » / « Voir moins »
  const description = page.getByTestId('description');
  await expect(description).toHaveAttribute('data-expanded', 'false');
  const clampedHeight = (await description.locator('p').boundingBox())!.height;
  await description.getByRole('button', { name: 'Voir plus' }).click();
  await expect(description).toHaveAttribute('data-expanded', 'true');
  expect((await description.locator('p').boundingBox())!.height).toBeGreaterThan(clampedHeight + 40);
  await description.getByRole('button', { name: 'Voir moins' }).click();
  await expect(description).toHaveAttribute('data-expanded', 'false');

  // Carte : zoom 13 (rues visibles) et cercle nettement visible (diamètre > 150 px)
  const map = page.getByTestId('approx-map');
  await map.scrollIntoViewIfNeeded();
  await expect(map.locator('.leaflet-tile').first()).toHaveAttribute('src', /tile\.openstreetmap\.org\/13\//, { timeout: 15000 });
  const circle = (await map.locator('path.leaflet-interactive').boundingBox())!;
  expect(circle.width).toBeGreaterThan(150);
  expect(circle.width).toBeLessThan(320);

  // Signalement accessible en bas de fiche (visiteur → connexion avec retour)
  await expect(page.getByTestId('report-link')).toHaveText(/Signaler l'annonce/);

  // « Ces annonces peuvent vous intéresser » : carrousel des comparables + « Voir plus d'annonces »
  const similar = page.getByTestId('similar');
  await expect(similar.getByRole('heading', { name: 'Ces annonces peuvent vous intéresser' })).toBeVisible();
  await expect(similar.getByRole('link', { name: "Voir plus d'annonces" })).toHaveAttribute('href', '/recherche?category=voitures');
  expect(await similar.getByTestId('listing-card').count()).toBeGreaterThanOrEqual(3);
  await page.getByTestId('report-link').click();
  await expect(page).toHaveURL(new RegExp(`/connexion\\?next=.*${car.id}`));
});

test('badge « Déjà vu » sur la carte de résultats après consultation, pour un visiteur puis un membre', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'bureau uniquement');
  await page.goto('/recherche?category=voitures');
  const card = page.locator('article').filter({ hasText: car.title }).first();
  await expect(card).toBeVisible();
  await expect(card.getByTestId('card-seen')).toHaveCount(0);
  await page.goto(`/annonces/${car.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(car.title);
  await page.goto('/recherche?category=voitures');
  await expect(page.locator('article').filter({ hasText: car.title }).first().getByTestId('card-seen')).toHaveText('Déjà vu');
  await expect(page.locator('article').filter({ hasText: 'Peugeot 208 Active 2019' }).first().getByTestId('card-seen')).toHaveCount(0);

  // Membre : l'historique serveur (« Annonces consultées ») alimente aussi le badge, sans stockage local
  await api(`/listings/${L.vtt.id}`, { method: 'GET', token: (await api<Login>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } })).accessToken });
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await loginAs(page, seed.buyer, '/recherche');
  await expect(page.locator('article').filter({ hasText: L.vtt.title }).first().getByTestId('card-seen')).toHaveText('Déjà vu');
});

test('« Suivre » le vendeur crée une alerte sur ses nouvelles annonces, visible dans Mes recherches, et se retire', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'bureau uniquement');
  await loginAs(page, seed.buyer, `/annonces/${L.vtt.id}`);
  const follow = page.getByTestId('follow-seller');
  await expect(follow).toHaveText('Suivre');
  await follow.click();
  await expect(follow).toHaveText('✓ Suivi');
  await expect(page.getByText(/Vendeur suivi/)).toBeVisible();
  await page.goto('/compte/recherches');
  await expect(page.getByText(`Annonces de ${seed.seller.displayName}`)).toBeVisible();
  await page.goto(`/annonces/${L.vtt.id}`);
  await expect(follow).toHaveText('✓ Suivi');
  await follow.click();
  await expect(follow).toHaveText('Suivre');
  await page.goto('/compte/recherches');
  await expect(page.getByText(`Annonces de ${seed.seller.displayName}`)).toHaveCount(0);
});
