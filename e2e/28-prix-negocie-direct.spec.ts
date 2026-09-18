import { expect, test } from '@playwright/test';
import { api, expectNoHorizontalOverflow, loginAs, readSeed } from './helpers';

/**
 * AUDIT §60, deux navigateurs (acheteur et vendeur), SANS JAMAIS RECHARGER :
 *  - la proposition de prix, son acceptation et les messages arrivent en direct chez l'autre (avant : les propositions,
 *    réponses et photos passaient par des routes qui ne prévenaient personne — il fallait actualiser) ;
 *  - la proposition acceptée se paie : bouton « Payer 15,00 € », fenêtre d'achat au prix négocié, vente à ce prix ;
 *  - blocs de la conversation : réponses rapides repliées par défaut, retour dessiné, ticket de proposition court.
 */
const seed = readSeed();

test('proposition acceptée en direct → « Payer » au prix négocié ; réponses rapides repliables ; rien à actualiser', async ({ browser, isMobile }) => {
  test.setTimeout(150_000);
  const sellerLogin = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const buyerLogin = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } });
  const title = `Noix de coco décorative ${Date.now().toString().slice(-5)}`;
  const listing = await api<{ id: string }>('/listings', { method: 'POST', token: sellerLogin.accessToken, body: { title, description: 'Noix de coco sculptée, décoration de table, très bon état, remise en main propre à Lyon.', categorySlug: 'decoration', price: 20, priceType: 'fixe', condition: 'tres_bon_etat', city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.85 } });
  const conv = await api<{ id: string }>('/conversations', { method: 'POST', token: buyerLogin.accessToken, body: { listingId: listing.id, message: 'Bonjour, est-ce toujours disponible ?' } });

  const buyerCtx = await browser.newContext();
  const sellerCtx = await browser.newContext();
  const buyer = await buyerCtx.newPage();
  const seller = await sellerCtx.newPage();
  await loginAs(buyer, seed.buyer, `/compte/messages/${conv.id}`);
  await loginAs(seller, seed.seller, `/compte/messages/${conv.id}`);
  // Chacun voit l'autre connecté (pastille verte, AUDIT §62) : les deux sockets sont dans la conversation
  await expect(buyer.getByTestId('conv-avatar')).toHaveAttribute('data-online', 'true');
  await expect(seller.getByTestId('conv-avatar')).toHaveAttribute('data-online', 'true');

  // Bloc A : réponses rapides repliées par défaut, commande large ; bloc B : retour dessiné (40 px, nom accessible)
  const quick = buyer.getByTestId('quick-replies');
  const quickToggle = buyer.getByTestId('quick-replies-toggle');
  await expect(quickToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(quick.getByRole('button', { name: 'Quel est votre dernier prix ?' })).toBeHidden();
  const toggleBox = (await quickToggle.boundingBox())!;
  expect(toggleBox.height).toBeGreaterThanOrEqual(44);
  expect(toggleBox.width).toBeGreaterThan(isMobile ? 250 : 400);
  const back = buyer.getByTestId('back-link');
  await expect(back).toHaveAccessibleName('Retour aux messages');
  expect((await back.boundingBox())!.width).toBeGreaterThanOrEqual(40);
  await quickToggle.click();
  await expect(quickToggle).toHaveAttribute('aria-expanded', 'true');
  await quick.getByRole('button', { name: 'Quel est votre dernier prix ?' }).click();
  // Le vendeur le reçoit sans recharger
  await expect(seller.getByRole('log').getByText('Quel est votre dernier prix ?')).toBeVisible();
  if (isMobile) await expectNoHorizontalOverflow(buyer);

  // Proposition de l'acheteur → arrive EN DIRECT chez le vendeur (avant : seulement après un rechargement)
  await buyer.getByRole('button', { name: 'Proposer un prix' }).click();
  await buyer.getByLabel('Votre proposition (€)').fill('15');
  await buyer.getByRole('button', { name: 'Envoyer la proposition' }).click();
  const sellerCard = seller.getByTestId('offer-card');
  await expect(sellerCard).toContainText('15,00 €');
  await expect(sellerCard).toHaveAttribute('data-status', 'en_attente');

  // Le vendeur accepte → le ticket de l'acheteur passe « Acceptée » EN DIRECT, avec le bouton de paiement au prix négocié
  await sellerCard.getByRole('button', { name: 'Accepter' }).click();
  const buyerCard = buyer.getByTestId('offer-card');
  await expect(buyerCard).toHaveAttribute('data-status', 'acceptee');
  const pay = buyerCard.getByTestId('offer-pay');
  await expect(pay).toHaveText(/Payer 15,00\s€/);
  await expect(buyerCard).toContainText("Prix valable jusqu'au");
  // Ticket court (bloc F) : plus de phrase « convenez du paiement… »
  await expect(buyerCard).not.toContainText('convenez du paiement');
  expect((await buyerCard.innerText()).length).toBeLessThan(120);
  await expect(seller.getByTestId('offer-waiting')).toContainText("En attente du paiement de l'acheteur");
  await expect(buyer.getByTestId('conv-buy')).toHaveText(/Payer 15,00\s€/);

  // « Payer 15,00 € » : la fenêtre d'achat s'ouvre au prix négocié (15 € + 1,25 € de protection)
  await pay.click();
  await expect(buyer).toHaveURL(new RegExp(`/annonces/${listing.id}`));
  const dialog = buyer.getByRole('dialog', { name: 'Paiement sécurisé' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('quote-price')).toContainText('Prix négocié');
  await expect(dialog.getByTestId('quote-price')).toContainText('15,00 €');
  await expect(dialog.getByTestId('quote-total')).toContainText('16,25 €');
  await expect(buyer.getByTestId('negotiated-price')).toContainText(/15,00\s€ au lieu de 20,00\s€/);
  await dialog.getByRole('button', { name: /^Payer 16,25/ }).click();
  await expect(buyer).toHaveURL(/\/compte\/transactions\/[0-9a-f-]{36}/);
  await expect(buyer.getByText(/Prix négocié \(affiché 20,00\s€\)/)).toBeVisible();

  // Chez le vendeur, toujours sans recharger : message automatique de vente au prix négocié et panneau de la vente
  const sale = seller.getByTestId('system-message').filter({ hasText: 'Nouvelle vente' });
  await expect(sale).toContainText(/15,00\s€ \(prix négocié\)/);
  await expect(seller.getByTestId('sale-panel')).toContainText(/Vente · 15,00\s€/);
  // Bloc K : boutons compacts, deux lignes au plus
  const actions = seller.getByTestId('sale-actions');
  const rows = await actions.locator('.btn').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
  expect(rows).toBeLessThanOrEqual(2);
  if (isMobile) await expectNoHorizontalOverflow(seller);

  await buyerCtx.close();
  await sellerCtx.close();
});
