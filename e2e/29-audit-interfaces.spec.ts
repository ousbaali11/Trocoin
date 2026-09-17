import { expect, test } from '@playwright/test';
import { API, api, expectNoHorizontalOverflow, loginAs, readSeed } from './helpers';

/**
 * Audit général des interfaces (AUDIT §60) — défauts relevés en parcourant toutes les pages à 1280 et 375 px :
 *  - fiche annonce sur téléphone : « Contacter » et « Acheter » étaient à quatre écrans de défilement → barre fixe ;
 *  - console d'administration sur téléphone : bandeau de 120 px de haut, quatorze chiffres empilés un par ligne ;
 *  - squelette de chargement infini quand une requête échoue → message et « Réessayer » ;
 *  - sous-catégories de la recherche : boutons de 24 px de haut.
 */
const seed = readSeed();

test("fiche annonce : barre d'action fixe sur téléphone, absente sur grand écran", async ({ page, isMobile }) => {
  const seller = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const listing = await api<{ id: string }>('/listings', { method: 'POST', token: seller.accessToken, body: { title: `Lampe de bureau articulée ${Date.now().toString().slice(-5)}`, description: 'Lampe de bureau articulée en métal noir, ampoule fournie, très bon état, remise en main propre à Lyon.', categorySlug: 'decoration', price: 25, priceType: 'fixe', condition: 'tres_bon_etat', city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.85 } });
  await loginAs(page, seed.buyer, `/annonces/${listing.id}`);
  const bar = page.getByTestId('listing-bar');
  if (!isMobile) {
    await expect(page.getByRole('button', { name: /^Acheter · / })).toBeVisible();
    await expect(bar).toBeHidden();
    return;
  }
  // En haut de la page, le bloc d'actions est hors écran : la barre porte le prix et les deux actions
  await expect(bar).toHaveAttribute('data-hidden', 'false');
  await expect(bar).toContainText(/25\s€/);
  const box = (await bar.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height - 4);
  await expectNoHorizontalOverflow(page);
  // Le vrai bloc d'actions à l'écran → la barre s'efface (jamais deux jeux de boutons)
  await page.getByRole('button', { name: /^Acheter · / }).scrollIntoViewIfNeeded();
  await expect(bar).toHaveAttribute('data-hidden', 'true');
  await expect(bar).toBeHidden();
  // Retour en haut : « Acheter » de la barre ouvre la fenêtre de paiement, et la barre se range derrière elle
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar).toHaveAttribute('data-hidden', 'false');
  await bar.getByRole('button', { name: 'Acheter' }).click();
  await expect(page.getByRole('dialog', { name: 'Paiement sécurisé' })).toBeVisible();
  await expect(bar).toHaveAttribute('data-hidden', 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
  await api(`/listings/${listing.id}`, { method: 'DELETE', token: seller.accessToken });
});

test('console d\'administration : bandeau compact et chiffres sur deux colonnes sur téléphone', async ({ page, isMobile }) => {
  await loginAs(page, seed.admin, '/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();
  const stats = page.locator('.a-stat');
  await expect(stats.first()).toBeVisible();
  if (isMobile) {
    const nav = (await page.locator('.admin-side').boundingBox())!;
    expect(nav.height).toBeLessThanOrEqual(64);
    const [a, b] = [(await stats.nth(0).boundingBox())!, (await stats.nth(1).boundingBox())!];
    expect(Math.round(a.y)).toBe(Math.round(b.y)); // deux cartes sur la même ligne
    await expectNoHorizontalOverflow(page);
  }
  await page.goto('/admin/annonces');
  const search = page.getByRole('searchbox', { name: 'Rechercher une annonce' });
  await expect(search).toBeVisible();
  // Une seule requête pour une frappe continue (avant : une par caractère)
  let calls = 0;
  page.on('request', (r) => { if (r.url().includes('/admin/listings?') && r.url().includes('q=')) calls += 1; });
  await search.pressSequentially('Rockrider', { delay: 30 });
  await expect(page.locator('.a-table tbody tr')).toHaveCount(1);
  expect(calls).toBeLessThanOrEqual(2);
  if (isMobile) await expectNoHorizontalOverflow(page);
});

test('échec de chargement : « Réessayer » au lieu d\'un squelette sans fin', async ({ page }) => {
  await loginAs(page, seed.seller, '/compte');
  let fail = true;
  await page.route(`${API}/listings/mine`, (route) => (fail ? route.abort() : route.continue()));
  await page.goto('/compte/annonces');
  const error = page.getByTestId('load-error');
  await expect(error).toContainText('Impossible de charger vos annonces.');
  fail = false;
  await error.getByRole('button', { name: 'Réessayer' }).click();
  await expect(error).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0);
});

test('recherche : sous-catégories de hauteur tactile', async ({ page }) => {
  await page.goto('/recherche?category=vehicules');
  const chip = page.getByRole('button', { name: 'Voitures', exact: true });
  await expect(chip).toBeVisible();
  expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(36);
});
