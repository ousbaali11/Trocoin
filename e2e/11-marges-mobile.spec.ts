import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, expectSafeMargins, loginAs, readSeed } from './helpers';

/**
 * Marges de sécurité sur mobile (360 → 414 px) : aucun titre, carte, champ ou bouton ne touche le
 * bord de l'écran (≥ 12 px), aucun défilement horizontal, et le bandeau d'onglets du compte garde
 * son premier onglet entièrement visible avec une marge de fin de liste.
 */
const seed = readSeed();
const ACCOUNT_PAGES = ['/compte', '/compte/annonces', '/compte/messages', '/compte/notifications', '/compte/favoris', '/compte/recherches', '/compte/historique', '/compte/transactions', '/compte/avis', '/compte/formule', '/compte/paiements', '/compte/parametres'];
const PUBLIC_PAGES = ['/', '/recherche', '/a-propos', '/aide', '/connexion', '/inscription', `/annonces/${seed.listings.vtt.id}`];

test.describe('marges mobiles', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile uniquement');

  for (const width of [360, 375, 390, 414]) {
    test(`pages publiques à ${width} px : marge ≥ 12 px, pas de défilement horizontal`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const path of PUBLIC_PAGES) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expectSafeMargins(page);
        await expectNoHorizontalOverflow(page);
      }
    });
  }

  test('pages du compte à 375 px : marge ≥ 12 px, onglets jamais coupés, dernier onglet avec marge de fin', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginAs(page, seed.seller, '/compte');
    for (const path of ACCOUNT_PAGES) {
      await test.step(path, async () => {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expectSafeMargins(page);
        await expectNoHorizontalOverflow(page);
      });
    }
    // Sur le tableau de bord, le bandeau est en position initiale : le premier onglet est entier et à distance du bord
    await page.goto('/compte');
    await page.waitForLoadState('networkidle');
    const nav = page.getByRole('navigation', { name: 'Mon compte' });
    const first = nav.getByRole('link', { name: 'Tableau de bord' });
    const firstBox = (await first.boundingBox())!;
    expect(firstBox.x, 'premier onglet à distance du bord gauche').toBeGreaterThanOrEqual(12);
    // Défilement jusqu'au bout : le dernier onglet s'arrête à distance du bord droit
    await nav.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(200);
    const last = nav.getByRole('link', { name: 'Paramètres' });
    const lastBox = (await last.boundingBox())!;
    expect(375 - (lastBox.x + lastBox.width), 'dernier onglet à distance du bord droit').toBeGreaterThanOrEqual(12);
  });
});
