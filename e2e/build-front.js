/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * `next build` du front avec l'URL de l'API de test injectée (les variables NEXT_PUBLIC_*
 * sont figées au build). Les variables d'environnement priment sur frontend/.env.local.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const front = path.resolve(__dirname, '..', 'frontend');
const env = { ...process.env, NEXT_PUBLIC_API_URL: process.env.E2E_API_URL || 'http://localhost:3000', NEXT_PUBLIC_SITE_URL: process.env.E2E_FRONT_URL || 'http://localhost:3001' };
const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'build'], { cwd: front, env, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
