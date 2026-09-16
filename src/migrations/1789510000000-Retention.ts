import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suppression réelle (AUDIT §41) : une annonce supprimée disparaît de la base ; les ventes payées la
 * concernant gardent leur trace comptable avec le titre de l'annonce (pas une donnée personnelle).
 */
export class Retention1789510000000 implements MigrationInterface {
  name = 'Retention1789510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" ADD "listingTitle" character varying`);
    // Titre repris depuis l'annonce tant qu'elle existe encore
    await queryRunner.query(`UPDATE "transactions" t SET "listingTitle" = l."title" FROM "listings" l WHERE l."id"::text = t."listingId" AND t."listingTitle" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "listingTitle"`);
  }
}
