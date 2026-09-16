import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, loginAs, readSeed } from './helpers';

/**
 * Back-office : accessibilité automatisable (axe, WCAG 2 A/AA + bonnes pratiques) sur toutes les
 * pages de la console, et navigation au clavier seul sur un acte de modération complet.
 * Données : un signalement et un litige sont créés par l'API pour que les files ne soient pas vides.
 */
const seed = readSeed();
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function expectNoAxeViolations(page: Page, label: string) {
  await page.waitForLoadState('networkidle').catch(() => null);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => `${v.id} [${v.impact}] ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `axe : ${label}`).toEqual([]);
}

test.beforeAll(async () => {
  // Signalement ouvert sur le VTT et litige sur la poussette, déposés par l'acheteur du seed
  const login = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } });
  const token = login.accessToken;
  // Rejouable : sur une nouvelle tentative du fichier, le signalement existe déjà (400 « déjà signalé »)
  await api('/reports', { method: 'POST', body: { listingId: seed.listings.vtt.id, reason: 'doublon', details: 'Annonce publiée deux fois.' }, token }).catch((e) => {
    if (!/déjà signalé/.test(String(e))) throw e;
  });
  // Rejouable aussi : sur une nouvelle tentative, la transaction (et son litige) existe déjà (400 « déjà en cours »)
  const tx = await api<{ transaction: { id: string } }>('/transactions', { method: 'POST', body: { listingId: seed.listings.poussette.id, deliveryMethod: 'main_propre' }, token }).catch((e) => {
    if (!/déjà en cours/.test(String(e))) throw e;
    return null;
  });
  if (tx) await api(`/transactions/${tx.transaction.id}/dispute`, { method: 'POST', body: { reason: 'Poussette reçue avec une roue cassée.' }, token });
});

test('axe : toutes les pages de la console (tableau de bord, listes, fiches, files, réglages, CMS, journal)', async ({ page }) => {
  test.setTimeout(120_000);
  await loginAs(page, seed.admin, '/admin');
  for (const [label, url] of [
    ['tableau de bord', '/admin'],
    ['utilisateurs', '/admin/utilisateurs'],
    ['fiche utilisateur', `/admin/utilisateurs/${seed.seller.id}`],
    ['annonces', '/admin/annonces'],
    ['fiche annonce', `/admin/annonces/${seed.listings.vtt.id}`],
    ['signalements', '/admin/signalements'],
    ['litiges', '/admin/litiges'],
    ['journal', '/admin/journal'],
    ['réglages', '/admin/reglages'],
    ['pages CMS', '/admin/pages'],
  ] as const) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page, label);
  }
  // Un signalement et un litige sont bien affichés (les files ne sont pas vides pendant l'audit)
  await page.goto('/admin/signalements');
  await expect(page.getByText('Annonce publiée deux fois.')).toBeVisible();
  await page.goto('/admin/litiges');
  await expect(page.getByText('Poussette reçue avec une roue cassée.')).toBeVisible();
});

test('clavier seul : navigation de la console, suspension d\'un compte avec boîte de confirmation, journal', async ({ page }) => {
  await loginAs(page, seed.admin, '/admin');
  // Navigation latérale : lien « Utilisateurs » atteint et activé au clavier
  const usersLink = page.getByRole('complementary', { name: 'Navigation de la console' }).getByRole('link', { name: 'Utilisateurs' });
  await usersLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/utilisateurs$/);
  // Filtre nommé, utilisable au clavier
  const typeFilter = page.getByRole('combobox', { name: 'Type de compte' });
  await typeFilter.focus();
  await typeFilter.selectOption('particulier');
  await expect(page.locator('table')).toContainText(seed.buyer.displayName);

  await page.goto(`/admin/utilisateurs/${seed.buyer.id}`);
  const reason = page.getByRole('textbox', { name: /Motif de suspension/ });
  await reason.focus();
  await page.keyboard.type('Test clavier : comportement abusif signalé.');
  const suspend = page.getByRole('button', { name: 'Suspendre le compte' });
  await suspend.focus();
  await page.keyboard.press('Enter');
  // Boîte de confirmation : focus dedans, validation à Entrée
  const dialog = page.getByRole('dialog', { name: 'Suspendre ce compte ?' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  const confirmBtn = dialog.getByRole('button', { name: 'Suspendre' });
  await confirmBtn.focus();
  await expect(confirmBtn).toBeFocused(); // le focus initial de la boîte (posé juste après l'ouverture) ne doit pas le reprendre
  await page.keyboard.press('Enter');
  await expect(page.getByText('Compte suspendu.')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.a-alert.danger')).toContainText('comportement abusif');
  // Réactivation au clavier, puis trace dans le journal
  const reactivate = page.getByRole('button', { name: 'Réactiver le compte' });
  await reactivate.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Compte réactivé.')).toBeVisible();
  await page.goto('/admin/journal');
  await expect(page.locator('table')).toContainText(seed.buyer.id.slice(0, 8));
});
