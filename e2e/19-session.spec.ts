import { expect, test, type Browser, type Page } from '@playwright/test';
import { totpCode } from '../src/auth/totp';
import { API, api, loginAs, logout, readSeed, uniq, uniquePhone } from './helpers';

/**
 * Rester connecté après la fermeture du navigateur (brief du 16 septembre 2026) : la session vit
 * dans localStorage (jeton d'accès 15 min + jeton de renouvellement 30 jours glissants). Un retour
 * après expiration du jeton d'accès renouvelle la session en silence ; seule la déconnexion
 * explicite efface tout (localement et côté serveur). La double authentification n'est demandée
 * qu'à la connexion par mot de passe, jamais au retour. Joué sur bureau et sur mobile.
 */
const seed = readSeed();
const TOKEN = 'trocoin_token';
const REFRESH = 'trocoin_refresh';
/** Jeton d'accès « expiré » : structure JWT valide, signature quelconque — l'API répond 401, comme après 15 min. */
const EXPIRED = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"x","exp":1}').toString('base64url')}.c2lnbmF0dXJl`;

async function storedSession(page: Page) {
  return page.evaluate(([t, r]) => ({ token: localStorage.getItem(t), refresh: localStorage.getItem(r) }), [TOKEN, REFRESH]);
}

/**
 * « Fermer complètement le navigateur puis revenir » : nouveau contexte (nouveau processus, cookies et
 * mémoire vides), seul le stockage local du site est restauré, comme le fait un vrai navigateur.
 */
async function reopen(browser: Browser, session: { token: string | null; refresh: string | null }) {
  const project = test.info().project.use;
  const ctx = await browser.newContext({ viewport: project.viewport ?? undefined, isMobile: project.isMobile, hasTouch: project.hasTouch, userAgent: project.userAgent, deviceScaleFactor: project.deviceScaleFactor, baseURL: project.baseURL });
  await ctx.addInitScript(([t, r, s]) => {
    if (s.token) localStorage.setItem(t, s.token); else localStorage.removeItem(t);
    if (s.refresh) localStorage.setItem(r, s.refresh); else localStorage.removeItem(r);
  }, [TOKEN, REFRESH, session] as const);
  return ctx;
}

test('fermeture du navigateur puis retour après expiration du jeton d\'accès : toujours connecté, session renouvelée en silence', async ({ page, browser }) => {
  await loginAs(page, seed.buyer, '/compte');
  const before = await storedSession(page);
  expect(before.token).toBeTruthy();
  expect(before.refresh).toBeTruthy();
  await page.close();

  // Retour « plus tard » : le jeton d'accès a expiré, le jeton de renouvellement est intact
  const ctx = await reopen(browser, { token: EXPIRED, refresh: before.refresh });
  const back = await ctx.newPage();
  await back.goto('/compte');
  await expect(back).toHaveURL(/\/compte$/);
  await expect(back.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(back.getByRole('button', { name: /^Mon compte/ }).or(back.getByRole('button', { name: 'Menu', exact: true }))).toBeVisible();
  const after = await storedSession(back);
  expect(after.token).not.toBe(EXPIRED); // nouveau jeton d'accès
  expect(after.refresh).not.toBe(before.refresh); // jeton de renouvellement tourné
  // L'ancien jeton de renouvellement, présenté dans la foulée (second onglet), ne casse pas la session
  const reuse = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: before.refresh }) });
  expect(reuse.status).toBe(401);
  await back.reload();
  await expect(back).toHaveURL(/\/compte$/);
  await expect(back.getByRole('heading', { level: 1 })).toBeVisible();
  await ctx.close();
});

test('« Se déconnecter » efface tout : au retour, le site redemande de se connecter et l\'ancien jeton est refusé par le serveur', async ({ page, browser }) => {
  await loginAs(page, seed.buyer, '/compte');
  const before = await storedSession(page);
  await logout(page);
  const cleared = await storedSession(page);
  expect(cleared).toEqual({ token: null, refresh: null });
  await page.close();

  // Même un navigateur qui aurait gardé l'ancien jeton de renouvellement (copie, sauvegarde) ne peut pas
  // reprendre la session une fois le jeton d'accès expiré (≤ 15 min) : le serveur l'a révoqué
  const ctx = await reopen(browser, { token: EXPIRED, refresh: before.refresh });
  const back = await ctx.newPage();
  await back.goto('/compte');
  await expect(back).toHaveURL(/\/connexion\?next=%2Fcompte/);
  expect(await storedSession(back)).toEqual({ token: null, refresh: null });
  const refused = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: before.refresh }) });
  expect(refused.status).toBe(401);
  await ctx.close();
});

test('double authentification : code demandé à la connexion par mot de passe seulement, pas au retour après expiration', async ({ page, browser, isMobile }) => {
  test.skip(!!isMobile, 'bureau uniquement (même mécanique de session que le scénario précédent)');
  // Compte avec 2FA activée (par l'API, comme depuis les paramètres)
  const id = uniq();
  const password = 'MotDePasse!E2E-42';
  const reg = await api<{ accessToken: string }>('/auth/register', { method: 'POST', body: { accountType: 'particulier', firstName: 'Imane', lastName: 'Sessions', username: `imane_${id}`, email: `imane.${id}@e2e.test`, phoneNumber: uniquePhone(), password, passwordConfirmation: password } });
  const setup = await api<{ secret: string }>('/auth/2fa/setup', { method: 'POST', token: reg.accessToken });
  await api('/auth/2fa/enable', { method: 'POST', token: reg.accessToken, body: { code: totpCode(setup.secret) } });

  await page.goto('/connexion?next=%2Fcompte');
  await page.getByLabel("E-mail, nom d'utilisateur ou mobile").fill(`imane.${id}@e2e.test`);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Me connecter' }).click();
  const step = page.getByTestId('two-factor-step');
  await expect(step).toBeVisible();
  // Un code ne sert qu'une fois (celui de l'activation vient d'être consommé) : code du pas suivant
  await step.getByLabel("Code de l'application").fill(totpCode(setup.secret, Math.floor(Date.now() / 30000) + 1));
  await step.getByRole('button', { name: 'Valider le code' }).click();
  await expect(page).toHaveURL(/\/compte$/);
  const before = await storedSession(page);
  await page.close();

  const ctx = await reopen(browser, { token: EXPIRED, refresh: before.refresh });
  const back = await ctx.newPage();
  await back.goto('/compte');
  await expect(back).toHaveURL(/\/compte$/);
  await expect(back.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(back.getByTestId('two-factor-step')).toHaveCount(0);
  await ctx.close();
});
