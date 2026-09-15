import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { api, mockGeo, readSeed } from './helpers';

/**
 * Pages de profil (vendeur particulier, boutique professionnelle) en sections repliables :
 * annonces ouvertes d'emblée, avis et informations de la boutique repliés ; en-têtes = boutons avec
 * aria-expanded, clavier, état mémorisé pour la session ; aucune violation axe, sections ouvertes ou non.
 */
const seed = readSeed();
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

test.beforeEach(async ({ page }) => mockGeo(page));

test('profil particulier : annonces dépliées, avis repliés, ouverture au clavier, état mémorisé après rechargement', async ({ page }) => {
  await page.goto(`/vendeurs/${seed.seller.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const annonces = page.getByTestId('filter-section-annonces');
  const avis = page.getByTestId('filter-section-avis');
  await expect(annonces.getByRole('button', { name: /^Annonces en ligne \(\d+\)$/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(annonces.getByRole('link', { name: seed.listings.vtt.title, exact: true }).first()).toBeVisible();
  const avisBtn = avis.getByRole('button', { name: /^Avis reçus \(\d+\)$/ });
  await expect(avisBtn).toHaveAttribute('aria-expanded', 'false');
  await expect(avis.getByText(/Pas encore d'avis|Membre/).first()).toBeHidden();
  await expect(page.getByTestId('filter-section-boutique')).toHaveCount(0); // pas d'informations de boutique pour un particulier

  // Clavier : Entrée sur l'en-tête ouvre la section, Espace la referme
  await avisBtn.focus();
  await page.keyboard.press('Enter');
  await expect(avisBtn).toHaveAttribute('aria-expanded', 'true');
  await expect(avis.getByText(/Pas encore d'avis|Membre/).first()).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((v) => `${v.id} → ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  await page.keyboard.press('Space');
  await expect(avisBtn).toHaveAttribute('aria-expanded', 'false');

  // Mémorisé pour la session : annonces repliées à la souris, puis rechargement
  await annonces.getByRole('button', { name: /^Annonces en ligne/ }).click();
  await expect(annonces.getByRole('button', { name: /^Annonces en ligne/ })).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.getByTestId('filter-section-annonces').getByRole('button', { name: /^Annonces en ligne/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('filter-section-annonces').getByRole('link', { name: seed.listings.vtt.title, exact: true }).first()).toBeHidden();
  await page.getByTestId('filter-section-annonces').getByRole('button', { name: /^Annonces en ligne/ }).click();
  await expect(page.getByTestId('filter-section-annonces').getByRole('link', { name: seed.listings.vtt.title, exact: true }).first()).toBeVisible();
});

test('boutique professionnelle : section « Informations de la boutique » repliée avec adresse, horaires et site ; axe sans violation', async ({ page }, testInfo) => {
  // Compte pro créé pour le scénario (SIRET « actif » du registre simulé, distinct de ceux du scénario 02)
  const suffix = testInfo.project.name === 'mobile' ? 'm' : 'd';
  const email = `boutique.${suffix}.${Date.now()}@e2e.test`;
  const password = 'MotDePasse!E2E-42';
  const siret = '55208131766522';
  const reg = await api<{ accessToken: string; user: { id: string } }>('/auth/register', {
    method: 'POST',
    body: { accountType: 'professionnel', firstName: 'Nadia', lastName: 'Bertin', username: `garage_${suffix}_${Date.now().toString().slice(-6)}`, email, phoneNumber: '06' + String(Date.now()).slice(-8), password, passwordConfirmation: password, companyName: 'Garage Bertin', siret },
  }).catch(async () => {
    // SIRET déjà rattaché (scénario rejoué) : on se connecte au compte existant
    return api<{ accessToken: string; user: { id: string } }>('/auth/login', { method: 'POST', body: { identifier: email, password } });
  });
  const token = reg.accessToken;
  await api('/users/me', { method: 'PATCH', token, body: { shopName: 'Garage Bertin', shopDescription: 'Véhicules révisés et garantis 6 mois.', shopAddress: '14 avenue Berthelot, 69007 Lyon', shopHours: 'Lun–Ven 8h30–18h30', shopWebsite: 'https://garage-bertin.example' } });
  const me = await api<{ id: string }>('/users/me', { token });

  await page.goto(`/vendeurs/${me.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Garage Bertin');
  await expect(page.getByText('Boutique professionnelle')).toBeVisible();
  const boutique = page.getByTestId('filter-section-boutique');
  const btn = boutique.getByRole('button', { name: 'Informations de la boutique' });
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(boutique.getByText('14 avenue Berthelot')).toBeHidden();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(boutique.getByText('14 avenue Berthelot, 69007 Lyon')).toBeVisible();
  await expect(boutique.getByText('Lun–Ven 8h30–18h30')).toBeVisible();
  await expect(boutique.getByRole('link', { name: 'https://garage-bertin.example' })).toHaveAttribute('rel', /nofollow/);
  await expect(page.getByTestId('filter-section-annonces').getByRole('button', { name: /^Annonces en ligne \(0\)$/ })).toHaveAttribute('aria-expanded', 'true');
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((v) => `${v.id} → ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  await api('/users/me', { method: 'DELETE', token }).catch(() => undefined);
});
