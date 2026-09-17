import { defineConfig, devices } from '@playwright/test';

/**
 * Tests de bout en bout dans un vrai navigateur (Chromium), contre :
 *  - l'API compilée (`dist/main.js`, base SQLite jetable `data/e2e.sqlite`, fournisseurs mock :
 *    SMS, paiement, e-mail, registre Sirene) — voir e2e/start-api.js ;
 *  - le front construit (`next build` puis `next start`, URL d'API http://localhost:3000).
 *
 * Préparer : `npm run e2e:build`   ·   Lancer : `npm run e2e`   ·   Voir le rapport : `npx playwright show-report`
 *
 * Les scénarios partagent une même base et s'exécutent dans l'ordre des fichiers (un seul worker) :
 * 01 recherche (données du seed intactes) → 02 inscription → 03 connexion → 04 dépôt → 05 achat → 06 admin.
 * Le projet « mobile » (375 px) joue recherche et inscription EN PREMIER (seed intact) pour capter
 * les régressions visuelles ; le projet « desktop » enchaîne ensuite les six scénarios.
 */
const FRONT = process.env.E2E_FRONT_URL || 'http://localhost:3001';
const API = process.env.E2E_API_URL || 'http://localhost:3000';
const FRONT_PORT = new URL(FRONT).port || '80';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: FRONT,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'mobile',
      // Joué EN PREMIER : la recherche s'appuie sur le seed intact (l'achat et l'admin du projet
      // desktop modifient des annonces). 375 px : la largeur qui a révélé les régressions du polish.
      use: { ...devices['Pixel 5'], viewport: { width: 375, height: 812 } },
      testMatch: /(01-recherche|02-inscription|11-marges-mobile|14-filtres-decouverte|15-experience|16-profils|19-session|24-remise-saisie|25-retour-paiement|26-suivi-messagerie)\.spec\.ts/,
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: [
    {
      command: 'node e2e/start-api.js',
      env: { E2E_API_URL: API, E2E_FRONT_URL: FRONT },
      url: `${API}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npm run start --prefix frontend -- -p ${FRONT_PORT}`,
      url: FRONT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
