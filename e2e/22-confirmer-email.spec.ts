import { expect, test } from '@playwright/test';
import { loginAs, readSeed } from './helpers';

/**
 * Lien de confirmation d'e-mail invalide ou expiré (AUDIT §43) : message clair, et nouvel envoi possible depuis
 * la page même (connecté) ou après connexion (anonyme), sans passer par les paramètres.
 */
const seed = readSeed();

test('jeton invalide, connecté : message clair et bouton de renvoi sur la page ; le renvoi confirme l\'envoi', async ({ page }) => {
  await loginAs(page, seed.buyer, '/confirmer-email?token=' + 'x'.repeat(43));
  const alert = page.getByTestId('confirm-email-invalid');
  await expect(alert).toContainText("Ce lien n'est plus valable");
  await expect(alert).toContainText('expiré');
  await expect(alert).toContainText('déjà été utilisé');
  const renew = page.getByTestId('confirm-email-renew');
  await expect(renew).toContainText(seed.buyer.email);
  await renew.getByRole('button', { name: /Renvoyer l'e-mail de confirmation/ }).click();
  // Envoi confirmé, ou refus temporaire si l'e-mail d'inscription date de moins d'une minute (règle serveur) :
  // dans les deux cas la demande est partie depuis cette page et le bouton entre en attente
  await expect(page.getByTestId('resend-status')).toHaveText(/E-mail envoyé à|Un e-mail vient de vous être envoyé/);
  await expect(renew.getByRole('button', { name: /Renvoyer dans \d+ s/ })).toBeDisabled();
});

test('jeton invalide, anonyme : message clair et bouton « Me connecter » qui revient sur cette page', async ({ page }) => {
  await page.goto('/confirmer-email?token=' + 'y'.repeat(43));
  await expect(page.getByTestId('confirm-email-invalid')).toContainText("Ce lien n'est plus valable");
  const login = page.getByTestId('confirm-email-login');
  await expect(login).toHaveAttribute('href', '/connexion?next=/confirmer-email');
  await login.click();
  await page.getByLabel(/E-mail, nom d'utilisateur ou mobile/).fill(seed.buyer.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(seed.buyer.password);
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await expect(page).toHaveURL(/\/confirmer-email$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recevoir un nouveau lien');
  await expect(page.getByTestId('confirm-email-renew').getByRole('button', { name: /Renvoyer l'e-mail de confirmation/ })).toBeVisible();
});
