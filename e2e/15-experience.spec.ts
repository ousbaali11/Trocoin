import { expect, test } from '@playwright/test';
import { api, expectNoHorizontalOverflow, loginAs, mockGeo, readSeed } from './helpers';

/**
 * Expérience « plus dynamique et plus claire » (docs/design-system.md) : suggestions pendant la
 * frappe (annonces, catégories, communes, recherches récentes), aperçu rapide d'une carte au
 * clic long, mega-menu et menu mobile animés, dépôt avec barre de progression, catégorie
 * suggérée, estimation de prix en direct, checklist actionnable, actions groupées et appareils.
 */
const seed = readSeed();
const L = seed.listings;

test.beforeEach(async ({ page }) => {
  await mockGeo(page);
});

test('recherche : suggestions pendant la frappe (annonce, catégorie, commune) puis recherches récentes proposées avant de taper', async ({ page }) => {
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Rechercher une annonce' }).first();
  await box.fill('vtt');
  const list = page.getByRole('listbox', { name: 'Suggestions de recherche' });
  await expect(list).toBeVisible();
  await expect(list.getByTestId('suggestion-titre').first()).toContainText(/VTT/);
  await box.fill('vélo');
  await expect(list.getByTestId('suggestion-categorie').first()).toContainText('Vélos');
  await box.fill('Lyon');
  await expect(list.getByTestId('suggestion-commune').first()).toContainText('Lyon');
  // Recherche lancée → mémorisée dans ce navigateur, proposée au prochain focus
  await box.fill('playstation');
  await box.press('Enter');
  await expect(page).toHaveURL(/q=playstation/);
  await page.goto('/');
  const box2 = page.getByRole('combobox', { name: 'Rechercher une annonce' }).first();
  await box2.focus();
  await expect(page.getByText('Vos recherches récentes')).toBeVisible();
  await expect(page.getByTestId('suggestion-recente').first()).toContainText('playstation');
  await page.getByTestId('suggestion-recente').first().click();
  await expect(page).toHaveURL(/q=playstation/);
});

test("carte : clic long à la souris ouvre l'aperçu rapide, un clic simple ouvre la fiche", async ({ page, isMobile }) => {
  test.skip(isMobile, 'aperçu rapide à la souris uniquement');
  await page.goto('/recherche');
  const card = page.locator('article').filter({ hasText: L.vtt.title }).first();
  const media = card.locator('a[class*="media"]');
  const box = (await media.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  const preview = page.getByTestId('quick-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('890 €');
  await expect(page).toHaveURL(/\/recherche/);
  await preview.getByRole('button', { name: 'Fermer' }).click();
  await expect(preview).toHaveCount(0);
  await media.click();
  await expect(page).toHaveURL(new RegExp(`/annonces/${L.vtt.id}`));
});

test('menus animés : le panneau Catégories de l\'en-tête apparaît avec une transition et se referme sans apparition brute', async ({ page, isMobile }) => {
  test.skip(isMobile, 'bureau');
  await page.goto('/');
  await page.getByRole('button', { name: 'Catégories' }).click();
  const mega = page.getByRole('menu').first();
  await expect(mega).toBeVisible();
  expect(await mega.evaluate((el) => getComputedStyle(el).animationName)).toBe('menu-in');
  await expect(mega.getByRole('menuitem', { name: 'Loisirs' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Pendant la sortie, l'élément reste monté avec l'animation de fermeture, puis disparaît
  await expect.poll(async () => (await page.getByRole('menu').count()) === 0 || (await page.getByRole('menu').first().evaluate((el) => getComputedStyle(el).animationName)) === 'menu-out').toBe(true);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('menu mobile : ouverture et fermeture avec transition, contenu complet', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile');
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.locator('#mobile-menu');
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((el) => getComputedStyle(el).animationName)).toMatch(/slide-down-in$/);
  await expect(menu.getByRole('link', { name: 'Déposer une annonce' })).toBeVisible();
  await expect(menu.getByText('Catégories')).toBeVisible();
  // Catégories du menu mobile : une seule colonne pleine largeur (familles et sous-catégories alignées à gauche)
  await menu.locator('summary', { hasText: 'Catégories' }).click();
  const lefts = await menu.locator('details a').evaluateAll((els) => els.slice(0, 12).map((a) => Math.round(a.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
  await expect(menu.getByRole('link', { name: 'Consoles & jeux vidéo' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('dépôt : barre de progression, catégorie suggérée d\'après le titre, estimation de prix en direct, checklist avec actions', async ({ page }) => {
  // L'estimation demande au moins 3 annonces comparables : on complète le VTT du seed par trois vélos (700, 900 et 1 100 €)
  const login = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const extra: Array<{ id: string }> = [];
  for (const [title, price] of [['Vélo de route carbone taille 54', 700], ['VTT enfant 24 pouces', 900], ['Vélo électrique de ville', 1100]] as const) {
    extra.push(await api<{ id: string }>('/listings', { method: 'POST', token: login.accessToken, body: { title, description: "Vélo de test pour l'estimation de prix, description assez longue.", categorySlug: 'velos', price, priceType: 'fixe', condition: 'bon_etat', city: 'Lyon', postalCode: '69003', attributes: { type_velo: 'VTT' } } }));
  }
  await loginAs(page, seed.seller, '/deposer');
  const progress = page.getByTestId('deposit-progress');
  await expect(progress).toContainText('Étape 1 sur 5');
  await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await page.getByLabel('Titre').fill(`VTT électrique Rockrider taille L ${Date.now().toString().slice(-4)}`);
  const suggestions = page.getByTestId('category-suggestions');
  await expect(suggestions).toContainText('Vélos');
  await suggestions.getByRole('button', { name: /Vélos/ }).click();
  await expect(page.getByRole('radio', { name: 'Vélos' })).toBeChecked();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(progress).toContainText('Étape 2 sur 5');
  await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  // Estimation de prix : la jauge apparaît (un VTT existe dans le seed) et le verdict suit le prix tapé
  const estimate = page.getByTestId('price-estimate');
  await expect(estimate).toBeVisible();
  await expect(estimate.getByTestId('price-verdict')).toHaveAttribute('data-verdict', 'aucun');
  await page.getByLabel(/^Prix/).fill('50');
  await expect(estimate.getByTestId('price-verdict')).toHaveAttribute('data-verdict', 'bas');
  await expect(estimate.getByTestId('price-marker')).toBeVisible();
  await page.getByLabel(/^Prix/).fill('850');
  await expect(estimate.getByTestId('price-verdict')).toHaveAttribute('data-verdict', /ok|un-peu/);
  await page.getByLabel('Type *').selectOption('VTT');
  await page.getByLabel('Description').fill('Description courte.');
  await page.getByRole('button', { name: 'Continuer' }).click();
  // Étape Photos : rien d'autre que les photos (AUDIT §56) ; la checklist attend l'aperçu final
  await expect(progress).toContainText('Étape 3 sur 5');
  await expect(page.getByTestId('completeness')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Ville ou code postal').fill('69003');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Aperçu avant publication' })).toBeVisible();
  // Checklist : « Faire → » ramène au champ concerné
  const check = page.getByTestId('completeness');
  await expect(check).toContainText('Complétez la description');
  await check.getByTestId('completeness-description').click();
  await expect(progress).toContainText('Étape 2 sur 5');
  await expect(page.getByLabel('Description')).toBeFocused();
  for (const l of extra) await api(`/listings/${l.id}`, { method: 'DELETE', token: login.accessToken }).catch(() => undefined);
});

test('mes annonces : un particulier avec une annonce ne voit pas les actions groupées ; un compte avec plusieurs annonces les a (filtres, sélection, pause groupée)', async ({ page }) => {
  // L'acheteur du seed n'a aucune annonce : on lui en crée deux pour tester le mode groupé, et une seule au départ
  const login = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } });
  const mk = (title: string) => api<{ id: string }>('/listings', { method: 'POST', token: login.accessToken, body: { title, description: 'Annonce de test pour les actions groupées, description assez longue.', categorySlug: 'ameublement', price: 40, priceType: 'fixe', condition: 'bon_etat', city: 'Lyon', postalCode: '69003' } });
  const first = await mk('Chaise de bureau noire');
  await loginAs(page, seed.buyer, '/compte/annonces');
  await expect(page.getByTestId('my-listing')).toHaveCount(1);
  await expect(page.getByTestId('bulk-toggle')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Toutes/ })).toHaveCount(0);
  const second = await mk('Table basse en chêne');
  await page.reload();
  await expect(page.getByTestId('my-listing')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: /En ligne \(2\)/ })).toBeVisible();
  await page.getByTestId('bulk-toggle').click();
  const bar = page.getByTestId('bulk-bar');
  await bar.getByRole('button', { name: 'Tout sélectionner' }).click();
  await expect(bar).toContainText('2 sélectionnées');
  await bar.getByRole('button', { name: 'Mettre en pause (2)' }).click();
  await expect(page.getByText('2 annonces mise(s) en pause.')).toBeVisible();
  await page.getByRole('tab', { name: /En pause/ }).click();
  await expect(page.getByTestId('my-listing')).toHaveCount(2);
  // Nettoyage : suppression des deux annonces de test
  for (const l of [first, second]) await api(`/listings/${l.id}`, { method: 'DELETE', token: login.accessToken }).catch(() => undefined);
});

test('paramètres : appareils connectés listés, déconnexion de tous les appareils', async ({ page }) => {
  await loginAs(page, seed.buyer, '/compte/parametres');
  const section = page.locator('#appareils');
  await expect(section.getByRole('heading', { name: 'Appareils connectés' })).toBeVisible();
  await expect(section.getByTestId('sessions').getByRole('listitem').first()).toContainText(/Chrome|navigateur/);
  await section.getByRole('button', { name: 'Déconnecter tous les appareils' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tout déconnecter' }).click();
  await expect(page).toHaveURL(/\/$|\/connexion/);
});
