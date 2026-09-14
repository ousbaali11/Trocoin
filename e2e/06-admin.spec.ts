import { expect, test } from '@playwright/test';
import { loginAs, readSeed } from './helpers';

/** Back-office : connexion admin, refus d'une annonce avec motif, traitement d'un signalement. */
const seed = readSeed();

test('connexion admin, refus d\'une annonce : motif transmis, annonce retirée du site', async ({ page }) => {
  await loginAs(page, seed.admin, '/admin');
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  await expect(page.locator('.admin-topbar')).toContainText("CONSOLE D'ADMINISTRATION");

  await page.goto(`/admin/annonces/${seed.listings.tondeuse.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(seed.listings.tondeuse.title);
  // Refus impossible sans motif
  await expect(page.getByRole('button', { name: 'Refuser' })).toBeDisabled();
  await page.getByPlaceholder(/^Motif/).fill('Photos absentes et prix incohérent avec la description.');
  await page.getByRole('button', { name: 'Refuser' }).click();
  await expect(page.getByText('Annonce refusée.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Refusée');
  await expect(page.getByText('Motif enregistré : Photos absentes et prix incohérent')).toBeVisible();

  // Côté site : l'annonce n'est plus dans les résultats et sa page l'annonce au vendeur
  await page.goto('/recherche?q=tondeuse');
  await expect(page.getByText(/^0 annonce/)).toBeVisible();
  await page.goto('/admin/journal');
  await expect(page.locator('table')).toContainText('listing');
});

test('un signalement déposé par un membre est traité par l\'admin avec retrait de l\'annonce', async ({ browser }) => {
  // Le membre signale l'annonce depuis sa page
  const memberCtx = await browser.newContext();
  const member = await memberCtx.newPage();
  await loginAs(member, seed.buyer, `/annonces/${seed.listings.canape.id}`);
  await member.getByRole('button', { name: 'Signaler', exact: true }).click();
  const dialog = member.getByRole('dialog', { name: 'Signaler cette annonce' });
  await dialog.getByLabel('Motif').selectOption('annonce_mensongere');
  await dialog.getByLabel(/Précisions/).fill('Le canapé est visiblement déchiré sur les photos, contrairement au texte.');
  await dialog.getByRole('button', { name: 'Envoyer le signalement' }).click();
  await expect(member.getByText('Merci, votre signalement a été transmis à notre équipe.')).toBeVisible();
  await memberCtx.close();

  // L'admin le voit dans la file et le traite en retirant l'annonce
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await loginAs(admin, seed.admin, '/admin/signalements');
  const card = admin.locator('.a-panel', { hasText: seed.listings.canape.title });
  await expect(card).toContainText('Annonce mensongère');
  await expect(card).toContainText('Le canapé est visiblement déchiré');
  await card.getByRole('combobox').selectOption('retirer_annonce');
  await card.getByPlaceholder(/^Note/).fill('Annonce retirée : description trompeuse.');
  await card.getByRole('button', { name: 'Traiter' }).click();
  await expect(admin.getByText('Signalement traité.')).toBeVisible();
  await expect(admin.getByText('Aucun signalement ouvert : la file est vide.')).toBeVisible();

  // L'annonce a bien été retirée
  await admin.goto(`/admin/annonces/${seed.listings.canape.id}`);
  await expect(admin.getByRole('heading', { level: 1 })).not.toContainText('En ligne');
  await admin.goto('/recherche?q=canapé');
  await expect(admin.getByText(/^0 annonce/)).toBeVisible();
  await adminCtx.close();
});
