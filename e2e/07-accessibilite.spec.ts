import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { loginAs, mockGeo, readSeed } from './helpers';

/**
 * Accessibilité automatisable (axe-core, WCAG 2.0/2.1 A et AA + bonnes pratiques) :
 * contraste des couleurs, libellés manquants, noms accessibles, ordre des titres, points de
 * repère, attributs alt. Aucune violation tolérée : toute régression fait échouer la CI.
 * Le reste (clavier, lecteur d'écran) est couvert par 08-clavier.spec.ts et AUDIT.md §11.
 */
const seed = readSeed();
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function expectNoAxeViolations(page: Page, label: string) {
  await page.waitForLoadState('networkidle').catch(() => null);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => `${v.id} [${v.impact}] ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `axe : ${label}`).toEqual([]);
}

test.describe('Pages publiques', () => {
  test.beforeEach(async ({ page }) => mockGeo(page));

  for (const [label, url] of [
    ['accueil', '/'],
    ['résultats de recherche', '/recherche?q=console'],
    ['résultats par catégorie', '/recherche?category=velos'],
    ['inscription', '/inscription'],
    ['connexion', '/connexion'],
    ['mot de passe oublié', '/mot-de-passe-oublie'],
    ['centre d\'aide', '/aide'],
    ['article d\'aide', '/aide/paiement-securise'],
    ['CGU', '/cgu'],
    ['page introuvable', '/page-qui-n-existe-pas'],
  ] as const) {
    test(label, async ({ page }) => {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page, label);
    });
  }

  test("détail d'annonce et vitrine du vendeur", async ({ page }) => {
    await page.goto(`/annonces/${seed.listings.vtt.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(seed.listings.vtt.title);
    await expectNoAxeViolations(page, 'annonce');
    await page.goto(`/vendeurs/${seed.seller.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page, 'vendeur');
  });

  test('résultats avec le panneau de localisation ouvert et une boîte de dialogue', async ({ page }) => {
    await page.goto('/recherche?lat=45.764&lng=4.8357&radius=5&city_label=Lyon');
    await page.getByLabel('Localisation', { exact: true }).click();
    await expect(page.getByTestId('radius-panel')).toBeVisible();
    await expectNoAxeViolations(page, 'panneau de rayon');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Sauvegarder cette recherche/ }).click();
    await expect(page.getByRole('dialog', { name: 'Sauvegarder cette recherche' })).toBeVisible();
    await expectNoAxeViolations(page, 'modale de sauvegarde');
  });
});

test.describe('Espace compte', () => {
  test.beforeEach(async ({ page }) => mockGeo(page));

  test('tableau de bord, annonces, dépôt, favoris, messages, transactions, avis, paramètres, notifications', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, seed.seller);
    for (const [label, url] of [
      ['tableau de bord', '/compte'],
      ['mes annonces', '/compte/annonces'],
      ['dépôt', '/deposer'],
      ['favoris', '/compte/favoris'],
      ['messages', '/compte/messages'],
      ['achats et ventes', '/compte/transactions'],
      ['avis', '/compte/avis'],
      ['paramètres', '/compte/parametres'],
      ['notifications', '/compte/notifications'],
      ['mes recherches', '/compte/recherches'],
      ['historique', '/compte/historique'],
      ['formule', '/compte/formule'],
      ['paiements', '/compte/paiements'],
      ['boutique', '/compte/boutique'],
    ] as const) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page, label);
    }
  });

  test('formulaire de dépôt : étapes description et photos', async ({ page }) => {
    await loginAs(page, seed.seller, '/deposer');
    await page.getByRole('radio', { name: 'Voitures' }).check();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByLabel('Titre')).toBeVisible();
    await expectNoAxeViolations(page, 'dépôt étape description');
    await page.getByLabel('Titre').fill('Voiture pour test axe');
    await page.getByLabel(/^Prix/).fill('1000');
    await page.getByLabel('Description').fill('Description suffisamment longue pour passer.');
    await page.getByLabel('Marque *').fill('Renault');
    await page.getByLabel('Modèle *').fill('Clio');
    await page.getByLabel(/^Année/).fill('2018');
    await page.getByLabel(/^Kilométrage/).fill('90000');
    await page.getByLabel(/^Carburant/).selectOption('Essence');
    await page.getByLabel(/^Boîte/).selectOption('Manuelle');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.locator('input[type=file]').setInputFiles(seed.photos);
    await page.getByRole('button', { name: "Garder l'original" }).click();
    await expect(page.getByText('Couverture', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page, 'dépôt étape photos');
  });
});
