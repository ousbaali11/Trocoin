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

test('« Toute la France » : choisi depuis l\'accueil, affiché dans le champ « OÙ ? », et les annonces de toutes les villes sont listées', async ({ page }) => {
  await page.goto('/');
  const where = page.getByPlaceholder('OÙ ?');
  await where.click();
  await page.getByRole('dialog', { name: 'Menu des localisations' }).getByRole('button', { name: 'Toute la France' }).click();
  await expect(where).toHaveValue('Toute la France');
  await expect(page.getByRole('button', { name: 'Effacer la localisation' })).toBeVisible();
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page).toHaveURL(/\/recherche(\?.*)?$/);
  expect(page.url()).not.toMatch(/city|lat=|radius=/);
  await expect(page.getByText('· Toute la France')).toBeVisible();
  for (const key of ['vtt', 'ps5', 'poussette', 'canape', 'tondeuse']) {
    await expect(page.getByRole('link', { name: L[key].title, exact: true }).first()).toBeVisible();
  }
  // Sans choix explicite, la recherche nationale reste le défaut
  await page.goto('/recherche');
  await expect(page.getByText('· Toute la France')).toBeVisible();
  await expect(page.getByRole('link', { name: L.canape.title, exact: true }).first()).toBeVisible();
});

test('rayon en kilomètres autour de Lyon : 5 km inclut Villeurbanne, 1 km ne garde que le 3e, tri par distance', async ({ page }) => {
  await page.goto('/');
  const where = page.getByPlaceholder('OÙ ?');
  await where.fill('Lyon');
  await page.getByRole('button', { name: 'Lyon (69003)' }).click();
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

test("carte d'annonce : hiérarchie leboncoin (titre 16 px gras, prix 16 px gras foncé, cœur 32 px à 8 px du coin, lieu + date de dépôt)", async ({ page }) => {
  await page.goto('/recherche');
  const card = page.locator('article').filter({ hasText: L.vtt.title }).first();
  await expect(card).toBeVisible();
  const style = (sel: string) => card.locator(sel).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: cs.fontSize, weight: cs.fontWeight, color: cs.color };
  });
  const ink = 'rgb(31, 41, 55)';
  expect(await style('a[class*="title"]')).toEqual({ size: '16px', weight: '700', color: ink });
  // Le prix n'est plus ni vert ni surdimensionné : même corps que le titre, foncé, gras
  expect(await style('[class*="price"]')).toEqual({ size: '16px', weight: '700', color: ink });
  await expect(card.locator('[class*="price"]')).toHaveText('890 €');
  const fav = card.getByRole('button', { name: 'Ajouter aux favoris' });
  const heart = (await fav.boundingBox())!;
  const media = (await card.locator('a[class*="media"]').boundingBox())!;
  expect([Math.round(heart.width), Math.round(heart.height)]).toEqual([32, 32]);
  // 8 px du coin de la photo (± 1 px : arrondis de sous-pixel pendant l'animation d'apparition)
  expect(Math.abs(media.x + media.width - (heart.x + heart.width) - 8)).toBeLessThanOrEqual(1);
  expect(Math.abs(heart.y - media.y - 8)).toBeLessThanOrEqual(1);
  const foot = card.locator('[class*="foot"]');
  await expect(foot.locator('[class*="place"]:not([class*="placeholder"])')).toHaveText('Lyon 69003');
  await expect(foot.locator('[class*="date"]')).toHaveText(/^aujourd'hui à \d{2}:\d{2}$/);
  const muted = await style('[class*="date"]');
  expect(muted).toEqual({ size: '12px', weight: '400', color: 'rgb(95, 107, 120)' });
});

test("en-tête bureau sur une seule ligne à 1280, 1440 et 1920 px, libellés visibles ; barre d'accueil réduite", async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'bureau uniquement');
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const header = page.locator('header');
    const box = (await header.boundingBox())!;
    expect(box.height, `hauteur de l'en-tête à ${width}px`).toBeLessThan(80);
    // Tous les éléments alignés sur la même ligne : même ordonnée de centre (± 4 px)
    const items = [header.locator('a[title="Accueil"]'), header.getByRole('button', { name: 'Catégories' }), header.getByRole('combobox', { name: 'Rechercher une annonce' }), header.getByRole('link', { name: 'Mes recherches' }), header.getByRole('link', { name: 'Favoris' }), header.getByRole('link', { name: 'Messages' }), header.getByRole('link', { name: 'Se connecter' }), header.getByRole('link', { name: 'Déposer une annonce' })];
    const centers: number[] = [];
    for (const it of items) {
      await expect(it).toBeVisible();
      const b = (await it.boundingBox())!;
      centers.push(b.y + b.height / 2);
    }
    expect(Math.max(...centers) - Math.min(...centers), `alignement à ${width}px`).toBeLessThan(4);
    for (const label of ['Mes recherches', 'Favoris', 'Messages', 'Catégories']) await expect(header.getByText(label, { exact: true })).toBeVisible();
    // L'invite de la recherche compacte n'est pas tronquée : largeur du texte < largeur utile du champ
    const fits = await header.getByRole('combobox', { name: 'Rechercher une annonce' }).evaluate((el: HTMLInputElement) => {
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return ctx.measureText(el.placeholder).width < el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    });
    expect(fits, `invite « Rechercher » entière à ${width}px`).toBe(true);
    await expectNoHorizontalOverflow(page);
  }
  // Barre « QUOI ? / OÙ ? » : ≤ 720 px de large et ≤ 52 px de haut, textes d'invite lisibles
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const form = page.getByRole('search', { name: 'Rechercher une annonce' });
  const fb = (await form.boundingBox())!;
  expect(fb.width).toBeLessThanOrEqual(720);
  expect(fb.height).toBeLessThanOrEqual(52);
  for (const ph of ['QUOI ?', 'OÙ ?']) {
    const input = page.getByPlaceholder(ph);
    expect(await input.evaluate((el: HTMLInputElement) => el.clientWidth > 80 && getComputedStyle(el).fontSize >= '14px')).toBe(true);
  }
});

test('cartes réduites : au plus 200 px de large, 4 colonnes ou plus sur bureau, 2 sur mobile, texte sans débordement', async ({ page, isMobile }) => {
  await page.goto('/recherche');
  const card = page.locator('article').first();
  await expect(card).toBeVisible();
  const b = (await card.boundingBox())!;
  const cols = await page.locator('.grid-cards').first().evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
  if (isMobile) {
    expect(cols).toBe(2);
  } else {
    expect(b.width).toBeLessThanOrEqual(215);
    expect(b.height).toBeLessThanOrEqual(340);
    expect(cols).toBeGreaterThanOrEqual(4);
  }
  expect(await card.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('10px');
  // Aucun texte ne déborde de sa carte
  const overflow = await card.evaluate((el) => [...el.querySelectorAll('a, span, div')].some((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow === 'visible' && getComputedStyle(n).display !== '-webkit-box'));
  expect(overflow).toBe(false);
});
