import { expect, test, type Browser } from '@playwright/test';
import path from 'path';
import { api, loginAs, mockGeo, readSeed, uniq, uniquePhone } from './helpers';

/**
 * Téléphone obligatoire au dépôt et statistiques par annonce (brief du 16 septembre 2026).
 * Le numéro est celui du compte (unique, réutilisé pour toutes les annonces) : un compte sans numéro
 * doit en saisir un pour publier ; un compte qui en a un ne le retape pas et peut le masquer.
 * « Mes annonces » affiche par annonce : vues, favoris, messages, clics sur « Voir le numéro ».
 */
const seed = readSeed();
const L = seed.listings;
const PASSWORD = 'MotDePasse!E2E-42';
type Login = { accessToken: string; user: { id: string } };
type Stats = { views: number; favorites: number; messages: number; phoneClicks: number };

async function statsOf(token: string, listingId: string): Promise<Stats> {
  const mine = await api<Array<{ id: string; stats: Stats }>>('/listings/mine', { token });
  return mine.find((l) => l.id === listingId)!.stats;
}

/** Compte sans numéro (cas d'un compte importé) : ligne vidée directement dans la base SQLite de test. */
async function blankPhone(userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqlite3 = require('sqlite3');
  await new Promise<void>((resolve, reject) => {
    const db = new sqlite3.Database(path.resolve(__dirname, '..', 'data', 'e2e.sqlite'));
    db.run(`UPDATE users SET phoneNumber = '' WHERE id = ?`, [userId], function (this: { changes: number }, err: Error | null) {
      db.close();
      if (err) return reject(err);
      if (this.changes !== 1) return reject(new Error(`${this.changes} ligne modifiée`));
      resolve();
    });
  });
}

test('dépôt : un compte sans numéro est bloqué à l\'aperçu, puis publie une fois un mobile français saisi ; le numéro est enregistré sur le compte', async ({ page }) => {
  const id = uniq();
  const email = `sans.tel.${id}@e2e.test`;
  const reg = await api<Login>('/auth/register', { method: 'POST', body: { accountType: 'particulier', firstName: 'Sami', lastName: 'Sanstel', username: `sami_${id}`, email, phoneNumber: uniquePhone(), password: PASSWORD, passwordConfirmation: PASSWORD } });
  await blankPhone(reg.user.id);

  await mockGeo(page);
  await loginAs(page, { email, password: PASSWORD }, '/deposer');
  const title = `VTT enfant 20 pouces ${id}`;
  await page.getByLabel('Titre').fill(title);
  await page.getByTestId('category-suggestions').getByRole('button', { name: /Vélos/ }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel(/^Prix/).fill('90');
  await page.getByLabel('État', { exact: true }).selectOption('bon_etat');
  await page.getByLabel('Description').fill('VTT enfant 20 pouces en bon état, freins révisés, pneus neufs.');
  await page.getByLabel('Type *').selectOption('Enfant');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Continuer' }).click(); // photos facultatives
  await page.getByLabel('Ville ou code postal').fill('69003');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Aperçu avant publication' })).toBeVisible();

  // Sans numéro : champ obligatoire, publication impossible ; numéro invalide refusé
  const phoneField = page.getByTestId('phone-required');
  await expect(phoneField).toBeVisible();
  const publish = page.getByRole('button', { name: "Publier l'annonce" });
  await expect(publish).toBeDisabled();
  await page.getByLabel(/Numéro de mobile/).fill('01 23 45 67 89');
  await expect(phoneField.getByRole('alert')).toContainText('Numéro de mobile français invalide');
  await expect(publish).toBeDisabled();
  await page.screenshot({ path: 'test-results/depot-sans-numero.png', fullPage: true });
  // Avec un mobile français : publication acceptée, numéro enregistré sur le compte
  const phone = uniquePhone();
  await page.getByLabel(/Numéro de mobile/).fill(phone);
  await expect(publish).toBeEnabled();
  await page.getByTestId('phone-block').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/depot-avec-numero.png' });
  await publish.click();
  await expect(page).toHaveURL(/\/annonces\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  const me = await api<{ phoneNumber: string; phonePublic: boolean }>('/users/me', { token: (await api<Login>('/auth/login', { method: 'POST', body: { identifier: email, password: PASSWORD } })).accessToken });
  expect(me.phoneNumber).toBe(`+33${phone.slice(1)}`);
  expect(me.phonePublic).toBe(true);
  // Compte avec numéro : plus rien à saisir, seulement la case « Afficher mon numéro »
  await page.goto('/deposer');
  await page.getByLabel('Titre').fill('Casque vélo enfant');
  await page.getByTestId('category-suggestions').getByRole('button', { name: /Vélos/ }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel(/^Prix/).fill('15');
  await page.getByLabel('État', { exact: true }).selectOption('bon_etat');
  await page.getByLabel('Description').fill('Casque vélo enfant taille S, très peu servi.');
  await page.getByLabel('Type *').selectOption('Enfant');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Ville ou code postal').fill('69003');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByTestId('phone-required')).toHaveCount(0);
  await expect(page.getByTestId('phone-visible')).toBeChecked();
  await expect(page.getByTestId('phone-block')).toContainText(`0${phone.slice(1, 2)} ${phone.slice(2, 4)}`);
  await expect(page.getByRole('button', { name: "Publier l'annonce" })).toBeEnabled();
});

test('statistiques par annonce sur « Mes annonces » : vues, favoris, messages, clics « Voir le numéro » — propriétaire seul, à jour au retour', async ({ page, browser }) => {
  const sellerToken = (await api<Login>('/auth/login', { method: 'POST', body: { identifier: seed.seller.email, password: seed.seller.password } })).accessToken;
  const before = await statsOf(sellerToken, L.vtt.id);

  // Acheteur (membre créé pour ce scénario : une conversation par membre et par annonce) : consulte, met en favori, écrit, révèle le numéro (deux fois)
  const id = uniq();
  const visitor = { email: `visiteur.${id}@e2e.test`, password: PASSWORD };
  await api('/auth/register', { method: 'POST', body: { accountType: 'particulier', firstName: 'Vera', lastName: 'Visiteur', username: `vera_${id}`, email: visitor.email, phoneNumber: uniquePhone(), password: PASSWORD, passwordConfirmation: PASSWORD } });
  const buyerCtx = await (browser as Browser).newContext();
  const buyer = await buyerCtx.newPage();
  await loginAs(buyer, visitor, `/annonces/${L.vtt.id}`);
  await expect(buyer.getByRole('heading', { level: 1 })).toHaveText(L.vtt.title);
  await buyer.getByRole('button', { name: 'Ajouter aux favoris' }).first().click();
  await expect(buyer.getByRole('button', { name: 'Retirer des favoris' }).first()).toBeVisible();
  await buyer.getByTestId('phone-reveal').click();
  const phoneLink = buyer.getByTestId('phone-number');
  await expect(phoneLink).toHaveText(/0[67] \d{2} \d{2} \d{2} \d{2}/);
  await expect(phoneLink).toHaveAttribute('href', /^tel:\+33[67]\d{8}$/);
  await buyer.screenshot({ path: 'test-results/fiche-voir-le-numero.png' });
  await buyer.reload();
  await buyer.getByTestId('phone-reveal').click();
  await expect(buyer.getByTestId('phone-number')).toBeVisible();
  await buyer.getByRole('button', { name: 'Contacter le vendeur' }).click();
  await buyer.getByRole('dialog', { name: 'Écrire au vendeur' }).getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(buyer).toHaveURL(/\/compte\/messages\//);
  await buyerCtx.close();

  // Vendeur : la ligne de statistiques sous l'annonce reflète ces actions
  await loginAs(page, seed.seller, '/compte/annonces');
  const card = page.getByTestId('my-listing').filter({ hasText: L.vtt.title });
  const stats = card.getByTestId('listing-stats');
  await expect(stats).toBeVisible();
  const value = (key: string) => stats.getByTestId(`stat-${key}`).locator('strong');
  // Deux chargements de la fiche par l'acheteur = deux vues (d'autres scénarios joués en parallèle peuvent aussi la consulter)
  const after = await statsOf(sellerToken, L.vtt.id);
  expect(after.views).toBeGreaterThanOrEqual(before.views + 2);
  await expect(value('views')).toHaveText(String(after.views));
  await expect(value('favorites')).toHaveText(String(before.favorites + 1));
  await expect(value('messages')).toHaveText(String(before.messages + 1));
  await expect(value('phoneClicks')).toHaveText(String(before.phoneClicks + 2));
  await expect(stats.locator('li')).toHaveCount(4);
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: 'test-results/mes-annonces-statistiques.png' });

  // Mise à jour au retour sur l'onglet : une nouvelle consultation apparaît sans recharger
  await api(`/listings/${L.vtt.id}/view`, { method: 'POST', token: (await api<Login>('/auth/login', { method: 'POST', body: { identifier: visitor.email, password: PASSWORD } })).accessToken });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(value('views')).toHaveText(String((await statsOf(sellerToken, L.vtt.id)).views));
  expect((await statsOf(sellerToken, L.vtt.id)).views).toBeGreaterThanOrEqual(after.views + 1);

  // Jamais publiques : la fiche et les cartes n'exposent ni les statistiques ni le compteur d'appels
  const detail = await api<Record<string, unknown>>(`/listings/${L.vtt.id}`);
  expect(detail.stats).toBeUndefined();
  expect(detail.phoneClicksCount).toBeUndefined();
  // Brouillons : pas de statistiques (rien à compter)
  await expect(page.getByTestId('my-listing').filter({ has: page.locator('.pill', { hasText: 'Brouillon' }) }).getByTestId('listing-stats')).toHaveCount(0);

  // Numéro masqué depuis les paramètres : le bouton disparaît de la fiche
  await page.goto('/compte/parametres');
  await page.getByTestId('phone-public').uncheck();
  await expect(page.getByText('Numéro masqué sur vos annonces.')).toBeVisible();
  const anonCtx = await (browser as Browser).newContext();
  const vp = await anonCtx.newPage();
  await vp.goto(`/annonces/${L.vtt.id}`);
  await expect(vp.getByRole('heading', { level: 1 })).toHaveText(L.vtt.title);
  await expect(vp.getByTestId('phone-reveal')).toHaveCount(0);
  await anonCtx.close();
  await page.getByTestId('phone-public').check();
  await expect(page.getByText('Numéro affiché sur vos annonces.')).toBeVisible();
});
