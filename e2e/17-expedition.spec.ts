import { expect, test } from '@playwright/test';
import { api, loginAs, mockGeo, readSeed } from './helpers';

/**
 * Étiquette d'envoi de bout en bout (fournisseur simulé de la pile e2e) : adresse de livraison saisie
 * par l'acheteur au paiement, panneau du vendeur (tarif, achat de l'étiquette, PDF, numéro repris),
 * échec géré proprement (adresse refusée par le transporteur : code postal 99999) sans bloquer la
 * vente, suivi visible côté acheteur.
 */
const seed = readSeed();

test.beforeEach(async ({ page }) => mockGeo(page));

async function sellerListing(title: string) {
  const login = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const listing = await api<{ id: string }>('/listings', { method: 'POST', token: login.accessToken, body: { title, description: 'Enceinte en très bon état, envoi soigné dans son carton d\'origine.', categorySlug: 'image-son', price: 60, priceType: 'fixe', condition: 'tres_bon_etat', city: 'Lyon', postalCode: '69003', deliveryAvailable: true, weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 } });
  return { listing, token: login.accessToken };
}

test("achat avec envoi : l'acheteur saisit son adresse, le vendeur obtient un tarif, achète l'étiquette, télécharge le PDF et confirme l'expédition ; l'acheteur suit le colis", async ({ page, browser }) => {
  const { listing } = await sellerListing(`Enceinte Bluetooth JBL Flip 6 ${Date.now().toString().slice(-4)}`);

  // Acheteur : paiement sécurisé avec adresse de livraison obligatoire
  await loginAs(page, seed.buyer, `/annonces/${listing.id}`);
  await page.getByRole('button', { name: /^Acheter/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Paiement sécurisé' });
  await dialog.getByLabel('Envoi par Mondial Relay').check();
  const pay = dialog.getByRole('button', { name: /^Payer/ });
  await expect(pay).toBeDisabled(); // adresse manquante
  await dialog.getByLabel('Nom et prénom').fill('Alex Acheteur');
  await dialog.getByLabel('Adresse', { exact: true }).fill('5 avenue des Ternes');
  await dialog.getByLabel('Code postal').fill('75017');
  await dialog.getByLabel('Ville').fill('Paris');
  // Lieu de réception (AUDIT §57) : ce que le transporteur propose autour de l'adresse — domicile, point relais,
  // bureau de poste ou consigne — avec les points réels du prestataire ; rien n'est payable sans ce choix
  const options = dialog.getByTestId('delivery-options');
  await expect(options).toBeVisible();
  await expect(pay).toBeDisabled();
  // Seul ce que le transporteur propose s'affiche : ici Mondial Relay ne livre pas à domicile, Colissimo oui
  await expect(options.getByLabel(/À domicile/)).toHaveCount(0);
  await dialog.getByLabel('Envoi par Colissimo').check();
  await expect(options.getByLabel(/À domicile/)).toBeVisible();
  await expect(options.getByLabel(/En bureau de poste ou consigne automatique \(locker\) \(2 à proximité\)/)).toBeVisible();
  await dialog.getByLabel('Envoi par Mondial Relay').check();
  await expect(options.getByLabel(/En point relais \(2 à proximité\)/)).toBeVisible();
  await options.getByLabel(/En consigne automatique \(locker\) \(1 à proximité\)/).check();
  await expect(pay).toBeDisabled(); // point à choisir
  await expect(options.getByTestId('pickup-point')).toHaveCount(1);
  await options.getByLabel(/En point relais/).check();
  await expect(options.getByTestId('pickup-point')).toHaveCount(2);
  await options.getByTestId('pickup-point').filter({ hasText: 'Point Relais Boulangerie Martin' }).getByRole('radio').check();
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect(page).toHaveURL(/\/compte\/transactions\/[0-9a-f-]{36}/);
  const txId = page.url().split('/').pop()!;
  await expect(page.getByText('Alex Acheteur')).toHaveCount(0); // l'acheteur voit sa propre adresse seulement dans le récapitulatif vendeur

  // Vendeur : panneau d'étiquette, adresse de l'acheteur préremplie, tarif, achat
  const sellerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  await mockGeo(seller);
  await loginAs(seller, seed.seller, `/compte/transactions/${txId}`);
  const panel = seller.getByTestId('shipment-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Poids du colis (g)')).toHaveValue('900');
  // Le bloc des adresses est déjà déplié quand une adresse manque ; on ne clique que s'il est replié
  if (!(await panel.locator('details').evaluate((d) => (d as HTMLDetailsElement).open))) await panel.locator('summary').click();
  await expect(panel.locator('#to-line1')).toHaveValue('5 avenue des Ternes');
  await expect(panel.locator('#to-cp')).toHaveValue('75017');
  await panel.locator('#from-line1').fill('12 rue de la République');
  await panel.locator('#from-cp').fill('69003');
  await panel.locator('#from-city').fill('Lyon');
  await panel.getByTestId('get-rates').click();
  const rates = panel.getByTestId('rates');
  await expect(rates).toContainText('Mondial Relay en point relais');
  await expect(rates).toContainText('5,49');
  // Le mode et le point choisis par l'acheteur sont repris tels quels : ni autre mode, ni liste de points à l'étiquette
  await expect(panel.getByTestId('ship-mode-fixed')).toContainText('point relais « Point Relais Boulangerie Martin »');
  await expect(rates).not.toContainText('à domicile');
  await expect(rates.getByLabel('Point relais', { exact: true })).toHaveCount(0);
  await expect(seller.getByTestId('buyer-delivery-choice')).toContainText('Point Relais Boulangerie Martin');
  await panel.getByTestId('buy-label').click();
  const ready = seller.getByTestId('shipment-ready');
  await expect(ready).toBeVisible();
  await expect(ready.getByTestId('shipment-tracking')).toHaveText(/^SIM\d{10}$/);
  // Téléchargement du PDF
  const [download] = await Promise.all([seller.waitForEvent('download'), ready.getByTestId('download-label').click()]);
  expect(download.suggestedFilename()).toMatch(/^etiquette-.*\.pdf$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe('%PDF-');
  // Le numéro est repris : « Confirmer l'expédition » sans saisie
  await expect(seller.getByLabel(/Numéro de suivi/)).toBeVisible();
  await seller.getByRole('button', { name: "Confirmer l'expédition" }).click();
  await expect(seller.getByText('Expédition enregistrée.')).toBeVisible();
  await sellerCtx.close();

  // Acheteur : statut et numéro de suivi
  await page.reload();
  const status = page.getByTestId('shipment-status');
  await expect(status).toBeVisible();
  await expect(status.getByTestId('tracking-number')).toHaveText(/^SIM\d{10}$/);
  await expect(status).toContainText('Mondial Relay');
  await expect(status.getByTestId('tracking-state')).toContainText('Étiquette créée');
  await expect(page.getByText(/^Expédié \(suivi SIM\d{10}\)/)).toBeVisible();
});

test("échec de l'étiquette : adresse refusée par le transporteur → message clair, nouvel essai possible, saisie manuelle du numéro toujours acceptée", async ({ page }) => {
  const { listing } = await sellerListing(`Enceinte à envoyer (échec) ${Date.now().toString().slice(-4)}`);
  const buyerLogin = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } });
  const created = await api<{ transaction: { id: string } }>('/transactions', { method: 'POST', token: buyerLogin.accessToken, body: { listingId: listing.id, deliveryMethod: 'colissimo', shippingAddress: { name: 'Alex Acheteur', line1: '5 avenue des Ternes', postalCode: '99999', city: 'Nulle part' } } });
  const txId = created.transaction.id;

  await loginAs(page, seed.seller, `/compte/transactions/${txId}`);
  const panel = page.getByTestId('shipment-panel');
  // Le bloc des adresses est déjà déplié quand une adresse manque ; on ne clique que s'il est replié
  if (!(await panel.locator('details').evaluate((d) => (d as HTMLDetailsElement).open))) await panel.locator('summary').click();
  await panel.locator('#from-line1').fill('12 rue de la République');
  await panel.locator('#from-cp').fill('69003');
  await panel.locator('#from-city').fill('Lyon');
  await panel.getByTestId('get-rates').click();
  await expect(panel.getByTestId('rates')).toContainText('Colissimo');
  await panel.getByTestId('buy-label').click();
  await expect(panel.getByTestId('shipment-error').first()).toContainText(/adresse du destinataire refusée/);
  // La vente n'est pas bloquée : saisie manuelle et confirmation possibles
  await expect(page.getByRole('button', { name: "Confirmer l'expédition" })).toBeVisible();
  await page.getByLabel(/Numéro de suivi/).fill('6A12345678901');
  await page.getByRole('button', { name: "Confirmer l'expédition" }).click();
  await expect(page.getByText('Expédition enregistrée.')).toBeVisible();
  await expect(page.getByText(/suivi 6A12345678901/)).toBeVisible();
});
