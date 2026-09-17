import { expect, test } from '@playwright/test';
import { API, api, expectNoHorizontalOverflow, loginAs, readSeed } from './helpers';

/**
 * AUDIT §61 :
 *  - « Configurer mon compte de versement » : le refus du prestataire de paiement reste affiché, en clair (avant : une
 *    erreur 500 « Erreur interne » dans un toast) ;
 *  - options de réception à l'achat : les trois choix sont là d'emblée, la recherche part au cinquième chiffre du code
 *    postal (sans la ville, sans délai), et au retour sur la fiche tout est préchargé — aucune attente dans la fenêtre.
 */
const seed = readSeed();

test('compte de versement : le refus du prestataire est affiché en clair et reste à l\'écran', async ({ page, isMobile }) => {
  await loginAs(page, seed.buyer, '/compte/paiements');
  await page.route(`${API}/users/me/stripe-onboarding-link`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusCode: 503, code: 'CONNECT_NOT_READY', message: "Les versements ne sont pas encore ouverts sur Trocoin : la configuration du prestataire de paiement est en cours de finalisation. Votre argent reste en sécurité.", reason: "StripeInvalidRequestError : You can only create new accounts if you've signed up for Connect" }) }));
  const start = page.getByRole('button', { name: 'Configurer mon compte de versement' });
  await start.click();
  const error = page.getByTestId('payout-setup-error');
  await expect(error).toContainText('Les versements ne sont pas encore ouverts sur Trocoin');
  await expect(error).toContainText('Votre argent reste en sécurité');
  await expect(error).toContainText('Détail technique (mode test)');
  await expect(start).toBeEnabled(); // on peut réessayer, le bouton ne reste pas sur « Redirection… »
  if (isMobile) await expectNoHorizontalOverflow(page);
});

test('options de réception : choix visibles d\'emblée, recherche au code postal seul, préchargement au retour', async ({ page, isMobile }) => {
  const seller = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } });
  const buyer = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier: seed.buyer.email, password: seed.buyer.password } });
  const me = await api<{ id: string }>('/users/me', { token: buyer.accessToken });
  const listing = await api<{ id: string }>('/listings', { method: 'POST', token: seller.accessToken, body: { title: `Casque audio sans fil ${Date.now().toString().slice(-5)}`, description: 'Casque audio sans fil à réduction de bruit, très bon état, vendu avec son étui et son câble de charge.', categorySlug: 'image-son', price: 60, priceType: 'fixe', condition: 'tres_bon_etat', city: 'Lyon', postalCode: '69003', latitude: 45.76, longitude: 4.85, deliveryAvailable: true, weightGrams: 900 } });
  await loginAs(page, seed.buyer, `/annonces/${listing.id}`);
  await page.evaluate((id) => window.localStorage.removeItem(`trocoin_livraison_${id}`), me.id);

  const optionCalls: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/shipping/pickup-options')) optionCalls.push(r.url()); });
  await page.getByRole('button', { name: /^Acheter · / }).click();
  const dialog = page.getByRole('dialog', { name: 'Paiement sécurisé' });
  await dialog.getByLabel('Envoi par Mondial Relay').check();
  // 1. Les trois choix sont là tout de suite, avant toute adresse, et se cochent
  const options = dialog.getByTestId('delivery-options');
  await expect(options.getByLabel(/À domicile/)).toBeVisible();
  await expect(options.getByLabel(/En point relais/)).toBeVisible();
  await expect(options.getByLabel(/En consigne automatique \(locker\)/)).toBeVisible();
  await options.getByLabel(/En point relais/).check();
  // 2. Code postal seul (pas de ville, pas de délai) : prix et points s'affichent ; le choix déjà coché est gardé
  await dialog.getByLabel('Code postal').fill('75017');
  await expect(options.getByTestId('pickup-point')).toHaveCount(2);
  await expect(options).toContainText(/En point relais \(2 à proximité\) — 5,49\s€/);
  await expect(options.getByLabel(/En point relais/)).toBeChecked();
  expect(optionCalls[0]).not.toContain('city=');
  // Seul ce que le transporteur propose reste affiché une fois sa réponse connue
  await expect(options.getByLabel(/À domicile/)).toHaveCount(0);
  // La ville se précise : relecture discrète, l'affichage et le choix ne bougent pas
  await dialog.getByLabel('Ville').fill('Paris');
  await expect.poll(() => optionCalls.some((u) => u.includes('city=Paris'))).toBe(true);
  await expect(options.getByTestId('pickup-point')).toHaveCount(2);
  await page.waitForLoadState('networkidle');
  // Autre transporteur : déjà lu avec le premier, aucun nouvel appel
  const before = optionCalls.length;
  await dialog.getByLabel('Envoi par Colissimo').check();
  await expect(options.getByLabel(/À domicile/)).toBeVisible();
  expect(optionCalls.length).toBe(before);
  if (isMobile) await expectNoHorizontalOverflow(page);

  // 3. Retour sur la fiche avec un code postal connu (dernier achat ou profil) : tout est préchargé AVANT l'ouverture
  await page.evaluate((id) => window.localStorage.setItem(`trocoin_livraison_${id}`, JSON.stringify({ postalCode: '75017', city: 'Paris' })), me.id);
  const preload = page.waitForResponse((r) => r.url().includes('/shipping/pickup-options') && r.url().includes('postalCode=75017'));
  await page.reload();
  await preload;
  await expect(page.getByRole('button', { name: /^Acheter · / })).toBeVisible();
  const loaded = optionCalls.length;
  await page.getByRole('button', { name: /^Acheter · / }).click();
  await dialog.getByLabel('Envoi par Mondial Relay').check();
  await expect(dialog.getByLabel('Code postal')).toHaveValue('75017');
  await expect(dialog.getByLabel('Ville')).toHaveValue('Paris');
  // Prix déjà là à l'apparition du bloc : aucune requête après l'ouverture, aucun état d'attente
  await expect(options).toContainText(/En point relais \(2 à proximité\) — 5,49\s€/, { timeout: 1500 });
  await expect(options.getByTestId('pickup-points-loading')).toHaveCount(0);
  expect(optionCalls.length).toBe(loaded);
  await options.getByLabel(/En point relais/).check();
  await expect(options.getByTestId('pickup-point')).toHaveCount(2);

  await api(`/listings/${listing.id}`, { method: 'DELETE', token: seller.accessToken });
});
