/**
 * Types de colonnes portables SQLite (dev) / PostgreSQL (prod).
 * TypeORM ne traduit pas "datetime" vers Postgres : on choisit ici.
 */
export const IS_POSTGRES = process.env.DB_TYPE === 'postgres';
export const DATE_TYPE = IS_POSTGRES ? 'timestamptz' : 'datetime';
export const JSON_TYPE = IS_POSTGRES ? 'jsonb' : 'simple-json';
