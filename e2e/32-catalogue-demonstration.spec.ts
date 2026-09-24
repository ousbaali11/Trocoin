import { expect, test } from '@playwright/test';
import { loginAs, readSeed } from './helpers';

/**
 * Catalogue de démonstration (AUDIT §71) : la page de la console présente le jeu de données (600 annonces, 50 comptes,
 * répartition par famille) et les commandes (lancer, identifiants) sans rien créer ici — l'ensemencement réel est couvert
 * par le test API phase43 et par la répétition locale documentée.
 */
test('console : page « Catalogue de démonstration » — jeu de données, répartition, commandes, réservée aux administrateurs', async ({ page }) => {
  const seed = readSeed();
  await loginAs(page, seed.admin, '/admin/demonstration');
  await expect(page.getByRole('heading', { level: 1, name: 'Catalogue de démonstration' })).toBeVisible();
  await expect(page.getByTestId('demo-accounts')).toHaveText(/^50 \/ \d+$/);
  await expect(page.getByTestId('demo-listings')).toHaveText(/^600 \/ \d+ \/ \d+$/);
  await expect(page.getByRole('cell', { name: 'Véhicules' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Locations de vacances' })).toBeVisible();
  // Le bouton n'est actif que lorsque les photos du jeu de données sont résolues (sinon un message l'explique)
  const missing = page.getByTestId('demo-photos-missing');
  if (await missing.count()) await expect(page.getByTestId('demo-run')).toBeDisabled(); else await expect(page.getByTestId('demo-run')).toBeEnabled();
  await expect(page.getByTestId('demo-credentials')).toBeDisabled();
  // Lien de navigation présent dans la console
  await expect(page.getByRole('link', { name: 'Catalogue de démonstration' })).toHaveAttribute('aria-current', 'page');
});
