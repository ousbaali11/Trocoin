import { expect, test } from '@playwright/test';
import { api, expectNoHorizontalOverflow, loginAs, readSeed } from './helpers';

/**
 * AUDIT §63 :
 *  - compte de versement en un formulaire (nom, date de naissance, adresse, IBAN) sur la page Paiements, sans quitter
 *    Trocoin ; IBAN jamais affiché en entier ensuite ;
 *  - annonce archivée à la fin d'une vente : disparue pour les membres et le vendeur, consultable par l'administration ;
 *  - fiche admin d'un litige : état réel du paiement chez le prestataire affiché avant la décision.
 */
const seed = readSeed();

test('page Paiements : le formulaire nom + IBAN active le compte de versement', async ({ page, isMobile }) => {
  await loginAs(page, seed.seller, '/compte/paiements');
  // Un scénario précédent a pu activer un compte de versement simulé : on passe alors par « Changer d'IBAN »
  const already = page.getByTestId('payout-active');
  await expect(page.getByTestId('payout-form').or(already)).toBeVisible();
  if (await already.isVisible()) await already.getByRole('button', { name: "Changer d'IBAN" }).click();
  const form = page.getByTestId('payout-form');
  await expect(form).toBeVisible();
  // Prénom / nom / code postal / ville viennent du profil ; il reste la date de naissance, la rue et l'IBAN
  await page.getByLabel('Prénom').fill('Camille');
  await page.getByLabel('Nom', { exact: true }).fill('Vendeur');
  await page.getByLabel('Date de naissance').fill('1988-03-14');
  await page.getByLabel('Adresse', { exact: true }).fill('12 rue de la République');
  await page.getByLabel('Code postal').fill('69002');
  await page.getByLabel('Ville').fill('Lyon');
  const submit = page.getByTestId('payout-submit');
  await page.getByLabel('IBAN').fill('FR1420041010050500013M02606');
  await expect(page.getByLabel('IBAN')).toHaveValue('FR14 2004 1010 0505 0001 3M02 606'); // espacé comme sur un RIB
  await expect(submit).toBeDisabled(); // conditions non acceptées
  await page.getByRole('checkbox', { name: /conditions du service de versement/ }).check();
  await expect(submit).toBeEnabled();
  if (isMobile) await expectNoHorizontalOverflow(page);
  await submit.click();
  const active = page.getByTestId('payout-active');
  await expect(active).toContainText('Compte de versement actif');
  await expect(active).toContainText('•••• 2606');
  await expect(page.getByText('FR14 2004')).toHaveCount(0); // l'IBAN complet n'est plus affiché
  await active.getByRole('button', { name: "Changer d'IBAN" }).click();
  await expect(page.getByTestId('payout-form')).toBeVisible();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByTestId('payout-active')).toBeVisible();
});

test("annonce archivée après la vente : invisible pour les membres, consultable par l'admin ; état du paiement sur la fiche admin", async ({ page }) => {
  const seller = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const buyer = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } });
  const listing = await api<{ id: string; title: string }>('/listings', { method: 'POST', token: seller.accessToken, body: { title: `Vélo enfant 16 pouces ${Date.now().toString().slice(-5)}`, description: 'Vélo enfant 16 pouces avec petites roues, bon état général, remise en main propre à Lyon.', categorySlug: 'decoration', price: 45, priceType: 'fixe', condition: 'bon_etat', city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.85 } });
  const bought = await api<{ transaction?: { id: string }; id?: string }>('/transactions', { method: 'POST', token: buyer.accessToken, body: { listingId: listing.id, deliveryMethod: 'main_propre' } });
  const txId = (bought.transaction ?? bought).id!;
  await api(`/transactions/${txId}/ship`, { method: 'POST', token: seller.accessToken, body: {} });

  // Litige ouvert par l'acheteur : la fiche admin affiche l'état réel du paiement avant la décision
  await api(`/transactions/${txId}/dispute`, { method: 'POST', token: buyer.accessToken, body: { reason: 'Le vendeur ne se présente pas aux rendez-vous convenus.' } });
  await loginAs(page, seed.admin, `/admin/litiges/${txId}`);
  await expect(page.getByTestId('provider-state')).toContainText('Paiement chez le prestataire : encaissé par Trocoin');
  await expect(page.getByText("Litige ouvert par l'acheteur")).toBeVisible();
  await page.getByTestId('decision-note').fill('Fonds libérés au vendeur après examen des échanges.');
  await page.getByRole('button', { name: /^Libérer/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Libérer les fonds' }).click();
  await expect(page.getByText('Décision appliquée.')).toBeVisible();

  // Vente confirmée → annonce archivée : l'admin la lit encore, avec son bandeau
  await page.goto(`/admin/annonces/${listing.id}`);
  await expect(page.getByTestId('archived-banner')).toContainText('Annonce archivée');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(listing.title);
  await expect(page.getByRole('link', { name: 'Voir sur le site ↗' })).toHaveCount(0);
  // Les membres ne la voient plus, le vendeur non plus
  const gone = await api<{ status?: number; message?: string }>(`/listings/${listing.id}`, { token: buyer.accessToken }).catch((e: Error) => ({ message: e.message }));
  expect(String((gone as { message?: string }).message ?? '')).toContain('Annonce introuvable');
  const mine = await api<Array<{ id: string }>>('/listings/mine', { token: seller.accessToken });
  expect(mine.map((l) => l.id)).not.toContain(listing.id);
});
