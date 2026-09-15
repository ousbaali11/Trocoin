import { expect, test } from '@playwright/test';
import { errorAlert, loginAs, logout, readSeed } from './helpers';

/** Connexion, mauvais mot de passe, déconnexion, accès refusé à l'espace compte après déconnexion. */
const seed = readSeed();

test('connexion par e-mail puis par nom d\'utilisateur ; mauvais mot de passe refusé', async ({ page }) => {
  await page.goto('/connexion');
  await page.getByLabel("E-mail, nom d'utilisateur ou mobile").fill(seed.seller.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill('faux-mot-de-passe');
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await expect(errorAlert(page)).toBeVisible();
  await expect(page).toHaveURL(/\/connexion/);

  await loginAs(page, seed.seller);
  await expect(page.getByRole('heading', { name: `Bonjour ${seed.seller.displayName}` })).toBeVisible();
  await logout(page);

  await loginAs(page, { email: seed.seller.username, password: seed.seller.password });
  await expect(page.getByRole('heading', { name: `Bonjour ${seed.seller.displayName}` })).toBeVisible();
  await logout(page);

  // Par numéro de mobile, écrit comme on le dicte
  const national = seed.seller.phone.startsWith('+33') ? '0' + seed.seller.phone.slice(3) : seed.seller.phone;
  await loginAs(page, { email: national.replace(/(\d{2})(?=\d)/g, '$1 '), password: seed.seller.password });
  await expect(page.getByRole('heading', { name: `Bonjour ${seed.seller.displayName}` })).toBeVisible();
  await logout(page);

  // Format d'e-mail incomplet : message explicite avant tout appel au serveur
  await page.goto('/connexion');
  await page.getByLabel("E-mail, nom d'utilisateur ou mobile").fill('camille@exemple');
  await page.getByLabel('Mot de passe', { exact: true }).fill(seed.seller.password);
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await expect(errorAlert(page)).toContainText("Cette adresse e-mail n'est pas complète");
});

test('après déconnexion, l\'espace compte redirige vers la connexion et le jeton local est effacé', async ({ page }) => {
  await loginAs(page, seed.seller);
  await logout(page);
  await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('trocoin_token')), { message: 'jeton local effacé' }).toBeNull();

  await page.goto('/compte/annonces');
  await expect(page).toHaveURL(/\/connexion\?next=%2Fcompte%2Fannonces/);
  await expect(page.getByText('Connectez-vous pour continuer votre action.')).toBeVisible();

  // Même chose pour la console d'administration
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/connexion\?next=%2Fadmin/);
});

test('un compte non administrateur ne peut pas ouvrir la console', async ({ page }) => {
  await loginAs(page, seed.buyer);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/$/);
});
