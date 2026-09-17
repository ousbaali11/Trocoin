import { expect, test } from '@playwright/test';
import { api, readSeed } from './helpers';

/**
 * Référencement : sitemap et robots cohérents, titres et descriptions propres à chaque page,
 * données structurées JSON-LD valides (annonce : Product + fil d'Ariane ; accueil : WebSite).
 */
const seed = readSeed();

test('sitemap.xml : accueil, recherche, familles et sous-catégories, articles d\'aide, pages légales, annonces récentes', async ({ request, baseURL }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(baseURL!, ''));
  for (const must of ['', '/recherche', '/aide', '/aide/paiement-securise', '/aide/creer-un-compte', '/cgu', '/confidentialite', '/mentions-legales', '/a-propos', '/recherche?category=vehicules', '/recherche?category=voitures', '/recherche?category=velos']) {
    expect(urls, `sitemap doit contenir ${must || '/'}`).toContain(must);
  }
  // Les annonces récentes sont listées (le cache de données de Next peut retenir une liste antérieure quelques minutes : on vérifie la présence d'annonces, pas un identifiant précis)
  expect(urls.filter((u) => /^\/annonces\/[0-9a-f-]{36}$/.test(u)).length).toBeGreaterThan(0);
  // Rien de privé
  expect(urls.filter((u) => /^\/(compte|admin|connexion|deposer)/.test(u))).toEqual([]);
  expect(urls.length).toBeGreaterThan(80);
});

test('robots.txt : espaces privés exclus, sitemap déclaré', async ({ request }) => {
  const txt = await (await request.get('/robots.txt')).text();
  for (const line of ['Allow: /', 'Disallow: /admin', 'Disallow: /compte', 'Disallow: /connexion', 'Disallow: /deposer', 'Sitemap:']) expect(txt).toContain(line);
});

test('titres et descriptions uniques par page ; pages privées non indexées', async ({ page }) => {
  const seen = new Map<string, string>();
  for (const [url, mustIndex] of [['/', true], ['/recherche', true], ['/recherche?category=velos', true], ['/aide', true], ['/aide/litige', true], ['/cgu', true], ['/mentions-legales', true], ['/a-propos', true], [`/annonces/${seed.listings.vtt.id}`, true], [`/vendeurs/${seed.seller.id}`, true], ['/connexion', false], ['/inscription', false], ['/mot-de-passe-oublie', false], ['/deposer', false]] as const) {
    await page.goto(url);
    await page.waitForLoadState('networkidle').catch(() => null);
    const title = await page.title();
    // Les métadonnées peuvent être diffusées après la coquille : on lit la première balise en place
    const desc = (await page.locator('meta[name="description"]').first().getAttribute('content')) || '';
    const robotsMeta = page.locator('meta[name="robots"]');
    const robots = (await robotsMeta.count()) ? (await robotsMeta.first().getAttribute('content')) || '' : '';
    expect(title, `titre de ${url}`).toMatch(/\S/);
    expect(desc.length, `description de ${url}`).toBeGreaterThan(30);
    const key = `${title} | ${desc}`;
    expect(seen.has(key), `${url} partage titre + description avec ${seen.get(key)}`).toBe(false);
    seen.set(key, url);
    if (!mustIndex) expect(robots, `${url} doit être noindex`).toMatch(/noindex/);
    else expect(robots).not.toMatch(/noindex/);
  }
  await page.goto('/recherche?category=velos');
  await expect(page).toHaveTitle(/Vélos : annonces d'occasion \(Loisirs\)/);
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toMatch(/\/recherche\?category=velos$/);
});

test('JSON-LD de l\'annonce : Product complet et fil d\'Ariane ; accueil : WebSite avec action de recherche', async ({ page }) => {
  await page.goto(`/annonces/${seed.listings.vtt.id}`);
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const data = blocks.flatMap((b) => { const j = JSON.parse(b); return Array.isArray(j) ? j : [j]; });
  const product = data.find((d) => d['@type'] === 'Product');
  expect(product).toBeTruthy();
  expect(product.name).toBe(seed.listings.vtt.title);
  expect(product.sku).toBe(seed.listings.vtt.id);
  expect(product.url).toMatch(new RegExp(`/annonces/${seed.listings.vtt.id}$`));
  expect(product.offers['@type']).toBe('Offer');
  expect(product.offers.price).toBe(890);
  expect(product.offers.priceCurrency).toBe('EUR');
  expect(product.offers.availability).toBe('https://schema.org/InStock');
  expect(product.offers.seller.name).toBe(seed.seller.displayName);
  const crumbs = data.find((d) => d['@type'] === 'BreadcrumbList');
  // Fil d'Ariane complet depuis le 16 septembre 2026 : région et département dérivés du code postal (69003)
  expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Accueil', 'Loisirs', 'Vélos', 'Auvergne-Rhône-Alpes', 'Rhône', 'Lyon', seed.listings.vtt.title]);
  expect(crumbs.itemListElement.map((i: { position: number }) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);

  await page.goto('/');
  const home = (await page.locator('script[type="application/ld+json"]').allTextContents()).flatMap((b) => JSON.parse(b));
  const site = home.find((d: { '@type': string }) => d['@type'] === 'WebSite');
  expect(site.potentialAction.target.urlTemplate).toMatch(/\/recherche\?q=\{search_term_string\}$/);
  expect(home.find((d: { '@type': string }) => d['@type'] === 'Organization')).toBeTruthy();
});

test("JSON-LD de l'annonce : livraison et politique de retour réelles, visibles sur la page ; jamais de GTIN, marque, avis ou note fabriqués (AUDIT §52)", async ({ page }) => {
  const token = (await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } })).accessToken;
  const base = { description: 'Article en très bon état, remis propre et complet, visible sur rendez-vous.', categorySlug: 'ameublement', price: 40, priceType: 'fixe', condition: 'tres_bon_etat', city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.85 };
  const stamp = Date.now().toString().slice(-5);
  const shipped = await api<{ id: string }>('/listings', { method: 'POST', token, body: { ...base, title: `Lampe de bureau articulée ${stamp}`, deliveryAvailable: true, weightGrams: 800 } });
  const handOnly = await api<{ id: string }>('/listings', { method: 'POST', token, body: { ...base, title: `Armoire normande massive ${stamp}`, deliveryAvailable: false } });
  const productOf = async (id: string) => {
    await page.goto(`/annonces/${id}`);
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    return blocks.flatMap((b) => { const j = JSON.parse(b); return Array.isArray(j) ? j : [j]; }).find((d) => d['@type'] === 'Product');
  };
  try {
    // Annonce livrable, poids déclaré : destination, délais réels (7 jours pour expédier, 2 à 4 jours de transport), fourchette estimée
    const a = await productOf(shipped.id);
    expect(a.offers.shippingDetails).toEqual({
      '@type': 'OfferShippingDetails',
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'FR' },
      deliveryTime: { '@type': 'ShippingDeliveryTime', handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 7, unitCode: 'DAY' }, transitTime: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 4, unitCode: 'DAY' } },
      shippingRate: { '@type': 'MonetaryAmount', currency: 'EUR', minValue: 5.49, maxValue: 7.95 },
    });
    expect(a.offers.availableDeliveryMethod).toEqual(['https://schema.org/OnSitePickup', 'https://schema.org/ParcelService']);
    expect(a.offers.hasMerchantReturnPolicy).toEqual({ '@type': 'MerchantReturnPolicy', applicableCountry: 'FR', returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted' });
    const blockA = page.getByTestId('delivery-returns');
    await expect(blockA).toContainText('Le vendeur expédie sous 7 jours après le paiement, puis comptez 2 à 4 jours de transport');
    await expect(blockA).toContainText(/Envoi estimé entre 5,49\s€ et 7,95\s€ d'après le poids déclaré \(800 g\)/);
    await expect(blockA).toContainText('Vente entre particuliers : pas de droit de retour ni de rétractation');

    // Remise en main propre seule : « pas d'expédition » explicite, aucun coût ni délai
    const b = await productOf(handOnly.id);
    expect(b.offers.shippingDetails).toEqual({ '@type': 'OfferShippingDetails', doesNotShip: true, shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'FR' } });
    expect(b.offers.availableDeliveryMethod).toBe('https://schema.org/OnSitePickup');
    expect(b.offers.hasMerchantReturnPolicy.returnPolicyCategory).toBe('https://schema.org/MerchantReturnNotPermitted');
    await expect(page.getByTestId('delivery-returns')).toContainText("Remise en main propre uniquement : ce vendeur n'expédie pas cet article");

    // Champs volontairement absents : rien n'est fabriqué pour faire taire une alerte
    for (const product of [a, b]) {
      const json = JSON.stringify(product);
      for (const key of ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'mpn', 'brand', 'review', 'aggregateRating']) expect(json).not.toContain(`"${key}"`);
    }
  } finally {
    for (const l of [shipped, handOnly]) await api(`/listings/${l.id}`, { method: 'DELETE', token }).catch(() => undefined);
  }
});
