import { expect, test } from '@playwright/test';
import { readSeed } from './helpers';

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
  expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Accueil', 'Loisirs', 'Vélos', seed.listings.vtt.title]);
  expect(crumbs.itemListElement.map((i: { position: number }) => i.position)).toEqual([1, 2, 3, 4]);

  await page.goto('/');
  const home = (await page.locator('script[type="application/ld+json"]').allTextContents()).flatMap((b) => JSON.parse(b));
  const site = home.find((d: { '@type': string }) => d['@type'] === 'WebSite');
  expect(site.potentialAction.target.urlTemplate).toMatch(/\/recherche\?q=\{search_term_string\}$/);
  expect(home.find((d: { '@type': string }) => d['@type'] === 'Organization')).toBeTruthy();
});
