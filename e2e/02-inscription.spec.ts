import { expect, test } from '@playwright/test';
import { api, errorAlert, expectNoHorizontalOverflow, logout, uniq, uniquePhone } from './helpers';

/**
 * Inscription particulier (formulaire complet, mot de passe, doublon refusé) et
 * professionnel (SIRET valide, clé de contrôle fausse, SIRET absent du registre).
 * Joué en desktop ET en mobile (375 px).
 */
const PASSWORD = 'MotDePasse!E2E-42';

async function fillCommon(page: import('@playwright/test').Page, u: { first: string; last: string; username: string; email: string; phone: string }) {
  await page.getByLabel(/^Prénom/).fill(u.first);
  await page.getByLabel(/^Nom( du responsable)?$/).fill(u.last);
  await page.getByLabel("Nom d'utilisateur").fill(u.username);
  await page.getByLabel('E-mail', { exact: true }).fill(u.email);
  await page.getByLabel('Numéro de mobile').fill(u.phone);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirmer le mot de passe').fill(PASSWORD);
}

test('particulier : inscription complète puis doublon d\'e-mail et de téléphone refusés avec le bon message', async ({ page }) => {
  const id = uniq();
  const u = { first: 'Léa', last: 'Martin', username: `lea_${id}`, email: `lea.${id}@e2e.test`, phone: uniquePhone() };
  await page.goto('/inscription');
  await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible();
  // Mesuré une fois le formulaire (composant client) rendu, jamais sur le squelette vide
  await expectNoHorizontalOverflow(page);

  // La confirmation doit correspondre : le bouton reste inactif tant que ce n'est pas le cas
  await fillCommon(page, u);
  await page.getByLabel('Confirmer le mot de passe').fill(PASSWORD + 'x');
  await expect(page.getByText('Les deux mots de passe ne correspondent pas.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Créer mon compte', exact: true })).toBeDisabled();
  await page.getByLabel('Confirmer le mot de passe').fill(PASSWORD);

  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click();
  await expect(page).toHaveURL(/\/compte$/);
  await expect(page.getByRole('heading', { name: /Bonjour Léa M\./ })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Adresse pas encore confirmée : rappel visible, compte utilisable, statut et bouton dans les paramètres
  const banner = page.getByTestId('email-verification-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(u.email);
  await page.goto('/compte/parametres');
  await expect(page.getByTestId('email-status')).toHaveText('Adresse non confirmée');
  await page.getByRole('button', { name: "Renvoyer l'e-mail de confirmation" }).click();
  // Moins d'une minute après l'e-mail d'inscription : le serveur refuse, le bouton se met en attente
  await expect(page.getByText(/Patientez une minute/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Renvoyer dans \d+ s/ })).toBeDisabled();

  // Lien reçu par e-mail (fournisseur simulé en e2e : l'API hors production expose le dernier lien envoyé)
  const { link } = await api<{ link: string }>(`/dev/last-verification-link/${encodeURIComponent(u.email)}`);
  expect(link).toContain('/confirmer-email?token=');
  const linkUrl = new URL(link);
  await page.goto(linkUrl.pathname + linkUrl.search);
  await expect(page.getByText(`Votre adresse ${u.email} est confirmée`)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: 'Aller à mon compte' }).click();
  await expect(page).toHaveURL(/\/compte$/);
  await expect(page.getByTestId('email-verification-banner')).toHaveCount(0);
  await page.goto('/compte/parametres');
  await expect(page.getByTestId('email-status')).toHaveText('Adresse confirmée');
  await expect(page.getByRole('button', { name: "Renvoyer l'e-mail de confirmation" })).toHaveCount(0);

  // Le lien ne sert qu'une fois
  await page.goto(linkUrl.pathname + linkUrl.search);
  await expect(errorAlert(page)).toContainText('invalide ou expiré');
  await logout(page);

  // Doublon : même e-mail
  await page.goto('/inscription');
  await fillCommon(page, { ...u, username: `autre_${id}`, phone: uniquePhone() });
  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click();
  await expect(errorAlert(page)).toHaveText('Cette adresse e-mail est déjà utilisée.');
  await expect(page).toHaveURL(/\/inscription/);

  // Doublon : même téléphone
  await page.getByLabel('E-mail', { exact: true }).fill(`autre.${id}@e2e.test`);
  await page.getByLabel('Numéro de mobile').fill(u.phone);
  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click();
  await expect(errorAlert(page)).toHaveText('Ce numéro de téléphone est déjà associé à un compte.');
});

test('professionnel : SIRET valide accepté, clé de contrôle fausse bloquée, SIRET inconnu du registre refusé', async ({ page }, testInfo) => {
  const id = uniq();
  // Un SIRET ne peut être rattaché qu'à un seul compte : chaque projet (mobile, desktop) utilise le sien parmi les SIRET « actifs » du registre simulé
  const validSiret = testInfo.project.name === 'mobile' ? '44306184100047' : '73282932000074';
  await page.goto('/inscription');
  await page.getByRole('tab', { name: 'Professionnel' }).click();
  await page.getByLabel('Raison sociale').fill(`Garage E2E ${id}`);

  // Clé de contrôle fausse (Luhn) : message immédiat, bouton inactif
  await page.getByLabel(/Numéro SIRET/).fill('73282932000075');
  await expect(page.getByText('Clé de contrôle incorrecte : vérifiez le numéro.')).toBeVisible();
  await fillCommon(page, { first: 'Paul', last: 'Garage', username: `garage_${id}`, email: `garage.${id}@e2e.test`, phone: uniquePhone() });
  await expect(page.getByRole('button', { name: 'Créer mon compte professionnel' })).toBeDisabled();

  // Clé valide mais établissement inconnu du registre (simulé) : refus explicite de l'API
  await page.getByLabel(/Numéro SIRET/).fill('88800012300008');
  await expect(page.getByText('✓ Clé de contrôle valide')).toBeVisible();
  await page.getByRole('button', { name: 'Créer mon compte professionnel' }).click();
  await expect(errorAlert(page)).toContainText('SIRET introuvable dans le registre des entreprises');

  // SIRET valide et actif (simulé) : compte professionnel créé
  await page.getByLabel(/Numéro SIRET/).fill(validSiret);
  await page.getByRole('button', { name: 'Créer mon compte professionnel' }).click();
  await expect(page).toHaveURL(/\/compte$/);
  await page.goto('/compte/parametres');
  await expect(page.getByRole('heading', { name: 'Ma boutique' })).toBeVisible();
  await expect(page.getByText('vérifié au registre des entreprises')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
