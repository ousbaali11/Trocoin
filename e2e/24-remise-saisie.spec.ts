import { expect, test } from '@playwright/test';
import { api, loginAs, readSeed } from './helpers';

/**
 * Fenêtre « Paiement sécurisé » (AUDIT §57) : la saisie dans les champs d'adresse ne doit jamais perdre le focus.
 * Défaut d'origine : la boîte de dialogue rejouait son « focus initial » à chaque frappe (effet dépendant d'une
 * fonction `onClose` recréée à chaque rendu) ; le focus repartait sur le premier champ de la boîte, le bouton radio
 * « Remise en main propre », et les frappes suivantes ne tombaient plus dans le champ.
 */
const seed = readSeed();

test('paiement : taper dans les champs d\'adresse garde le focus dans le champ, le mode de remise choisi ne change pas', async ({ page }) => {
  const seller = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const listing = await api<{ id: string }>('/listings', { method: 'POST', token: seller.accessToken, body: { title: `Enceinte Bluetooth portable ${Date.now().toString().slice(-5)}`, description: 'Enceinte Bluetooth portable, autonomie dix heures, vendue avec son câble de charge. Envoi possible.', categorySlug: 'image-son', price: 60, priceType: 'fixe', condition: 'bon_etat', city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.85, deliveryAvailable: true, weightGrams: 900 } });
  try {
    await loginAs(page, seed.buyer, `/annonces/${listing.id}`);
    await page.getByRole('button', { name: /^Acheter · / }).click();
    const dialog = page.getByRole('dialog', { name: 'Paiement sécurisé' });
    await dialog.getByRole('radio', { name: /Colissimo/ }).first().check();
    const handDelivery = dialog.getByRole('radio', { name: /Remise en main propre/ });
    // Frappe touche par touche, comme une personne : le défaut n'apparaît pas avec un remplissage d'un bloc
    for (const [id, text] of [['#addr-name', 'Nora Acheteur'], ['#addr-line1', '5 avenue des Ternes'], ['#addr-cp', '75017'], ['#addr-city', 'Paris']] as const) {
      const field = dialog.locator(id);
      await field.fill(''); // la ville peut déjà être déduite du code postal (AUDIT §61) : on repart d'un champ vide
      await field.click();
      await page.keyboard.type(text, { delay: 25 });
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(text);
      await expect(handDelivery).not.toBeChecked();
    }
    await expect(dialog.getByRole('radio', { name: /Colissimo/ }).first()).toBeChecked();
    await expect(dialog.getByTestId('quote-shipping')).toBeVisible(); // AUDIT §59 : la livraison s'ajoute au total
    // Échap ferme toujours la boîte et rend le focus au bouton d'ouverture
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Acheter · / })).toBeFocused();
  } finally {
    await api(`/listings/${listing.id}`, { method: 'DELETE', token: seller.accessToken }).catch(() => undefined);
  }
});
