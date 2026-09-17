import { expect, test } from '@playwright/test';
import { api, expectNoHorizontalOverflow, loginAs, readSeed } from './helpers';

/**
 * Suivi de la vente dans la conversation (AUDIT §57), acheteur et vendeur dans deux navigateurs : messages
 * automatiques distincts des messages des personnes, boutons d'action qui appellent les routes de la page
 * « Achats et ventes » (l'état est le même des deux côtés), mises à jour en direct.
 */
const seed = readSeed();

test('achat → disponibilité confirmée → expédition (suivi) → réception confirmée : tout se lit et se fait dans la conversation', async ({ browser, isMobile }) => {
  test.setTimeout(150_000);
  const sellerLogin = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const buyerLogin = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } });
  const listing = await api<{ id: string }>('/listings', { method: 'POST', token: sellerLogin.accessToken, body: { title: `Machine à café expresso ${Date.now().toString().slice(-5)}`, description: 'Machine à café expresso, détartrée, vendue avec deux tasses. Envoi soigné possible.', categorySlug: 'electromenager', price: 80, priceType: 'fixe', condition: 'bon_etat', city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.85, deliveryAvailable: true, weightGrams: 2500 } });
  // L'achat passe par l'API (le parcours d'achat lui-même est couvert par 05-achat, 17-expedition et 25-retour-paiement)
  const created = await api<{ transaction: { id: string } }>('/transactions', { method: 'POST', token: buyerLogin.accessToken, body: { listingId: listing.id, deliveryMethod: 'colissimo', deliveryMode: 'domicile', shippingAddress: { name: 'Nora Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris', phone: '06 12 34 56 78' } } });
  const txId = created.transaction.id;
  const convs = await api<Array<{ id: string; listing: { id: string } | null }>>('/conversations', { token: buyerLogin.accessToken });
  const convId = convs.find((c) => c.listing?.id === listing.id)!.id;

  const buyerCtx = await browser.newContext();
  const sellerCtx = await browser.newContext();
  const buyer = await buyerCtx.newPage();
  const seller = await sellerCtx.newPage();
  await loginAs(buyer, seed.buyer, `/compte/messages/${convId}`);
  await loginAs(seller, seed.seller, `/compte/messages/${convId}`);

  // 1. Achat : message automatique, texte selon le lecteur, visuellement à part des bulles des personnes
  const buyerFirst = buyer.getByTestId('system-message').first();
  await expect(buyerFirst).toContainText(/98,35\s€ payés/); // 80 € + 4,50 € de protection + 13,85 € de livraison (Colissimo domicile, 2,5 kg)
  await expect(buyerFirst).toContainText('Message automatique · Trocoin');
  await expect(buyerFirst).toContainText('Achat confirmé');
  await expect(buyerFirst).toContainText('Vous suivrez le colis ici.');
  // Tickets courts (AUDIT §60) : un titre et une phrase
  expect((await buyerFirst.innerText()).length).toBeLessThan(170);
  await expect(seller.getByTestId('system-message').first()).toContainText('Nouvelle vente');
  await expect(seller.getByTestId('system-message').first()).toContainText("Confirmez que l'article est disponible");
  const look = await buyerFirst.evaluate((el) => { const s = getComputedStyle(el); return { border: s.borderTopStyle, align: s.textAlign }; });
  expect(look).toEqual({ border: 'dashed', align: 'center' });
  // Pas de « Vu » ni d'alignement « de moi » sur un message automatique
  await expect(buyer.getByTestId('read-status')).toHaveCount(0);
  if (isMobile) await expectNoHorizontalOverflow(buyer);

  // 2. Le vendeur confirme la disponibilité depuis la conversation ; l'acheteur le voit en direct
  const sellerPanel = seller.getByTestId('sale-panel');
  await expect(sellerPanel).toContainText('Vente · 80,00 €');
  await expect(buyer.getByTestId('sale-panel')).toContainText('En attente du vendeur');
  await sellerPanel.getByTestId('sale-confirm-availability').click();
  await expect(seller.getByText("Disponibilité confirmée : l'acheteur est prévenu.")).toBeVisible();
  await expect(sellerPanel.getByTestId('sale-confirm-availability')).toHaveCount(0);
  await expect(buyer.getByTestId('system-message').filter({ hasText: 'Article disponible' })).toContainText("Le vendeur prépare l'envoi.");
  await expect(buyer.getByTestId('sale-panel')).toContainText("le vendeur prépare l'envoi");
  await expect(buyer.getByTestId('sale-steps').locator('[data-done="true"]')).toHaveCount(2);
  // Même état sur la page de la vente (mêmes routes) : l'action ne s'y propose plus
  // Livraison payée par l'acheteur (AUDIT §59) : après la confirmation, le bouton de la conversation mène au bon d'envoi
  await expect(seller.getByTestId('sale-ship')).toHaveText("Générer le bon d'envoi (PDF)");
  await seller.getByTestId('sale-ship').click();
  await expect(seller).toHaveURL(new RegExp(`/compte/transactions/${txId}$`));
  await expect(seller.getByTestId('availability-confirmed')).toBeVisible();
  await expect(seller.getByTestId('confirm-availability')).toHaveCount(0);

  // 3. Bon d'envoi généré sans rien payer : l'acheteur reçoit aussitôt son numéro de suivi dans la conversation
  const shipPanel = seller.getByTestId('shipment-panel');
  await shipPanel.locator('#from-line1').fill('12 rue de la République');
  await shipPanel.locator('#from-cp').fill('69003');
  await shipPanel.locator('#from-city').fill('Lyon');
  await shipPanel.getByTestId('generate-label').click();
  await expect(seller.getByTestId('shipment-ready')).toBeVisible();
  const generated = buyer.getByTestId('system-message').filter({ hasText: "Bon d'envoi généré" });
  await expect(generated).toContainText(/Votre numéro de suivi : SIM\d{10}/);
  // Puis l'expédition est confirmée sans ressaisie → message « Colis expédié » avec le lien de suivi
  await seller.getByRole('button', { name: "Confirmer l'expédition" }).click();
  await expect(seller.getByText('Expédition enregistrée.')).toBeVisible();
  const shipped = buyer.getByTestId('system-message').filter({ hasText: 'Colis expédié' });
  await expect(shipped).toContainText(/suivi SIM\d{10}/);
  await expect(shipped.getByTestId('system-track')).toHaveAttribute('href', /^https:\/\/www\.laposte\.fr\/outils\/suivre-vos-envois\?code=SIM\d{10}$/);
  await expect(buyer.getByTestId('sale-track')).toHaveAttribute('href', /laposte\.fr/);

  // 4. L'acheteur confirme la réception depuis la conversation (confirmation demandée) ; le vendeur est prévenu, payé
  await seller.getByTestId('open-conversation').click();
  await expect(seller).toHaveURL(new RegExp(`/compte/messages/${convId}$`));
  await buyer.getByTestId('sale-confirm-reception').click();
  await buyer.getByRole('button', { name: "J'ai bien reçu l'article" }).click();
  await expect(buyer.getByText('Réception confirmée, merci !')).toBeVisible();
  await expect(buyer.getByTestId('sale-confirm-reception')).toHaveCount(0);
  const paid = seller.getByTestId('system-message').filter({ hasText: 'Virement de' });
  await expect(paid).toContainText('Réception confirmée');
  // Le vendeur du jeu d'essai n'a pas de compte de versement : le virement est annoncé « en attente » (déclenché sinon)
  await expect(paid).toContainText(/Virement de 73,60\s€ (déclenché|en attente)/);
  await expect(seller.getByTestId('sale-steps').locator('[data-done="true"]')).toHaveCount(4);
  // La page « Achats et ventes » raconte la même chose
  // En-tête du suivi repliable, replié par défaut (AUDIT §60) : le détail se déplie par une commande large
  await expect(buyer.getByTestId('sale-details')).toBeHidden();
  const summaryToggle = buyer.getByTestId('sale-summary-toggle');
  await expect(summaryToggle).toHaveAttribute('aria-expanded', 'false');
  expect((await summaryToggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await summaryToggle.click();
  await expect(summaryToggle).toHaveAttribute('aria-expanded', 'true');
  await buyer.getByTestId('sale-details').click();
  await expect(buyer).toHaveURL(new RegExp(`/compte/transactions/${txId}$`));
  await expect(buyer.getByText(/^Réception confirmée :/)).toBeVisible();
  await expect(buyer.getByText('Transaction terminée.')).toBeVisible();
  // Boîte de réception : l'aperçu d'un message automatique n'est pas attribué à « Vous »
  await buyer.goto('/compte/messages');
  await expect(buyer.getByText(/ℹ️ Réception confirmée/).first()).toBeVisible();
  await expect(buyer.getByText(/Vous : ℹ️/)).toHaveCount(0);

  await buyerCtx.close();
  await sellerCtx.close();
});
