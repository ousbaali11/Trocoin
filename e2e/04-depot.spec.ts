import { expect, test, type Page } from '@playwright/test';
import { errorAlert, loginAs, mockGeo, readSeed } from './helpers';

/**
 * Dépôt d'annonce avec photos dans deux catégories aux champs très différents :
 * Véhicules › Voitures (marque, modèle, année, kilométrage, carburant, boîte…) et
 * Locations de vacances (type d'hébergement, voyageurs, piscine…, prix par semaine).
 */
const seed = readSeed();

async function addPhotos(page: Page, files: string[]) {
  await page.locator('input[type=file]').setInputFiles(files);
  // Un recadrage est proposé pour la première photo : on garde l'original
  await page.getByRole('button', { name: "Garder l'original" }).click();
  await expect(page.getByText('Couverture', { exact: true })).toBeVisible();
}

test('voiture : critères obligatoires, deux photos, localisation par code postal, publication', async ({ page }) => {
  await mockGeo(page);
  await loginAs(page, seed.seller, '/deposer');
  await expect(page.getByRole('heading', { name: 'Déposer une annonce' })).toBeVisible();

  // Étape 1 : catégorie — impossible de continuer sans choix
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(errorAlert(page)).toHaveText('Choisissez une catégorie.');
  await page.getByRole('radio', { name: 'Voitures' }).check();
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Étape 2 : description — les critères obligatoires de la catégorie bloquent
  const title = `Peugeot 208 PureTech 2019 ${Date.now().toString().slice(-5)}`;
  await page.getByLabel('Titre').fill(title);
  await page.getByLabel(/^Prix/).fill('11900');
  await page.getByLabel('État', { exact: true }).selectOption('bon_etat');
  await page.getByLabel('Description').fill('Peugeot 208 essence, boîte manuelle, entretien à jour, carnet et factures disponibles. Aucun frais à prévoir, contrôle technique récent.');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(errorAlert(page)).toContainText('Le champ « Marque » est obligatoire.');
  await page.getByLabel('Marque *').selectOption('Peugeot');
  // Liste dépendante : le modèle n'est proposé qu'une fois la marque choisie
  await expect(page.getByLabel('Modèle *')).toBeEnabled();
  await page.getByLabel('Modèle *').selectOption('208');
  await page.getByLabel(/^Année/).fill('2019');
  await page.getByLabel(/^Kilométrage/).fill('58000');
  await page.getByLabel(/^Carburant/).selectOption('Essence');
  await page.getByLabel(/^Boîte/).selectOption('Manuelle');
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Étape 3 : photos
  await expect(page.getByRole('heading', { name: 'Ajoutez des photos' })).toBeVisible();
  await addPhotos(page, seed.photos);
  await expect(page.getByText('À envoyer')).toHaveCount(2);
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Étape 4 : localisation — obligatoire, code postal accepté
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(errorAlert(page)).toHaveText('Indiquez une ville ou un code postal.');
  await page.getByLabel('Ville ou code postal').fill('69003');
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Étape 5 : aperçu puis publication
  await expect(page.getByRole('heading', { name: 'Aperçu avant publication' })).toBeVisible();
  await expect(page.getByText('Marque : Peugeot')).toBeVisible();
  await page.getByRole('button', { name: "Publier l'annonce" }).click();
  await expect(page).toHaveURL(/\/annonces\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByText('11 900 €', { exact: true })).toBeVisible();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voir la photo 2' })).toBeVisible();
  const specs = page.getByRole('heading', { name: 'Caractéristiques' }).locator('..');
  await expect(specs).toContainText('Peugeot');
  await expect(specs).toContainText('58000 km');
  await expect(page.getByText("C'est votre annonce")).toBeVisible();
});

test('location de vacances : champs propres à la famille, prix par semaine, une photo, commune choisie', async ({ page }) => {
  await mockGeo(page);
  await loginAs(page, seed.seller, '/deposer');
  await page.getByRole('radio', { name: 'Locations de vacances' }).check();
  await page.getByRole('button', { name: 'Continuer' }).click();

  await expect(page.getByRole('heading', { name: 'Décrivez votre hébergement' })).toBeVisible();
  const title = `Chalet avec vue lac, 6 personnes ${Date.now().toString().slice(-5)}`;
  await page.getByLabel('Titre').fill(title);
  await expect(page.getByLabel('Prix (€) par semaine')).toBeVisible();
  await page.getByLabel('Prix (€) par semaine').fill('1400');
  // Pas de champ « État » pour un hébergement
  await expect(page.getByLabel('État', { exact: true })).toHaveCount(0);
  await page.getByLabel(/^Type d'hébergement/).selectOption('Chalets');
  await page.getByLabel(/^Nombre de voyageurs/).selectOption({ index: 3 });
  await page.getByLabel('Piscine').check();
  await page.getByLabel(/^Chambres/).fill('3');
  await page.getByLabel('Description').fill('Chalet en bois avec terrasse plein sud, trois chambres, vue sur le lac. Draps fournis, parking privé, animaux acceptés sur demande.');
  await page.getByRole('button', { name: 'Continuer' }).click();

  await addPhotos(page, [seed.photos[0]]);
  await page.getByRole('button', { name: 'Continuer' }).click();

  await expect(page.getByRole('heading', { name: "Où se trouve l'hébergement ?" })).toBeVisible();
  await page.getByLabel('Ville ou code postal').fill('Annecy');
  await page.getByRole('option', { name: 'Annecy (74000)' }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Piscine : Oui')).toBeVisible();
  await page.getByRole('button', { name: "Publier l'annonce" }).click();

  await expect(page).toHaveURL(/\/annonces\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByText('Annecy (74000)')).toBeVisible();
  const specs = page.getByRole('heading', { name: 'Caractéristiques' }).locator('..');
  await expect(specs).toContainText('Chalets');
  await expect(specs).toContainText('Piscine');
  await expect(page.getByText('1 / 1')).toBeVisible();
});
