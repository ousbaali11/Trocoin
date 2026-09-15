import { expect, test } from '@playwright/test';
import { totpCode } from '../src/auth/totp';
import { api, errorAlert, loginAs, logout, uniq, uniquePhone } from './helpers';

/**
 * Sécurité du compte (desktop) : changement d'adresse e-mail confirmé depuis la nouvelle
 * adresse, puis double authentification (activation par QR code, connexion en deux temps,
 * code de récupération, désactivation).
 */
const PASSWORD = 'MotDePasse!E2E-42';

async function registerParticulier(page: import('@playwright/test').Page) {
  const id = uniq();
  const u = { first: 'Nora', last: 'Petit', username: `nora_${id}`, email: `nora.${id}@e2e.test`, phone: uniquePhone() };
  await page.goto('/inscription');
  await page.getByLabel(/^Prénom/).fill(u.first);
  await page.getByLabel(/^Nom( du responsable)?$/).fill(u.last);
  await page.getByLabel("Nom d'utilisateur").fill(u.username);
  await page.getByLabel('E-mail', { exact: true }).fill(u.email);
  await page.getByLabel('Numéro de mobile').fill(u.phone);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirmer le mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click();
  await expect(page).toHaveURL(/\/compte$/);
  return u;
}

test("changement d'adresse e-mail : mot de passe exigé, lien envoyé à la nouvelle adresse, effectif après le clic, ancienne adresse prévenue", async ({ page }) => {
  const u = await registerParticulier(page);
  const newEmail = `nora.bis.${uniq()}@e2e.test`;
  await page.goto('/compte/parametres');
  const block = page.getByTestId('change-email');
  await block.getByRole('button', { name: "Changer d'adresse e-mail" }).click();
  await block.getByLabel('Nouvelle adresse e-mail').fill(newEmail);
  await block.getByLabel('Votre mot de passe').fill('mauvais-mot-de-passe');
  await block.getByRole('button', { name: 'Envoyer le lien de confirmation' }).click();
  await expect(errorAlert(page)).toHaveText('Mot de passe incorrect.');
  await block.getByLabel('Votre mot de passe').fill(PASSWORD);
  await block.getByRole('button', { name: 'Envoyer le lien de confirmation' }).click();
  await expect(block.getByRole('status')).toContainText(`Un lien de confirmation a été envoyé à ${newEmail}`);
  // Rien ne change avant le clic : l'ancienne adresse est toujours affichée dans les identifiants
  await expect(page.locator('#identifiants dd', { hasText: u.email })).toBeVisible();
  // L'ancienne adresse a reçu un avertissement (fournisseur simulé : sujet exposé par l'API hors production)
  const notice = await api<{ subject: string }>(`/dev/last-notice/${encodeURIComponent(u.email)}`);
  expect(notice.subject).toMatch(/demande de changement d'adresse/);

  const { link } = await api<{ link: string }>(`/dev/last-verification-link/${encodeURIComponent(newEmail)}`);
  const linkUrl = new URL(link);
  await page.goto(linkUrl.pathname + linkUrl.search);
  await expect(page.getByText(`Votre nouvelle adresse ${newEmail} est enregistrée et confirmée`)).toBeVisible();
  await page.getByRole('link', { name: 'Aller à mon compte' }).click();
  await page.goto('/compte/parametres');
  await expect(page.locator('#identifiants dd', { hasText: newEmail })).toBeVisible();
  await expect(page.locator('#identifiants dd', { hasText: u.email })).toHaveCount(0);
  await expect(page.getByTestId('email-status')).toHaveText('Adresse confirmée');
  // Connexion avec la nouvelle adresse
  await logout(page);
  await loginAs(page, { email: newEmail, password: PASSWORD });
  await expect(page).toHaveURL(/\/compte$/);
});

test('double authentification : activation par QR code, connexion en deux temps, code de récupération, désactivation', async ({ page }) => {
  const u = await registerParticulier(page);
  await page.goto('/compte/parametres');
  await expect(page.getByTestId('two-factor-status')).toHaveText('Désactivée');
  await page.getByRole('button', { name: 'Activer la double authentification' }).click();
  const dialog = page.getByRole('dialog', { name: 'Activer la double authentification' });
  await expect(dialog.getByRole('img', { name: /QR code/ })).toBeVisible();
  const secret = (await dialog.getByTestId('two-factor-secret').textContent())!.trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  // Mauvais code refusé, bon code (calculé à partir de la clé affichée, comme le ferait l'application) accepté
  await dialog.getByLabel("Code de l'application").fill('000000');
  await dialog.getByRole('button', { name: 'Activer', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Code incorrect');
  await dialog.getByLabel("Code de l'application").fill(totpCode(secret));
  await dialog.getByRole('button', { name: 'Activer', exact: true }).click();
  const codesDialog = page.getByRole('dialog', { name: 'Codes de récupération' });
  await expect(codesDialog.getByRole('status')).toContainText('La double authentification est activée.');
  const codes = await codesDialog.getByTestId('recovery-codes').getByRole('listitem').allTextContents();
  expect(codes).toHaveLength(8);
  await codesDialog.getByRole('button', { name: "J'ai noté mes codes" }).click();
  await expect(page.getByTestId('two-factor-status')).toHaveText('Activée');

  // Connexion : mot de passe puis code de l'application
  await logout(page);
  await page.goto('/connexion');
  await page.getByLabel('E-mail, nom d\'utilisateur ou mobile').fill(u.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Me connecter' }).click();
  const step = page.getByTestId('two-factor-step');
  await expect(step).toBeVisible();
  await expect(page).toHaveURL(/\/connexion/);
  await step.getByLabel("Code de l'application").fill('123456');
  await step.getByRole('button', { name: 'Valider le code' }).click();
  await expect(step.getByRole('alert')).toContainText('Code incorrect');
  // Code de récupération : accepté, et un code ne sert qu'une fois
  await step.getByLabel("Code de l'application").fill(codes[0]);
  await step.getByRole('button', { name: 'Valider le code' }).click();
  await expect(page).toHaveURL(/\/compte$/);
  await logout(page);
  await page.goto('/connexion');
  await page.getByLabel('E-mail, nom d\'utilisateur ou mobile').fill(u.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await page.getByTestId('two-factor-step').getByLabel("Code de l'application").fill(codes[0]);
  await page.getByTestId('two-factor-step').getByRole('button', { name: 'Valider le code' }).click();
  await expect(page.getByTestId('two-factor-step').getByRole('alert')).toContainText('Code incorrect');
  // Code de l'application (pas suivant pour ne pas rejouer un code déjà servi)
  await page.getByTestId('two-factor-step').getByLabel("Code de l'application").fill(totpCode(secret, Math.floor(Date.now() / 30000) + 1));
  await page.getByTestId('two-factor-step').getByRole('button', { name: 'Valider le code' }).click();
  await expect(page).toHaveURL(/\/compte$/);

  // Désactivation : mot de passe + code de récupération
  await page.goto('/compte/parametres');
  await page.getByRole('button', { name: 'Désactiver', exact: true }).click();
  const off = page.getByRole('dialog', { name: 'Désactiver la double authentification' });
  await off.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await off.getByLabel("Code de l'application ou de récupération").fill(codes[1]);
  await off.getByRole('button', { name: 'Désactiver', exact: true }).click();
  await expect(page.getByTestId('two-factor-status')).toHaveText('Désactivée');
  // La connexion redevient simple
  await logout(page);
  await loginAs(page, { email: u.email, password: PASSWORD });
  await expect(page).toHaveURL(/\/compte$/);
});
