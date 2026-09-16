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
  await expect(page.getByText(/\d+ annonces · Toute la France/).first()).toBeVisible();
  for (const key of ['vtt', 'ps5', 'poussette', 'canape', 'tondeuse']) {
    await expect(page.getByRole('link', { name: L[key].title, exact: true }).first()).toBeVisible();
  }
  // Sans choix explicite, la recherche nationale reste le défaut
  await page.goto('/recherche');
  await expect(page.getByText(/\d+ annonces · Toute la France/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: L.canape.title, exact: true }).first()).toBeVisible();
});

test('rayon en kilomètres autour de Lyon : 5 km inclut Villeurbanne, 1 km ne garde que le 3e, tri par distance', async ({ page }) => {
  await page.goto('/');
  const where = page.getByPlaceholder('OÙ ?');
  await where.fill('Lyon');
  // Lyon regroupe ses arrondissements : « toute la ville » d'abord, puis le sous-menu déplié
  await expect(page.getByRole('button', { name: 'Lyon (toute la ville)' })).toBeVisible();
  await page.getByRole('button', { name: 'Arrondissements de Lyon' }).click();
  await page.getByRole('button', { name: 'Lyon 3e (69003)' }).click();
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

test("carte d'annonce « fiche » Trocoin : prix sous la photo dans le bloc de texte, cœur à cheval sur le cadre, titre 15 px, lieu · date en pied", async ({ page }) => {
  await page.goto('/recherche');
  const card = page.locator('article').filter({ hasText: L.vtt.title }).first();
  await expect(card).toBeVisible();
  // Les mesures attendent la fin de l'animation d'apparition des cartes (translation + léger agrandissement)
  await card.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  const style = (sel: string) => card.locator(sel).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: cs.fontSize, weight: cs.fontWeight, color: cs.color, family: cs.fontFamily };
  });
  const ink = 'rgb(31, 41, 55)';
  // Titre : Public Sans 15 px demi-gras, encre ; deux lignes maximum
  const title = await style('a[class*="title"]');
  expect([title.size, title.weight, title.color]).toEqual(['15.04px', '600', ink]);
  expect(title.family.toLowerCase()).toContain('public sans');
  // Prix : sous la photo, dans le bloc de texte après le titre (plus d'incrustation sur l'image), en Fraunces
  const price = card.getByTestId('card-price');
  await expect(price).toHaveText('890 €');
  const priceStyle = await style('[data-testid="card-price"]');
  expect(priceStyle.family.toLowerCase()).toContain('fraunces');
  expect(priceStyle.color).toBe(ink);
  const media = (await card.locator('a[class*="media"]').boundingBox())!;
  const pb = (await price.boundingBox())!;
  const tb = (await card.locator('a[class*="title"]').boundingBox())!;
  expect(pb.y).toBeGreaterThanOrEqual(media.y + media.height); // entièrement hors de la photo
  expect(pb.y).toBeGreaterThanOrEqual(tb.y + tb.height - 1); // après le titre
  expect(await card.locator('a[class*="media"] [data-testid="card-price"]').count()).toBe(0);
  // Cœur : 32 px, à cheval sur le bord bas droit du cadre photo (centre à ± 4 px du bord bas)
  const fav = card.getByRole('button', { name: 'Ajouter aux favoris' });
  const heart = (await fav.boundingBox())!;
  expect([Math.round(heart.width), Math.round(heart.height)]).toEqual([32, 32]);
  expect(Math.abs(heart.y + heart.height / 2 - (media.y + media.height))).toBeLessThanOrEqual(4);
  expect(media.x + media.width - (heart.x + heart.width)).toBeGreaterThanOrEqual(6);
  // Pied : lieu · date, en 12 px gris
  const foot = card.locator('[class*="foot"]');
  await expect(foot.locator('[class*="place"]:not([class*="placeholder"])')).toHaveText('Lyon 69003');
  await expect(foot.locator('[class*="date"]')).toHaveText(/^aujourd'hui à \d{2}:\d{2}$/);
  const muted = await style('[class*="date"]');
  expect([muted.size, muted.weight, muted.color]).toEqual(['12px', '400', 'rgb(95, 107, 120)']);
  // Photo carrée encadrée de 6 px, coins 12 px
  const cardBox = (await card.boundingBox())!;
  expect(Math.round(media.x - cardBox.x)).toBe(6);
  expect(Math.abs(media.width - media.height)).toBeLessThanOrEqual(1);
  expect(await card.locator('a[class*="media"]').evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px');
});

test("en-tête bureau sur une seule rangée à 1280, 1440 et 1920 px : marque, Catégories, recherche, liens et dépôt alignés ; barre d'accueil réduite (AUDIT §47)", async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'bureau uniquement');
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const header = page.locator('header');
    const box = (await header.boundingBox())!;
    expect(box.height, `hauteur de l'en-tête à ${width}px`).toBeLessThan(70);
    // Une seule rangée : logo, Catégories, recherche, liens personnels (icône au-dessus du libellé), connexion, dépôt — mêmes centres (± 6 px)
    const top = [header.locator('a[title="Accueil"]'), header.getByRole('button', { name: 'Catégories' }), header.getByRole('combobox', { name: 'Rechercher une annonce' }), header.getByRole('link', { name: 'Mes recherches' }), header.getByRole('link', { name: 'Favoris' }), header.getByRole('link', { name: 'Messages' }), header.getByRole('link', { name: 'Se connecter' }), header.getByRole('link', { name: 'Déposer une annonce' })];
    const centers: number[] = [];
    for (const it of top) {
      await expect(it).toBeVisible();
      const b = (await it.boundingBox())!;
      centers.push(b.y + b.height / 2);
    }
    expect(Math.max(...centers) - Math.min(...centers), `rangée unique alignée à ${width}px`).toBeLessThan(6);
    // Recherche resserrée mais utilisable ; les boutons de droite gardent leur taille (40 px de haut)
    const search = (await header.getByRole('combobox', { name: 'Rechercher une annonce' }).boundingBox())!;
    // Le conteneur est plafonné à 1180 px : la recherche fait ~200–240 px quelle que soit la fenêtre (polices de secours plus larges sur Linux en CI)
    expect(search.width, `largeur de la recherche à ${width}px`).toBeGreaterThan(190);
    expect(search.width).toBeLessThanOrEqual(520);
    for (const name of ['Se connecter', 'Déposer une annonce']) expect((await header.getByRole('link', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(40);
    for (const label of ['Mes recherches', 'Favoris', 'Messages', 'Catégories']) await expect(header.getByText(label, { exact: true })).toBeVisible();
    // L'invite de la recherche n'est pas tronquée
    const fits = await header.getByRole('combobox', { name: 'Rechercher une annonce' }).evaluate((el: HTMLInputElement) => {
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return ctx.measureText(el.placeholder).width < el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    });
    expect(fits, `invite « Rechercher » entière à ${width}px`).toBe(true);
    // Une seule action verte dans l'en-tête : « Déposer une annonce »
    const greens = await header.locator('.btn-primary').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.textContent?.trim()));
    expect(greens.filter((t) => t && !/^$/.test(t))).toEqual(['Déposer une annonce']);
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

test('cartes réduites : au plus 215 px de large, 4 colonnes ou plus sur bureau, 2 sur mobile, coins 16 px, texte sans débordement', async ({ page, isMobile }) => {
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
  expect(await card.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('16px');
  // Aucun texte ne déborde de sa carte
  const overflow = await card.evaluate((el) => [...el.querySelectorAll('a, span, div')].some((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow === 'visible' && getComputedStyle(n).display !== '-webkit-box'));
  expect(overflow).toBe(false);
});

test('localisation : arrondissements de Paris regroupés sous « toute la ville », et communes récentes proposées avant la saisie', async ({ page }) => {
  await page.goto('/');
  const where = page.getByPlaceholder('OÙ ?');
  await where.fill('Paris');
  // Une seule entrée pour Paris, ses arrondissements dans un sous-menu (comme sur leboncoin)
  await expect(page.getByRole('button', { name: 'Paris (toute la ville)' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Paris \d+e? \(750\d\d\)$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Arrondissements de Paris' }).click();
  const sub = page.getByRole('list', { name: 'Arrondissements de Paris' });
  await expect(sub.getByRole('button')).toHaveText(['Paris 1er (75001)', 'Paris 11e (75011)', 'Paris 20e (75020)']);
  await sub.getByRole('button', { name: 'Paris 11e (75011)' }).click();
  await expect(page.getByTestId('radius-panel')).toContainText('Paris (75011)');
  await page.getByTestId('radius-panel').getByRole('button', { name: 'Valider' }).click();
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page).toHaveURL(/city_label=Paris/);

  // Retour à l'accueil : la commune vient d'être utilisée, elle est proposée en « Récents » avant de taper
  await page.goto('/');
  await page.getByPlaceholder('OÙ ?').focus();
  await expect(page.getByText('Récents')).toBeVisible();
  const recent = page.getByTestId('recent-location');
  await expect(recent).toHaveCount(1);
  await expect(recent.first()).toHaveText(/Paris \(75011\)/);
  await recent.first().click();
  await expect(page.getByTestId('radius-panel')).toContainText('Paris (75011)');
});
