import { expect, test } from '@playwright/test';
import { api, expectNoHorizontalOverflow, expectSafeMargins, mockGeo, readSeed } from './helpers';

/**
 * Panneau « Tous les filtres » généralisé (bureau : colonne ; mobile : volet), bandeau livraison,
 * sections de découverte en bas des pages de catégorie, barre des familles (mega-menu, bureau),
 * pied de page structuré, consultation sans connexion (note du vendeur, action → connexion).
 */
const seed = readSeed();
const L = seed.listings;

test.beforeEach(async ({ page }) => {
  await mockGeo(page);
});

test('panneau « Tous les filtres » : ordre des blocs, tri, dons, type de vendeurs avec compteurs, urgentes, Tout effacer et Rechercher (N)', async ({ page, isMobile }) => {
  await page.goto('/recherche?category=loisirs');
  if (isMobile) {
    await page.getByRole('button', { name: /^Filtres/ }).click();
    await expect(page.getByRole('dialog', { name: 'Tous les filtres' })).toBeVisible();
  }
  const panel = isMobile ? page.getByRole('dialog', { name: 'Tous les filtres' }) : page.getByRole('complementary', { name: 'Tous les filtres' });
  // Ordre : Catégories, Localisation, Étendre à la livraison, Prix, Dons uniquement, Tri, Type de vendeurs, Annonces urgentes
  const labels = await panel.locator('label[for], .label, legend').allTextContents();
  const cleaned = labels.map((t) => t.trim());
  const order = ['Catégories', 'Localisation', 'Étendre à la livraison', 'Prix', 'Tri', 'Type de vendeurs', 'Annonces urgentes'];
  let last = -1;
  for (const o of order) {
    const idx = cleaned.findIndex((t) => t.startsWith(o));
    expect(idx, `bloc « ${o} » présent et dans l'ordre`).toBeGreaterThan(last);
    last = idx;
  }
  await expect(panel.getByLabel('Catégories')).toHaveValue('loisirs');
  await expect(panel.getByText('Catégorie active : Loisirs')).toBeVisible();
  await expect(panel.getByLabel('Prix minimum')).toBeVisible();
  await expect(panel.getByLabel('Prix maximum')).toBeVisible();

  // Tri : choix unique, cinq libellés
  const tri = panel.getByRole('group', { name: 'Tri' });
  for (const l of ['Pertinence', 'Plus récentes', 'Plus anciennes', 'Prix croissants', 'Prix décroissants']) await expect(tri.getByRole('radio', { name: l })).toBeVisible();
  await expect(tri.getByRole('radio', { name: 'Plus récentes' })).toBeChecked();
  await tri.getByRole('radio', { name: 'Prix croissants' }).click();
  await expect(page).toHaveURL(/sort=price_asc/);

  // Type de vendeurs : deux cases cochées par défaut, compteurs affichés
  const vendeurs = panel.getByRole('group', { name: 'Type de vendeurs' });
  await expect(vendeurs.getByRole('checkbox', { name: /^Particuliers/ })).toBeChecked();
  await expect(vendeurs.getByRole('checkbox', { name: /^Professionnels/ })).toBeChecked();
  await expect(vendeurs.getByText(/Particuliers \(\d+\)/)).toBeVisible();
  await expect(vendeurs.getByText(/Professionnels \(\d+\)/)).toBeVisible();
  await vendeurs.getByRole('checkbox', { name: /^Professionnels/ }).click();
  await expect(page).toHaveURL(/seller_type=particulier/);

  // Dons uniquement et Annonces urgentes uniquement
  await panel.getByRole('checkbox', { name: 'Dons uniquement' }).click();
  await expect(page).toHaveURL(/price_type=gratuit/);
  await panel.getByRole('checkbox', { name: 'Annonces urgentes uniquement' }).click();
  await expect(page).toHaveURL(/urgent=true/);

  // Rechercher (N) suit le nombre d'annonces ; Tout effacer remet à zéro (le mot-clé est gardé)
  await expect(panel.getByRole('button', { name: /^Rechercher \(\d+\)$/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Tout effacer' }).click();
  await expect(page).toHaveURL(/\/recherche$/);
  if (isMobile) {
    await page.getByRole('button', { name: /^Filtres/ }).click();
    await expect(page.getByRole('dialog', { name: 'Tous les filtres' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('dialog', { name: 'Tous les filtres' }).getByRole('button', { name: /^Rechercher/ }).click();
    await expect(page.getByRole('dialog', { name: 'Tous les filtres' })).toHaveCount(0);
  }
  await expectNoHorizontalOverflow(page);
});

test('livraison : bandeau explicatif, puce retirable et périmètre « Autour de … / France » (étendre à la livraison)', async ({ page }) => {
  // Une annonce livrable à Paris, créée par le vendeur du seed (le seed n'en contient aucune)
  const login = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const livrable = await api<{ id: string; title: string }>('/listings', {
    method: 'POST',
    token: login.accessToken,
    body: { title: 'Fauteuil livrable partout ' + Date.now().toString().slice(-5), description: 'Fauteuil en bon état, envoi possible dans toute la France, emballage soigné.', categorySlug: 'ameublement', price: 120, priceType: 'fixe', condition: 'bon_etat', city: 'Paris', postalCode: '75011', latitude: 48.8566, longitude: 2.3522, deliveryAvailable: true },
  });
  await page.goto('/recherche?delivery=true&city=Lyon');
  const banner = page.getByTestId('delivery-banner');
  await expect(banner).toContainText('Livraison :');
  await expect(banner.getByRole('button', { name: 'Retirer le filtre Livraison acceptée' })).toBeVisible();
  const scope = banner.getByRole('group', { name: 'Périmètre de la livraison' });
  await expect(scope.getByRole('button', { name: 'Autour de Lyon' })).toHaveAttribute('aria-pressed', 'true');
  await scope.getByRole('button', { name: 'France' }).click();
  await expect(page).toHaveURL(/delivery_anywhere=true/);
  await expect(page.getByText('+ livraison partout en France')).toBeVisible();
  // Le fauteuil de Paris est livrable : il apparaît avec le périmètre France, pas avec « Autour de Lyon »
  await expect(page.getByRole('link', { name: livrable.title, exact: true }).first()).toBeVisible();
  await scope.getByRole('button', { name: 'Autour de Lyon' }).click();
  await expect(page).not.toHaveURL(/delivery_anywhere/);
  await expect(page.getByRole('link', { name: livrable.title, exact: true })).toHaveCount(0);
  await banner.getByRole('button', { name: 'Retirer le filtre Livraison acceptée' }).click();
  await expect(page.getByTestId('delivery-banner')).toHaveCount(0);
  await expect(page).not.toHaveURL(/delivery=/);
});

test('bas de page de catégorie : recherches suggérées, localisations les plus demandées cliquables, fil d\'Ariane ; pagination numérotée', async ({ page }) => {
  await page.goto('/recherche?category=velos');
  const discover = page.getByTestId('discover');
  await expect(discover.getByRole('heading', { name: 'Les utilisateurs recherchent aussi…' })).toBeVisible();
  await expect(discover.getByRole('heading', { name: 'Localisations les plus demandées…' })).toBeVisible();
  await expect(discover.getByRole('link', { name: 'Vélos VTT' })).toHaveAttribute('href', '/recherche?category=velos&attr.type_velo=VTT');
  const lyon = discover.getByRole('link', { name: /^Lyon/ });
  await expect(lyon).toBeVisible();
  const crumbs = discover.getByRole('navigation', { name: 'Chemin de la catégorie' });
  await expect(crumbs).toContainText('Accueil › Loisirs › Vélos');
  await lyon.click();
  await expect(page).toHaveURL(/category=velos&city=Lyon/);
  await expect(page.getByRole('link', { name: L.vtt.title, exact: true }).first()).toBeVisible();
  // Pagination numérotée : présente dès qu'il y a plus d'une page (une seule page ici → absente)
  await page.goto('/recherche?page_size=2');
  const pagination = page.getByRole('navigation', { name: /Pagination/i });
  await expect(pagination.getByRole('link', { name: '2' }).or(pagination.getByRole('button', { name: '2' }))).toBeVisible();
  await expect(pagination.getByRole('button', { name: /Suivant/ }).or(pagination.getByRole('link', { name: /Suivant/ }))).toBeVisible();
});

test('barre des familles (bureau) : chaque famille ouvre un panneau de sous-catégories en colonnes, fermé par Échap', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Sur mobile, les catégories sont dans le menu principal (accordéon).');
  await page.goto('/');
  const bar = page.getByRole('navigation', { name: 'Familles de catégories' });
  await expect(bar).toBeVisible();
  for (const name of ['Immobilier', 'Véhicules', 'Matériel pro', 'Emploi', 'Mode', 'Maison & Jardin', 'Famille', 'Électronique', 'Loisirs', 'Services', 'Animaux']) {
    await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await bar.getByRole('button', { name: 'Véhicules', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Sous-catégories de Véhicules' });
  await expect(panel).toBeVisible();
  for (const c of ['Voitures', 'Motos', 'Utilitaires', 'Caravaning', 'Nautisme']) await expect(panel.getByRole('link', { name: c })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Tout Véhicules' })).toHaveAttribute('href', '/recherche?category=vehicules');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await bar.getByRole('button', { name: 'Services', exact: true }).hover();
  await expect(page.getByRole('region', { name: 'Sous-catégories de Services' }).locator('ul')).toHaveCount(2); // 15 sous-catégories → 2 colonnes
  await page.getByRole('region', { name: 'Sous-catégories de Services' }).getByRole('link', { name: 'Cours particuliers' }).click();
  await expect(page).toHaveURL(/category=cours-particuliers/);
});

test('pied de page en quatre colonnes avec des liens qui aboutissent ; pas d\'avis ni d\'applications inventés', async ({ page }) => {
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  for (const h of ['À propos', 'Informations légales', 'Nos solutions pros', 'Des questions ?']) await expect(footer.getByRole('heading', { name: h })).toBeVisible();
  await expect(footer).not.toContainText(/Trustpilot|App Store|Google Play/);
  await expect(footer).toContainText('© 2026');
  const hrefs = await footer.getByRole('link').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') || ''));
  expect(hrefs.length).toBeGreaterThanOrEqual(16);
  for (const href of hrefs) {
    const res = await page.request.get(href);
    expect(res.status(), `lien ${href}`).toBe(200);
  }
  await footer.getByRole('link', { name: 'Accessibilité' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Accessibilité');
  await expectSafeMargins(page);
});

test('visiteur non connecté : annonces complètes (note du vendeur, badges), seule une action demande la connexion', async ({ page }) => {
  await page.goto(`/annonces/${L.vtt.id}`);
  // Fiche entière visible : titre, prix, vendeur avec sa note, aucun mur de connexion
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(L.vtt.title);
  await expect(page.getByText(/Membre depuis/)).toBeVisible();
  await expect(page.getByRole('img', { name: /avis/ }).first()).toBeVisible();
  await expect(page).not.toHaveURL(/connexion/);
  // Contacter → connexion avec retour vers l'annonce
  await page.getByRole('button', { name: 'Contacter le vendeur' }).click();
  await expect(page).toHaveURL(new RegExp(`/connexion\\?next=.*annonces.*${L.vtt.id}`));
  // Favori depuis une carte de résultats → connexion aussi, la liste restait consultable avant
  await page.goto('/recherche');
  await expect(page.getByRole('link', { name: L.vtt.title, exact: true }).first()).toBeVisible();
  await page.locator('article').filter({ hasText: L.vtt.title }).first().getByRole('button', { name: /favori/i }).click();
  await expect(page).toHaveURL(/\/connexion\?next=/);
});
