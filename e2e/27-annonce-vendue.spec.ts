import { expect, test } from '@playwright/test';
import { api, loginAs, readSeed } from './helpers';

/**
 * Cycle de vie de l'annonce pendant une vente (AUDIT §58) : payée → « Vendu » (bouton Acheter disparu, hors
 * résultats, toujours consultable) ; achat annulé → le vendeur la remet en ligne d'un clic depuis la conversation ;
 * article reçu → annonce supprimée automatiquement.
 */
const seed = readSeed();

test('annonce payée : « Vendu » et plus de bouton Acheter ; annulation → remise en ligne par le vendeur ; réception → annonce supprimée', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const seller = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const buyer = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } });
  const title = `Lampe de chevet en laiton ${Date.now().toString().slice(-5)}`;
  const listing = await api<{ id: string }>('/listings', { method: 'POST', token: seller.accessToken, body: { title, description: 'Lampe de chevet en laiton, abat-jour en tissu, très bon état, fonctionne parfaitement.', categorySlug: 'decoration', price: 30, priceType: 'fixe', condition: 'tres_bon_etat', city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.85 } });

  // Avant l'achat : en ligne, achetable
  await page.goto(`/annonces/${listing.id}`);
  await expect(page.getByRole('button', { name: /^Acheter · / })).toBeVisible();
  await expect(page.getByTestId('sold-badge')).toHaveCount(0);

  // 1. Achat payé → « Vendu », plus d'achat ni de contact, hors résultats, mais l'annonce est toujours là
  const first = await api<{ transaction: { id: string } }>('/transactions', { method: 'POST', token: buyer.accessToken, body: { listingId: listing.id } });
  await page.reload();
  await expect(page.getByTestId('sold-badge')).toHaveText('Vendu');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByRole('button', { name: /^Acheter/ })).toHaveCount(0);
  await expect(page.getByTestId('listing-unavailable')).toContainText("Article vendu : il n'est plus disponible à l'achat.");
  await page.goto(`/recherche?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);

  // 2. L'acheteur annule : l'annonce reste « Vendu » ; le vendeur la remet en ligne depuis la conversation
  await api(`/transactions/${first.transaction.id}/cancel`, { method: 'POST', token: buyer.accessToken });
  const convs = await api<Array<{ id: string; listing: { id: string } | null }>>('/conversations', { token: seller.accessToken });
  const convId = convs.find((c) => c.listing?.id === listing.id)!.id;
  const sellerCtx = await browser.newContext();
  const sellerPage = await sellerCtx.newPage();
  await loginAs(sellerPage, seed.seller, `/compte/messages/${convId}`);
  await expect(sellerPage.getByTestId('system-message').filter({ hasText: 'Vente annulée' })).toContainText("remettez l'annonce en ligne");
  await sellerPage.getByTestId('sale-relist').click();
  await expect(sellerPage.getByText('Annonce remise en ligne.')).toBeVisible();
  await expect(sellerPage.getByTestId('sale-relist')).toHaveCount(0);
  await page.goto(`/annonces/${listing.id}`);
  await expect(page.getByTestId('sold-badge')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Acheter · / })).toBeVisible();

  // 3. Nouvel achat, remise validée par le code → annonce supprimée automatiquement ; la vente garde sa trace
  const second = await api<{ transaction: { id: string; handoverCode: string } }>('/transactions', { method: 'POST', token: buyer.accessToken, body: { listingId: listing.id } });
  await api(`/transactions/${second.transaction.id}/handover`, { method: 'POST', token: seller.accessToken, body: { code: second.transaction.handoverCode } });
  const gone = await page.goto(`/annonces/${listing.id}`);
  expect(gone?.status()).toBe(404);
  await sellerPage.goto(`/compte/transactions/${second.transaction.id}`);
  await expect(sellerPage.getByTestId('listing-removed')).toContainText("L'annonce a été supprimée automatiquement");
  await expect(sellerPage.getByRole('heading', { level: 1 })).toContainText(title);
  await sellerCtx.close();
});
