import { expect, test } from '@playwright/test';
import { api, loginAs, readSeed } from './helpers';

/**
 * Suppression de conversations dans la messagerie (desktop) : mode sélection, sélection
 * individuelle et multiple, tout sélectionner / désélectionner, suppression avec confirmation,
 * annulation. La suppression ne retire la conversation que pour la personne qui supprime.
 */
const seed = readSeed();

async function token(email: string, password: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: email, password } });
  return res.accessToken;
}

test('sélection, tout sélectionner, suppression confirmée, annulation ; l\'autre participant garde ses conversations', async ({ page }) => {
  // Trois conversations de l'acheteur vers le vendeur, une par annonce du seed
  const buyerToken = await token(seed.buyer.email, seed.buyer.password);
  const sellerToken = await token(seed.seller.email, seed.seller.password);
  const created: string[] = [];
  // La PlayStation du seed est achetée puis reçue dans 05-achat : son annonce est supprimée (AUDIT §58) ; on en publie une autre
  const extra = await api<{ id: string }>('/listings', { method: 'POST', token: sellerToken, body: { title: 'Console rétro avec deux manettes', description: 'Console rétro en bon état, vendue avec deux manettes et ses câbles, testée avant la vente.', categorySlug: 'consoles-jeux-video', price: 60, priceType: 'fixe', condition: 'bon_etat', city: 'Lyon', postalCode: '69003', attributes: { plateforme: 'Autre' } } });
  for (const [key, listingId] of [['vtt', seed.listings.vtt.id], ['console', extra.id], ['poussette', seed.listings.poussette.id]] as const) {
    const c = await api<{ id: string }>('/conversations', { method: 'POST', body: { listingId, message: `Bonjour, toujours disponible ? (${key})` }, token: buyerToken });
    created.push(c.id);
  }
  const sellerBefore = (await api<Array<{ id: string }>>('/conversations', { token: sellerToken })).map((c) => c.id);

  await loginAs(page, { email: seed.buyer.email, password: seed.buyer.password }, '/compte/messages');
  const cards = page.getByTestId('conversation');
  await expect(cards.first()).toBeVisible();
  await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(3);
  const total = await cards.count();
  expect(total).toBeGreaterThanOrEqual(3);

  // Mode sélection : cases à cocher, barre d'actions sans bouton Supprimer tant que rien n'est coché
  await page.getByRole('button', { name: 'Sélectionner' }).click();
  const bar = page.getByTestId('selection-bar');
  await expect(bar).toContainText('Cochez une ou plusieurs conversations.');
  await expect(bar.getByRole('button', { name: /^Supprimer/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^Sélectionner :/ })).toHaveCount(total);

  // Sélection individuelle puis multiple
  const boxes = page.getByRole('checkbox', { name: /^Sélectionner :/ });
  await boxes.nth(0).check();
  await expect(bar).toContainText('1 sélectionnée');
  await expect(bar.getByRole('button', { name: 'Supprimer (1)' })).toBeVisible();
  await boxes.nth(1).check();
  await expect(bar).toContainText('2 sélectionnées');
  await boxes.nth(0).uncheck();
  await expect(bar).toContainText('1 sélectionnée');

  // Tout sélectionner / tout désélectionner
  await bar.getByRole('button', { name: 'Tout sélectionner' }).click();
  await expect(bar).toContainText(`${total} sélectionnées`);
  await expect(bar.getByRole('button', { name: `Supprimer (${total})` })).toBeVisible();
  await bar.getByRole('button', { name: 'Tout désélectionner' }).click();
  await expect(bar).toContainText('Cochez une ou plusieurs conversations.');

  // Annulation de la suppression : rien ne bouge
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await bar.getByRole('button', { name: 'Supprimer (2)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Supprimer 2 conversations ?' });
  await expect(dialog).toContainText('Cette action est irréversible');
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(cards).toHaveCount(total);
  await expect(bar).toContainText('2 sélectionnées');

  // Suppression confirmée : les deux disparaissent, le mode sélection se ferme
  await bar.getByRole('button', { name: 'Supprimer (2)' }).click();
  await page.getByRole('dialog', { name: 'Supprimer 2 conversations ?' }).getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByText('2 conversations supprimées.')).toBeVisible();
  await expect(cards).toHaveCount(total - 2);
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  // Après rechargement, toujours absentes pour l'acheteur
  await page.reload();
  await expect(page.getByTestId('conversation')).toHaveCount(total - 2);

  // Le vendeur, lui, voit toujours toutes ses conversations
  const sellerAfter = (await api<Array<{ id: string }>>('/conversations', { token: sellerToken })).map((c) => c.id);
  expect(sellerAfter.sort()).toEqual(sellerBefore.sort());
  for (const id of created) expect(sellerAfter).toContain(id);
});
