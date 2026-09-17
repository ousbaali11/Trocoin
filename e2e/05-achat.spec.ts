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
  await dialog.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(buyer).toHaveURL(/\/compte\/messages\/[0-9a-f-]{36}$/);
  await expect(buyer.getByText('Bonjour, la console est-elle toujours disponible ?')).toBeVisible();
  const conversationUrl = buyer.url();

  // Tant que le vendeur n'a pas ouvert la conversation : « Envoyé », pas « Vu »
  await expect(buyer.getByTestId('read-status')).toHaveText('· Envoyé');

  // --- Vendeur : dans sa boîte, la conversation non lue est en gras, toute la carte est cliquable, sans soulignement
  await loginAs(seller, seed.seller, '/compte/messages');
  const card = seller.getByRole('link', { name: new RegExp(listing.title.slice(0, 20)) }).first();
  await expect(card).toHaveClass(/unread/);
  await expect(card).toHaveAccessibleName(/1 non lu, conversation avec/);
  const nameEl = card.locator('span', { hasText: seed.buyer.displayName }).first();
  expect(await nameEl.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('700');
  await card.hover();
  expect(await card.evaluate((el) => [el, ...el.querySelectorAll('*')].every((n) => getComputedStyle(n).textDecorationLine === 'none')), 'aucun soulignement au survol').toBe(true);
  // Clic en dehors du texte (coin bas droit de la carte) : la carte entière ouvre la conversation
  const box = (await card.boundingBox())!;
  await seller.mouse.click(box.x + box.width - 6, box.y + box.height - 6);
  await expect(seller).toHaveURL(conversationUrl);
  await expect(seller.getByText('Bonjour, la console est-elle toujours disponible ?')).toBeVisible();
  await expect(seller.getByText('● en direct')).toBeVisible();

  // --- « Vu » : le vendeur a affiché la conversation → l'acheteur le voit en temps réel, avec l'heure
  await expect(buyer.getByTestId('read-status')).toHaveText(/· Vu à \d{2}:\d{2}/, { timeout: 15_000 });

  // --- « En train d'écrire… » : le vendeur tape sans envoyer → l'acheteur voit l'indicateur, qui disparaît seul
  await seller.getByRole('textbox', { name: 'Message' }).pressSequentially('Je regarde mon agenda', { delay: 40 });
  const typing = buyer.getByTestId('typing-indicator');
  await expect(typing).toContainText(`${seed.seller.displayName} est en train d'écrire`, { timeout: 10_000 });
  await expect(typing).toBeHidden({ timeout: 8_000 });
  await seller.getByRole('textbox', { name: 'Message' }).clear();

  // --- Temps réel : le message de l'acheteur apparaît chez le vendeur sans rechargement, et inversement
  const ping = `Je peux passer ce soir vers 19 h ${Date.now().toString().slice(-4)}`;
  await buyer.getByRole('textbox', { name: 'Message' }).fill(ping);
  await buyer.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(seller.getByText(ping)).toBeVisible({ timeout: 15_000 });
  const pong = `Parfait, à ce soir ! ${Date.now().toString().slice(-4)}`;
  await seller.getByRole('textbox', { name: 'Message' }).fill(pong);
  await seller.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(buyer.getByText(pong)).toBeVisible({ timeout: 15_000 });
  // L'acheteur a la conversation ouverte : le vendeur voit son message passer « Vu » sans rechargement
  await expect(seller.getByTestId('read-status')).toHaveText(/· Vu à \d{2}:\d{2}/, { timeout: 15_000 });

  // --- Une fois lue, la conversation repasse en poids normal dans la boîte
  await seller.goto('/compte/messages');
  const readCard = seller.getByRole('link', { name: new RegExp(listing.title.slice(0, 20)) }).first();
  await expect(readCard).not.toHaveClass(/unread/);
  expect(await readCard.locator('span', { hasText: seed.buyer.displayName }).first().evaluate((el) => getComputedStyle(el).fontWeight)).toBe('600');
  await seller.goto(conversationUrl);

  // --- Achat par paiement sécurisé (simulé) depuis la conversation
  await buyer.getByRole('link', { name: 'Acheter', exact: true }).click();
  await expect(buyer).toHaveURL(new RegExp(`/annonces/${listing.id}`));
  // Depuis la conversation, la fenêtre de paiement s'ouvre directement (AUDIT §60)
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

  // --- Le vendeur voit l'avis reçu ; l'article reçu, l'annonce a été supprimée automatiquement (AUDIT §58)
  await seller.goto('/compte/avis');
  await expect(seller.getByRole('tab', { name: 'Reçus (1)' })).toBeVisible();
  await expect(seller.getByText('Remise rapide, console impeccable.')).toBeVisible();
  const gone = await seller.goto(`/annonces/${listing.id}`);
  expect(gone?.status()).toBe(404);
  await expect(seller.getByText("L'annonce a peut-être été retirée ou vendue.")).toBeVisible();

  await buyerCtx.close();
  await sellerCtx.close();
});
