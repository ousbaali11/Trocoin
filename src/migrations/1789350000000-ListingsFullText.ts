import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index GIN plein texte français sur titre + description, accents retirés par
 * translate (même expression que FTS_VECTOR_SQL dans listings.service.ts). Écrit à la main : un index
 * sur expression n'est pas décrit par les entités TypeORM.
 */
export class ListingsFullText1789350000000 implements MigrationInterface {
  name = 'ListingsFullText1789350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_listings_fts_french" ON "listings" USING GIN (to_tsvector('french', translate(lower(coalesce("title", '') || ' ' || coalesce("description", '')), 'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucAAAEEEEIIOOUUUC')))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_listings_fts_french"`);
  }
}
