// Environnement de test : base SQLite en mémoire, fournisseurs mock, rate limiting désactivé.
process.env.NODE_ENV = 'test';
if (process.env.E2E_DB !== 'postgres') {
  process.env.DB_TYPE = 'sqlite';
  process.env.DB_PATH = ':memory:';
}
// E2E_DB=postgres : utilise DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME (ou DATABASE_URL) de l'environnement
process.env.JWT_SECRET = 'secret-de-test-suffisamment-long-pour-les-tests-automatises';
process.env.SMS_PROVIDER = 'mock';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.NOTIFICATION_PROVIDER = 'mock';
process.env.THROTTLE_DISABLED = 'true';
process.env.CORS_ORIGINS = 'http://localhost:3001';
process.env.FREE_LISTINGS_PER_30_DAYS = '50';
