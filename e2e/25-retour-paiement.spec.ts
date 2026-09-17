import { expect, test } from '@playwright/test';
import { API, api, loginAs, readSeed } from './helpers';

/**
 * Retour de la page de paiement hébergée (AUDIT §57). La pile e2e n'a pas Stripe : le fournisseur simulé joue une
 * page de paiement servie hors du site (par l'API), avec les mêmes adresses de retour que celles données à Stripe.
 * Vérifié ici : après un paiement réussi comme après un refus, l'acheteur finit toujours sur une page Trocoin qui
 * dit clairement le résultat — et, en cas d'échec, quoi faire.
 */
const seed = readSeed();
const hosted = (on: boolean) => api('/dev/mock-checkout/mode', { method: 'POST', body: { hosted: on } });

test.beforeAll(() => hosted(true));
test.afterAll(() => hosted(false));

async function listingToBuy(title: string) {
  const seller = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const listing = await api<{ id: string }>('/listings', { method: 'POST', token: seller.accessToken, body: { title, description: 'Casque audio sans fil, très bon état, vendu avec son étui et son câble de charge.', categorySlug: 'image-son', price: 45, priceType: 'fixe', condition: 'tres_bon_etat', city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.85 } });
  return { listing, sellerToken: seller.accessToken };
}

test('paiement réussi : retour automatique sur Trocoin, page « Paiement réussi » avec la suite et le lien vers la conversation', async ({ page }) => {
  const { listing, sellerToken } = await listingToBuy(`Casque audio sans fil ${Date.now().toString().slice(-5)}`);
  const buyer = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } });
  let txId = '';
  try {
    await loginAs(page, seed.buyer, `/annonces/${listing.id}`);
    await page.getByRole('button', { name: /^Acheter · / }).click();
    await page.getByRole('dialog', { name: 'Paiement sécurisé' }).getByRole('button', { name: /^Payer/ }).click();
    // L'acheteur quitte le site pour la page de paiement hébergée
    await expect(page).toHaveURL(new RegExp(`^${API}/dev/mock-checkout/`));
    await page.getByTestId('mock-pay').click();
    // … et revient tout seul sur Trocoin, sur la page de sa vente
    await expect(page).toHaveURL(/\/compte\/transactions\/[0-9a-f-]{36}$/);
    txId = page.url().split('/').pop()!;
    const result = page.getByTestId('payment-result');
    await expect(result).toHaveAttribute('data-result', 'succes');
    await expect(result).toContainText('Paiement réussi');
    await expect(result).toContainText('Trocoin conserve votre paiement');
    await expect(page.getByTestId('pending-payment')).toHaveCount(0);
    // La suite se passe dans la conversation, créée d'office avec le message automatique
    await result.getByRole('link', { name: 'Ouvrir la conversation' }).click();
    await expect(page).toHaveURL(/\/compte\/messages\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('system-message').first()).toContainText('Achat confirmé');
  } finally {
    if (txId) await api(`/transactions/${txId}/cancel`, { method: 'POST', token: buyer.accessToken }).catch(() => undefined);
    await api(`/listings/${listing.id}`, { method: 'DELETE', token: sellerToken }).catch(() => undefined);
  }
});

test('carte refusée puis retour : page Trocoin « Paiement non abouti », reprise possible, abandon qui libère l\'annonce', async ({ page }) => {
  const { listing, sellerToken } = await listingToBuy(`Casque audio filaire ${Date.now().toString().slice(-5)}`);
  try {
    await loginAs(page, seed.buyer, `/annonces/${listing.id}`);
    await page.getByRole('button', { name: /^Acheter · / }).click();
    await page.getByRole('dialog', { name: 'Paiement sécurisé' }).getByRole('button', { name: /^Payer/ }).click();
    await expect(page).toHaveURL(new RegExp(`^${API}/dev/mock-checkout/`));
    // Refus : comme chez Stripe, la page de paiement reste affichée avec le motif ; « Retour » ramène sur Trocoin
    await page.getByTestId('mock-decline').click();
    await expect(page.getByTestId('mock-declined')).toBeVisible();
    await page.getByTestId('mock-back').click();
    await expect(page).toHaveURL(/\/compte\/transactions\/[0-9a-f-]{36}$/);
    const result = page.getByTestId('payment-result');
    await expect(result).toHaveAttribute('data-result', 'echec');
    await expect(result).toContainText("Paiement non abouti : rien n'a été débité.");
    await expect(result).toContainText('essayez un autre moyen de paiement');
    // Reprendre : retour sur la page de paiement encore ouverte
    await expect(result.getByTestId('resume-payment')).toHaveAttribute('href', new RegExp(`^${API}/dev/mock-checkout/`));
    // Abandonner : l'achat est clos sans débit, l'annonce est de nouveau achetable tout de suite
    await result.getByTestId('abandon-payment').click();
    await expect(page.getByText("Achat abandonné : rien n'a été débité.")).toBeVisible();
    await expect(page.getByTestId('closed-help')).toContainText("rien n'a été débité");
    await page.goto(`/annonces/${listing.id}`);
    await expect(page.getByRole('button', { name: /^Acheter · / })).toBeVisible();
  } finally {
    await api(`/listings/${listing.id}`, { method: 'DELETE', token: sellerToken }).catch(() => undefined);
  }
});
