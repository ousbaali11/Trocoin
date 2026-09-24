import { expect, test } from '@playwright/test';
import { api, loginAs, readSeed } from './helpers';

/**
 * Audit admin (étapes 2 et 3) : navigation regroupée, suppression définitive d'une annonce puis d'un
 * compte avec motif et saisie du mot SUPPRIMER, fiche détaillée d'une transaction avec décision forcée
 * hors litige, traces dans le journal d'audit consultable.
 */
const seed = readSeed();
type Login = { accessToken: string; user: { id: string } };
const PASSWORD = 'MotDePasse!E2E-42';

test('colonne de navigation : le bas (Retour au site, compte, Se déconnecter) reste atteignable en la faisant défiler, fenêtre de 900, 700 et 600 px de haut, page courte et page longue (AUDIT §50)', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'bureau : sur mobile la colonne devient un bandeau horizontal');
  await loginAs(page, seed.admin, '/admin');
  for (const path of ['/admin', '/admin/journal']) {
    for (const height of [900, 700, 600]) {
      await page.setViewportSize({ width: 1280, height });
      await page.goto(path);
      const aside = page.getByRole('complementary', { name: 'Navigation de la console' });
      await expect(aside).toBeVisible();
      const logoutBtn = aside.getByRole('button', { name: 'Se déconnecter' });
      // La colonne défile elle-même : molette dessus, puis le bouton est entièrement dans la fenêtre
      await aside.hover({ position: { x: 100, y: 100 } });
      await page.mouse.wheel(0, 4000);
      await logoutBtn.scrollIntoViewIfNeeded();
      const box = (await logoutBtn.boundingBox())!;
      expect(box.y, `haut du bouton à ${height}px sur ${path}`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `bas du bouton à ${height}px sur ${path}`).toBeLessThanOrEqual(height);
      await expect(aside.getByRole('link', { name: '← Retour au site public' })).toBeInViewport();
      expect(await aside.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
    }
  }
});

test('navigation regroupée par domaine, compteurs et retour au site', async ({ page }) => {
  await loginAs(page, seed.admin, '/admin');
  const nav = page.getByRole('complementary', { name: 'Navigation de la console' });
  await expect(nav.locator('.admin-nav-title')).toHaveText(["Vue d'ensemble", 'Comptes', 'Annonces', 'Transactions', 'Configuration', 'Traçabilité']);
  // Les entrées de file de travail portent un compteur (annonces à vérifier, signalements, litiges + séquestres à échéance) selon l'état de la base
  await expect(nav.getByRole('link')).toHaveText([/^Tableau de bord$/, /^Utilisateurs$/, /^Annonces\d*$/, /^Signalements\d*$/, /^Transactions et litiges\d*$/, /^Monétisation et formules$/, /^Pages légales \(CMS\)$/, /^Catalogue de démonstration$/, /^Journal d'audit$/, /^← Retour au site public$/]);
  await expect(nav.getByRole('link', { name: 'Tableau de bord' })).toHaveAttribute('aria-current', 'page');
});

test('suppression définitive d\'une annonce : motif obligatoire, mot SUPPRIMER exigé, annonce effacée, vendeur prévenu, journal', async ({ page }) => {
  const seller = await api<Login>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const listing = await api<{ id: string; title: string }>('/listings', { method: 'POST', token: seller.accessToken, body: { title: 'Sac de marque contrefait', description: 'Sac imitation cuir, logo de grande marque reproduit, jamais porté.', categorySlug: 'ameublement', price: 60, priceType: 'fixe', condition: 'neuf', city: 'Lyon', postalCode: '69003' } });
  await loginAs(page, seed.admin, `/admin/annonces/${listing.id}`);
  await page.getByTestId('delete-listing').click();
  const dialog = page.getByRole('dialog', { name: 'Supprimer définitivement cette annonce ?' });
  await expect(dialog).toBeVisible();
  const submit = dialog.getByTestId('hard-delete-submit');
  await expect(submit).toBeDisabled();
  await dialog.getByTestId('hard-delete-reason').fill('Contrefaçon signalée par la marque');
  await expect(submit).toBeDisabled(); // le motif seul ne suffit pas
  await dialog.getByTestId('hard-delete-confirm').fill('supprimer');
  await expect(submit).toBeDisabled(); // casse exacte exigée
  await dialog.getByTestId('hard-delete-confirm').fill('SUPPRIMER');
  await submit.click();
  await expect(page).toHaveURL(/\/admin\/annonces$/);
  expect((await api<Response>(`/listings/${listing.id}`).catch((e) => e)).message).toMatch(/404/);
  await page.goto(`/admin/journal?target=${listing.id}`);
  await expect(page.locator('table')).toContainText('listing.delete');
  await expect(page.locator('table')).toContainText('Contrefaçon signalée par la marque');
});

test('fiche détaillée d\'une transaction : décision forcée hors litige (annulation), note transmise, journal lié ; puis suppression définitive d\'un compte', async ({ page }) => {
  // Un vendeur et un acheteur créés pour ce scénario (le compte sera supprimé)
  const id = Date.now().toString(36);
  const mk = async (tag: string) => {
    const phone = '06' + String((Date.now() % 90000000) + (tag === 'v' ? 1 : 2)).padStart(8, '0');
    const r = await api<Login>('/auth/register', { method: 'POST', body: { accountType: 'particulier', firstName: 'Cas', lastName: tag === 'v' ? 'Vendeur' : 'Acheteur', username: `cas_${tag}_${id}`, email: `cas.${tag}.${id}@e2e.test`, phoneNumber: phone, password: PASSWORD, passwordConfirmation: PASSWORD } });
    return { ...r, email: `cas.${tag}.${id}@e2e.test` };
  };
  const seller = await mk('v');
  const buyer = await mk('a');
  const listing = await api<{ id: string }>('/listings', { method: 'POST', token: seller.accessToken, body: { title: 'Casque audio sans fil', description: 'Casque en bon etat, autonomie correcte, housse fournie pour le transport.', categorySlug: 'image-son', price: 45, priceType: 'fixe', condition: 'bon_etat', city: 'Lyon', postalCode: '69003' } });
  const tx = await api<{ transaction: { id: string } }>('/transactions', { method: 'POST', token: buyer.accessToken, body: { listingId: listing.id } });

  await loginAs(page, seed.admin, `/admin/litiges/${tx.transaction.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Transaction');
  await expect(page.getByText('Décision forcée hors litige')).toBeVisible();
  await page.getByTestId('decision-note').fill('Vendeur injoignable, acheteur remboursé');
  await page.getByTestId('decide-cancel').click();
  await page.getByRole('dialog', { name: 'Annuler la vente et rembourser l\'acheteur ?' }).getByRole('button', { name: 'Annuler la vente' }).click();
  await expect(page.getByText('Décision appliquée.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Annulée');
  await expect(page.getByTestId('tx-audit')).toContainText('transaction.cancel');
  const txView = await api<{ status: string; resolutionNote: string }>(`/transactions/${tx.transaction.id}`, { token: buyer.accessToken });
  expect(txView.status).toBe('annulee');
  expect(txView.resolutionNote).toBe('Vendeur injoignable, acheteur remboursé');

  // Suppression définitive du vendeur depuis sa fiche
  await page.goto(`/admin/utilisateurs/${seller.user.id}`);
  await page.getByTestId('delete-user').click();
  const dialog = page.getByRole('dialog', { name: 'Supprimer définitivement ce compte ?' });
  await dialog.getByTestId('hard-delete-reason').fill('Fraude avérée : vendeur fantôme');
  await dialog.getByTestId('hard-delete-confirm').fill('SUPPRIMER');
  await dialog.getByTestId('hard-delete-submit').click();
  await expect(page).toHaveURL(/\/admin\/utilisateurs$/);
  await expect(page.getByText(/Compte supprimé/).first()).toBeVisible();
  // Effets : connexion impossible, profil disparu, trace dans le journal
  const refused = await api('/auth/login', { method: 'POST', body: { identifier: seller.email, password: PASSWORD } }).catch((e) => e as Error);
  expect(String((refused as Error).message)).toMatch(/401|403/);
  expect(String((await api(`/users/${seller.user.id}/profile`).catch((e) => e as Error) as Error).message)).toMatch(/404/);
  await page.goto(`/admin/journal?target=${seller.user.id}`);
  await expect(page.locator('table')).toContainText('user.delete');
  await expect(page.locator('table')).toContainText('Fraude avérée : vendeur fantôme');
});
