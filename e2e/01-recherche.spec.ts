import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, mockGeo, readSeed } from './helpers';

/**
 * Recherche : mot-clé, filtre catégorie, « Toute la France », rayon en kilomètres, tri.
 * Données : cinq annonces du seed (Lyon 3e, Lyon 7e, Villeurbanne, Paris, Marseille).
 * Joué en desktop ET en mobile (375 px).
 */
const seed = readSeed();
const L = seed.listings;

test.beforeEach(async ({ page }) => {
  await mockGeo(page);
});

test('mot-clé depuis l\'accueil : « QUOI ? » ne renvoie que les annonces correspondantes', async ({ page }) => {
  await page.goto('/');
  await expectNoHorizontalOverflow(page);
  await page.getByPlaceholder('QUOI ?').fill('playstation');
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page).toHaveURL(/\/recherche\?.*q=playstation/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('playstation');
  await expect(page.getByRole('link', { name: L.ps5.title, exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: L.vtt.title, exact: true })).toHaveCount(0);
  await expect(page.getByText(/^1 annonce/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('filtre catégorie : la catégorie Vélos ne montre que le VTT et le fil d\'Ariane la nomme', async ({ page }) => {
  await page.goto('/recherche?category=velos');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vélos');
  await expect(page.getByRole('navigation', { name: "Fil d'Ariane" })).toContainText('Loisirs');
  await expect(page.getByRole('link', { name: L.vtt.title, exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: L.ps5.title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: L.canape.title, exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('« Toute la France » : sans localisation, les annonces de toutes les villes sont listées', async ({ page }) => {
  await page.goto('/recherche');
  await expect(page.getByText('· Toute la France')).toBeVisible();
  for (const key of ['vtt', 'ps5', 'poussette', 'canape', 'tondeuse']) {
    await expect(page.getByRole('link', { name: L[key].title, exact: true }).first()).toBeVisible();
  }
});

test('rayon en kilomètres autour de Lyon : 5 km inclut Villeurbanne, 1 km ne garde que le 3e, tri par distance', async ({ page }) => {
  await page.goto('/');
  const where = page.getByPlaceholder('OÙ ?');
  await where.fill('Lyon');
  await page.getByRole('option', { name: 'Lyon (69003)' }).click();
  // Panneau de rayon à la leboncoin : 5 km par défaut, paliers exacts
  const panel = page.getByTestId('radius-panel');
  await expect(panel).toContainText('Dans un rayon de 5 km');
  await panel.getByRole('button', { name: 'Valider' }).click();
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page).toHaveURL(/radius=5/);
  await expect(page.getByText('· Lyon (5 km)')).toBeVisible();
  await expect(page.getByRole('link', { name: L.vtt.title, exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: L.poussette.title, exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: L.ps5.title, exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: L.canape.title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: L.tondeuse.title, exact: true })).toHaveCount(0);
  // Tri par distance : le 3e (0 km) avant le 7e (~2 km) avant Villeurbanne (~4 km)
  const titles = await page.locator('article a[class*="title"]').allTextContents();
  expect(titles.indexOf(L.vtt.title)).toBeLessThan(titles.indexOf(L.poussette.title));
  expect(titles.indexOf(L.poussette.title)).toBeLessThan(titles.indexOf(L.ps5.title));

  // Réduction à 1 km depuis le panneau des filtres
  const filtersBtn = page.getByRole('button', { name: /^Filtres/ });
  if (await filtersBtn.isVisible()) await filtersBtn.click();
  await page.getByLabel('Localisation', { exact: true }).click();
  // Clic réel (pas JS) : le panneau ne doit pas bouger entre l'appui et le relâchement
  await page.getByTestId('radius-panel').getByRole('button', { name: '1 km', exact: true }).click();
  await expect(page.getByTestId('radius-panel')).toContainText('Dans un rayon de 1 km');
  await expect(page).toHaveURL(/radius=1(&|$)/);
  await expect(page.getByText('· Lyon (1 km)')).toBeVisible();
  await expect(page.getByRole('link', { name: L.vtt.title, exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: L.poussette.title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: L.ps5.title, exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('tri par prix croissant puis décroissant : toute la liste est ordonnée', async ({ page }) => {
  const prices = async () => {
    const texts = await page.locator('article [class*="price"]').allTextContents();
    return texts.map((t) => Number(t.replace(/[^\d]/g, ''))).filter((n) => n > 0);
  };
  const sorted = (arr: number[], dir: 1 | -1) => arr.every((v, i) => i === 0 || (dir === 1 ? v >= arr[i - 1] : v <= arr[i - 1]));

  await page.goto('/recherche');
  const sort = page.getByRole('combobox', { name: 'Tri' });
  await sort.selectOption('price_asc');
  await expect(page).toHaveURL(/sort=price_asc/);
  await expect(page.locator('article').first()).toContainText(L.tondeuse.title);
  await expect.poll(async () => sorted(await prices(), 1), { message: 'prix croissants' }).toBe(true);
  expect((await prices()).length).toBeGreaterThanOrEqual(5);

  await sort.selectOption('price_desc');
  await expect(page).toHaveURL(/sort=price_desc/);
  await expect(page.locator('article').first()).toContainText(L.vtt.title);
  await expect.poll(async () => sorted(await prices(), -1), { message: 'prix décroissants' }).toBe(true);
});
