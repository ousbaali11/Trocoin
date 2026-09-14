import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index composite pour la requête de recherche par défaut : annonces en ligne triées par date
 * de publication (WHERE status = 'en_ligne' ORDER BY "publishedAt" DESC). Avant : parcours de
 * l'index "status" seul puis tri en mémoire. Idem par famille (rootCategoryId, status).
 */
export class ListingsSearchIndex1789410000000 implements MigrationInterface {
  name = 'ListingsSearchIndex1789410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_listings_status_published" ON "listings" ("status", "publishedAt" DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_listings_root_status_published" ON "listings" ("rootCategoryId", "status", "publishedAt" DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_listings_root_status_published"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_listings_status_published"`);
  }
}
