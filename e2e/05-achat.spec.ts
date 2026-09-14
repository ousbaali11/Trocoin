import { expect, test } from '@playwright/test';
import { loginAs, readSeed } from './helpers';

/**
 * Parcours complet acheteur, avec deux navigateurs simultanés (acheteur et vendeur) :
 * contact du vendeur, messagerie en temps réel (WebSocket, sans rechargement), achat par
 * paiement sécurisé simulé, confirmation de réception, avis visible côté vendeur.
 */
const seed = readSeed();
const listing = seed.listings.ps5;

test('contact, messagerie temps réel, achat, réception confirmée, avis', async ({ browser }) => {
  test.setTimeout(120_000);
  const buyerCtx = await browser.newContext();
  const sellerCtx = await browser.newContext();
  const buyer = await buyerCtx.newPage();
  const seller = await sellerCtx.newPage();

  // --- Acheteur : contacte le vendeur depuis l'annonce
  await loginAs(buyer, seed.buyer, `/annonces/${listing.id}`);
  await buyer.getByRole('button', { name: 'Contacter le vendeur' }).click();
  const dialog = buyer.getByRole('dialog', { name: 'Écrire au vendeur' });
  await dialog.getByLabel('Votre message').fill('Bonjour, la console est-elle toujours disponible ?');
  await dialog.getByRole('button', { name: 'Envoyer' }).click();
  await expect(buyer).toHaveURL(/\/compte\/messages\/[0-9a-f-]{36}$/);
  await expect(buyer.getByText('Bonjour, la console est-elle toujours disponible ?')).toBeVisible();
  const conversationUrl = buyer.url();

  // --- Vendeur : ouvre la conversation, la voit dans sa boîte, en direct
  await loginAs(seller, seed.seller, '/compte/messages');
  await seller.getByRole('link', { name: new RegExp(listing.title.slice(0, 20)) }).first().click();
  await expect(seller).toHaveURL(conversationUrl);
  await expect(seller.getByText('Bonjour, la console est-elle toujours disponible ?')).toBeVisible();
  await expect(seller.getByText('● en direct')).toBeVisible();

  // --- Temps réel : le message de l'acheteur apparaît chez le vendeur sans rechargement, et inversement
  const ping = `Je peux passer ce soir vers 19 h ${Date.now().toString().slice(-4)}`;
  await buyer.getByRole('textbox', { name: 'Message' }).fill(ping);
  await buyer.getByRole('button', { name: 'Envoyer' }).click();
  await expect(seller.getByText(ping)).toBeVisible({ timeout: 15_000 });
  const pong = `Parfait, à ce soir ! ${Date.now().toString().slice(-4)}`;
  await seller.getByRole('textbox', { name: 'Message' }).fill(pong);
  await seller.getByRole('button', { name: 'Envoyer' }).click();
  await expect(buyer.getByText(pong)).toBeVisible({ timeout: 15_000 });

  // --- Achat par paiement sécurisé (simulé) depuis la conversation
  await buyer.getByRole('link', { name: 'Acheter', exact: true }).click();
  await expect(buyer).toHaveURL(new RegExp(`/annonces/${listing.id}`));
  await buyer.getByRole('button', { name: /^Acheter · / }).click();
  const pay = buyer.getByRole('dialog', { name: 'Paiement sécurisé' });
  await expect(pay).toContainText('Total à payer');
  await expect(pay).toContainText('395,00 €'); // 380 € + frais de protection plafonnés à 15 €
  await pay.getByRole('button', { name: /^Payer / }).click();
  await expect(buyer).toHaveURL(/\/compte\/transactions\/[0-9a-f-]{36}$/);
  await expect(buyer.getByText('Fonds bloqués')).toBeVisible();
  await expect(buyer.getByText('Votre code de remise :')).toBeVisible();

  // --- Réception confirmée (boîte de confirmation du site, pas un confirm() natif)
  await buyer.getByRole('button', { name: "J'ai bien reçu l'article" }).click();
  const confirm = buyer.getByRole('dialog', { name: 'Confirmer la réception ?' });
  await confirm.getByRole('button', { name: "J'ai bien reçu l'article" }).click();
  await expect(buyer.getByText('Terminée', { exact: true })).toBeVisible();
  await expect(buyer.getByText('Transaction terminée.')).toBeVisible();

  // --- Avis
  await buyer.getByRole('button', { name: 'Laisser un avis' }).click();
  const review = buyer.getByRole('dialog', { name: /Votre avis sur/ });
  await review.getByRole('button', { name: '5 sur 5' }).click();
  await review.getByLabel('Commentaire (facultatif)').fill('Remise rapide, console impeccable.');
  await review.getByRole('button', { name: "Publier l'avis" }).click();
  await expect(buyer.getByText('Vous avez laissé un avis (5/5).')).toBeVisible();

  // --- Le vendeur voit l'avis reçu et l'annonce est passée « Vendue »
  await seller.goto('/compte/avis');
  await expect(seller.getByRole('tab', { name: 'Reçus (1)' })).toBeVisible();
  await expect(seller.getByText('Remise rapide, console impeccable.')).toBeVisible();
  await seller.goto(`/annonces/${listing.id}`);
  await expect(seller.getByText('Cette annonce a trouvé preneur.')).toBeVisible();

  await buyerCtx.close();
  await sellerCtx.close();
});
