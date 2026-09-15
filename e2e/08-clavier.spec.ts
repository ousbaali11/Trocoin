import { expect, test } from '@playwright/test';
import { mockGeo, readSeed } from './helpers';

/**
 * Navigation au clavier seul (aucun clic de souris) sur les parcours critiques :
 * lien d'évitement, recherche avec localisation et rayon, menu du compte et déconnexion,
 * boîte de dialogue (focus confiné, Échap, retour du focus), dépôt d'annonce (catégorie, étapes).
 */
const seed = readSeed();
const L = seed.listings;

const active = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}:${(el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).placeholder || '').trim().slice(0, 40)}` : 'none';
  });

test.beforeEach(async ({ page }) => mockGeo(page));

test("lien d'évitement puis recherche complète au clavier : mots-clés, commune, rayon 1 km, tri par distance", async ({ page }) => {
  await page.goto('/');
  // Première tabulation : « Aller au contenu », activé avec Entrée → le focus passe au contenu principal
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await active(page)).toMatch(/^main#contenu/);

  // Champ « QUOI ? » puis « OÙ ? » par tabulation
  await page.getByPlaceholder('QUOI ?').focus();
  await page.keyboard.type('vtt');
  await page.keyboard.press('Tab');
  await expect(page.getByPlaceholder('OÙ ?')).toBeFocused();
  await page.keyboard.type('Lyon');
  // Les suggestions sont des boutons atteignables au clavier
  const option = page.getByRole('button', { name: 'Lyon (69003)' });
  await expect(option).toBeVisible();
  await option.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('radius-panel');
  await expect(panel).toContainText('Dans un rayon de 5 km');
  // Le curseur de rayon se règle aux flèches (paliers exacts : 5 → 1 km)
  const slider = panel.getByRole('slider');
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(panel).toContainText('Dans un rayon de 1 km');
  await expect(slider).toHaveAttribute('aria-valuetext', '1 km');
  // Échap ferme le panneau sans perdre le lieu, puis Entrée dans le formulaire lance la recherche
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByPlaceholder('OÙ ?')).toHaveValue('Lyon (69003) · 1 km');
  await page.getByRole('button', { name: 'Rechercher' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/recherche\?.*radius=1/);
  await expect(page.getByRole('link', { name: L.vtt.title, exact: true }).first()).toBeVisible();
  // Le nombre de résultats est annoncé (zone aria-live)
  await expect(page.locator('[aria-live="polite"]', { hasText: /annonce/ }).first()).toContainText('1 annonce');
});

test('menu du compte : ouverture, déconnexion et fermeture par Échap au clavier', async ({ page }) => {
  await page.goto('/connexion');
  await page.getByLabel("E-mail, nom d'utilisateur ou mobile").focus();
  await page.keyboard.type(seed.buyer.email);
  const pwd = page.getByLabel('Mot de passe', { exact: true });
  await pwd.focus();
  await page.keyboard.type(seed.buyer.password);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/compte$/);

  const menuBtn = page.getByRole('button', { name: /^Mon compte/ });
  await menuBtn.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Mon tableau de bord' })).toBeVisible();
  // Échap referme et rend le focus au bouton
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Mon tableau de bord' })).toHaveCount(0);
  await expect(menuBtn).toBeFocused();
  // Tabulation jusqu'à « Se déconnecter » puis Entrée
  await page.keyboard.press('Enter');
  const logoutItem = page.getByRole('menuitem', { name: 'Se déconnecter' });
  await logoutItem.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible();
});

test('boîte de dialogue « Écrire au vendeur » : focus placé dedans, confiné, Échap et retour du focus', async ({ page }) => {
  // Le VTT reste en ligne à ce stade (la PlayStation est vendue par le scénario d'achat)
  await page.goto('/connexion?next=' + encodeURIComponent(`/annonces/${L.vtt.id}`));
  await page.getByLabel("E-mail, nom d'utilisateur ou mobile").fill(seed.buyer.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(seed.buyer.password);
  await page.keyboard.press('Enter');
  const opener = page.getByRole('button', { name: 'Contacter le vendeur' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Écrire au vendeur' });
  await expect(dialog).toBeVisible();
  // Le focus est dans la boîte, sur le champ de message
  await expect(dialog.getByLabel('Votre message')).toBeFocused();
  // Tabuler 12 fois ne sort jamais de la boîte
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('dépôt : catégorie choisie aux flèches, étapes validées avec Entrée, erreur annoncée', async ({ page }) => {
  await page.goto('/connexion?next=%2Fdeposer');
  await page.getByLabel("E-mail, nom d'utilisateur ou mobile").fill(seed.seller.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(seed.seller.password);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Déposer une annonce' })).toBeVisible();
  // Continuer sans catégorie : le message d'erreur est un role=alert
  await page.getByRole('button', { name: 'Continuer' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.alert-error[role="alert"]')).toHaveText('Choisissez une catégorie.');
  // Choix par le groupe radio (Espace) puis flèche : Voitures → Motos
  const voitures = page.getByRole('radio', { name: 'Voitures' });
  await voitures.focus();
  await page.keyboard.press('Space');
  await expect(voitures).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Motos' })).toBeChecked();
  await page.getByRole('button', { name: 'Continuer' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Décrivez votre bien' })).toBeVisible();
  // Étape « Photos » : le champ fichier est atteignable au clavier (rendu hors écran, pas masqué)
  await page.getByLabel('Titre').fill('Moto de test clavier');
  await page.getByLabel(/^Prix/).fill('2500');
  await page.getByLabel('Description').fill('Description assez longue pour la validation.');
  for (const [label, value] of [['Marque *', 'Yamaha'], ['Modèle *', 'MT-07'], [/^Année/, '2020'], [/^Kilométrage/, '12000'], [/^Cylindrée/, '689']] as const) await page.getByLabel(label).fill(value);
  await page.getByRole('button', { name: 'Continuer' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Ajoutez des photos' })).toBeVisible();
  await page.getByLabel('Choisir des photos').focus();
  expect(await active(page)).toMatch(/^input:Choisir des photos/);
});
