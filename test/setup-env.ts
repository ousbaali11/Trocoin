// Environnement de test : base SQLite en mémoire, fournisseurs mock, rate limiting désactivé.
process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'secret-de-test-suffisamment-long-pour-les-tests-automatises';
process.env.SMS_PROVIDER = 'mock';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.NOTIFICATION_PROVIDER = 'mock';
process.env.THROTTLE_DISABLED = 'true';
process.env.CORS_ORIGINS = 'http://localhost:3001';
process.env.FREE_LISTINGS_PER_30_DAYS = '50';
