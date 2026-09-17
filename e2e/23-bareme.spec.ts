import { expect, test } from '@playwright/test';
import { api, loginAs, readSeed } from './helpers';

/**
 * AUDIT §51 : l'acheteur voit le prix ET les frais de protection séparément avant de payer ; la commission et
 * les frais se règlent depuis la console (valeur en vigueur affichée, changement confirmé, journalisé, non
 * rétroactif) ; un total déjà affiché est protégé si le barème change avant le clic sur « Payer ».
 */
const seed = readSeed();
// Annonce propre au scénario (220 € : frais 5 % + 0,50 € = 11,50 €, commission 8 % = 17,60 €) : les annonces du seed
// sont refusées, achetées ou mises en litige par d'autres scénarios selon l'ordre d'exécution.
let listing: { id: string; title: string };
let sellerToken = '';
test.beforeEach(async () => {
  sellerToken = (await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } })).accessToken;
  listing = await api<{ id: string; title: string }>('/listings', { method: 'POST', token: sellerToken, body: { title: 'Table basse en chêne massif ' + Date.now().toString().slice(-5), description: 'Table basse en chêne massif, plateau de 110 cm, très bon état, à venir chercher sur place.', categorySlug: 'ameublement', price: 220, priceType: 'fixe', condition: 'tres_bon_etat', city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.85 } });
});
const DEFAULTS = { commission_percent: 8, buyer_fee_percent: 5, buyer_fee_fixed_eur: 0.5, buyer_fee_cap_eur: 15 };

async function adminToken() {
  return (await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.admin.email, password: seed.admin.password } })).accessToken;
}
test.afterEach(async () => {
  // Quoi qu'il arrive, le barème d'origine est rétabli pour les autres scénarios et l'annonce du scénario retirée
  if (listing?.id) await api(`/listings/${listing.id}`, { method: 'DELETE', token: sellerToken }).catch(() => undefined);
  await api('/admin/settings', { method: 'PATCH', token: await adminToken(), body: DEFAULTS });
});

test('fenêtre de paiement : prix de l\'article, frais de protection et total sur trois lignes distinctes, sans formule ni net du vendeur', async ({ page }) => {
  await loginAs(page, seed.buyer, `/annonces/${listing.id}`);
  await expect(page.getByTestId('buy-breakdown')).toHaveText(/220,00\s€ \+ 11,50\s€ de frais de protection/);
  await page.getByRole('button', { name: /^Acheter · 231,50/ }).click();
  const pay = page.getByRole('dialog', { name: 'Paiement sécurisé' });
  await expect(pay.getByTestId('quote-price')).toContainText('Prix de l\'article');
  await expect(pay.getByTestId('quote-price')).toContainText(/220,00\s€/);
  await expect(pay.getByTestId('quote-fee')).toContainText('Frais de protection acheteur');
  await expect(pay.getByTestId('quote-fee')).toContainText(/11,50\s€/);
  await expect(pay.getByTestId('quote-total')).toContainText('Total à payer');
  await expect(pay.getByTestId('quote-total')).toContainText(/231,50\s€/);
  // Côté acheteur (AUDIT §53) : ni la formule des frais, ni le net du vendeur, ni la commission ne s'affichent
  await expect(pay).not.toContainText('plafonnés');
  await expect(pay).not.toContainText('Le vendeur perçoit');
  await expect(pay).not.toContainText(/commission/i);
  await expect(pay).toContainText('Frais de port à convenir avec le vendeur pour un envoi.');
  await expect(pay.getByRole('button', { name: /^Payer 231,50/ })).toBeVisible();
});

test('console : barème en vigueur affiché, changement confirmé, appliqué aux nouveaux devis, inscrit au journal', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'console sur bureau');
  await loginAs(page, seed.admin, '/admin/reglages');
  const panel = page.getByTestId('fee-settings');
  await expect(panel.getByRole('heading', { name: 'Commission et frais du paiement sécurisé' })).toBeVisible();
  const active = panel.getByTestId('fees-active');
  await expect(active).toContainText(/commission vendeur 8\s%/);
  await expect(active).toContainText(/5\s% \+ 0,50\s€ \(plafonnés à 15\s€\)/);
  await expect(active).toContainText(/l'acheteur paie 11,00\s€, le vendeur reçoit 9,20\s€, Trocoin garde 1,80\s€/);
  const save = panel.getByRole('button', { name: 'Enregistrer le barème' });
  await expect(save).toBeDisabled();

  // Valeur hors bornes : refusée avant tout envoi
  await panel.getByLabel('Commission vendeur (%)').fill('45');
  await expect(panel.getByTestId('fees-preview')).toContainText('Valeur invalide');
  await expect(save).toBeDisabled();

  // 9 % : aperçu, confirmation explicite, puis valeur en vigueur mise à jour
  await panel.getByLabel('Commission vendeur (%)').fill('9');
  await expect(panel.getByTestId('fees-preview')).toContainText(/le vendeur recevrait 9,10\s€/);
  await save.click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /Changer le barème/ }));
  await expect(confirm).toContainText(/8\s% → 9\s%/);
  await expect(confirm).toContainText('uniquement aux transactions créées à partir de maintenant');
  await confirm.getByRole('button', { name: 'Appliquer aux nouvelles transactions' }).click();
  await expect(active).toContainText(/commission vendeur 9\s%/);
  await expect(active).toContainText('Dernière modification');

  // Nouveau devis au nouveau taux ; journal d'audit avec l'ancienne et la nouvelle valeur
  const token = (await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } })).accessToken;
  const quote = await api<{ commission: number; sellerPayout: number; rates: { commissionPercent: number } }>(`/transactions/quote?listingId=${listing.id}`, { token });
  expect(quote).toMatchObject({ commission: 19.8, sellerPayout: 200.2, rates: { commissionPercent: 9 } });
  await page.goto('/admin/journal');
  const row = page.getByRole('row').filter({ hasText: 'settings.update' }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('commission_percent');
});

test('total déjà affiché : si le barème change avant le clic sur « Payer », rien n\'est débité et le nouveau total s\'affiche', async ({ page }) => {
  await loginAs(page, seed.buyer, `/annonces/${listing.id}`);
  await page.getByRole('button', { name: /^Acheter · 231,50/ }).click();
  const pay = page.getByRole('dialog', { name: 'Paiement sécurisé' });
  await expect(pay.getByTestId('quote-total')).toContainText(/231,50\s€/);
  await api('/admin/settings', { method: 'PATCH', token: await adminToken(), body: { buyer_fee_fixed_eur: 1 } });
  await pay.getByRole('button', { name: /^Payer 231,50/ }).click();
  await expect(page.getByText(/Le montant à payer a changé depuis son affichage/)).toBeVisible();
  await expect(pay.getByTestId('quote-total')).toContainText(/232,00\s€/);
  await expect(pay.getByTestId('quote-fee')).toContainText(/12,00\s€/);
  await expect(page).toHaveURL(new RegExp(`/annonces/${listing.id}`));
  const token = (await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } })).accessToken;
  const mine = await api<unknown>('/transactions/mine', { token });
  expect(JSON.stringify(mine)).not.toContain(listing.id);
});
