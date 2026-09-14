/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Démarre l'API COMPILÉE (dist/main.js) pour les tests navigateur, avec une base SQLite
 * jetable et des fournisseurs simulés. Aucune clé réelle n'est nécessaire : SMS, paiement,
 * e-mail et registre des entreprises sont en mode mock (autorisés hors production).
 * Les variables ci-dessous priment sur .env (dotenv n'écrase jamais l'environnement).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const db = path.join(root, 'data', 'e2e.sqlite');
if (!fs.existsSync(path.join(root, 'dist', 'main.js'))) {
  console.error('dist/main.js introuvable : lancez `npm run e2e:build` (ou `npm run build`) avant les tests navigateur.');
  process.exit(1);
}
fs.mkdirSync(path.dirname(db), { recursive: true });
for (const f of [db, `${db}-journal`]) if (fs.existsSync(f)) fs.unlinkSync(f);

const apiUrl = new URL(process.env.E2E_API_URL || 'http://localhost:3000');
const frontUrl = (process.env.E2E_FRONT_URL || 'http://localhost:3001').replace(/\/$/, '');
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: apiUrl.port || '3000',
  DB_TYPE: 'sqlite',
  DB_PATH: db,
  DB_SYNCHRONIZE: 'true',
  JWT_SECRET: 'e2e-navigateur-secret-de-test-uniquement-0123456789',
  CORS_ORIGINS: frontUrl,
  SMS_PROVIDER: 'mock',
  PAYMENT_PROVIDER: 'mock',
  NOTIFICATION_PROVIDER: 'mock',
  EMAIL_PROVIDER: 'mock',
  SIRENE_PROVIDER: 'mock',
  STORAGE_PROVIDER: 'local',
  THROTTLE_DISABLED: 'true',
  SENTRY_DSN: '',
};
delete env.DATABASE_URL;
delete env.REDIS_URL;

const child = spawn(process.execPath, [path.join(root, 'dist', 'main.js')], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
