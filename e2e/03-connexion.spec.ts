import { expect, test } from '@playwright/test';
import { errorAlert, loginAs, logout, readSeed } from './helpers';

/** Connexion, mauvais mot de passe, déconnexion, accès refusé à l'espace compte après déconnexion. */
const seed = readSeed();

test('connexion par e-mail puis par nom d\'utilisateur ; mauvais mot de passe refusé', async ({ page }) => {
  await page.goto('/connexion');
  await page.getByLabel("E-mail ou nom d'utilisateur").fill(seed.seller.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill('faux-mot-de-passe');
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await expect(errorAlert(page)).toBeVisible();
  await expect(page).toHaveURL(/\/connexion/);

  await loginAs(page, seed.seller);
  await expect(page.getByRole('heading', { name: `Bonjour ${seed.seller.displayName}` })).toBeVisible();
  await logout(page);

  await loginAs(page, { email: seed.seller.username, password: seed.seller.password });
  await expect(page.getByRole('heading', { name: `Bonjour ${seed.seller.displayName}` })).toBeVisible();
});

test('après déconnexion, l\'espace compte redirige vers la connexion et le jeton local est effacé', async ({ page }) => {
  await loginAs(page, seed.seller);
  await logout(page);
  await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('trocoin_token'))).toBeNull();

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
