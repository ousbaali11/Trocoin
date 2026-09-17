import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AUDIT §54.
 *  - Plus de durée de vie des annonces : les dates d'expiration sont effacées et les annonces que la seule limite de
 *    temps avait fait passer « expiree » reviennent en ligne (aucune autre cause ne menait à ce statut).
 *  - Verrou anti-fraude : `listing_photos.lockedAt` ; les photos des annonces déjà publiées sont verrouillées.
 */
export class AnnoncesSansExpirationEtVerrous1789540000000 implements MigrationInterface {
  name = 'AnnoncesSansExpirationEtVerrous1789540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "listings" SET "status" = 'en_ligne' WHERE "status" = 'expiree'`);
    await queryRunner.query(`UPDATE "listings" SET "expiresAt" = NULL WHERE "expiresAt" IS NOT NULL`);
    await queryRunner.query(`ALTER TABLE "listing_photos" ADD "lockedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`UPDATE "listing_photos" SET "lockedAt" = now() WHERE "listingId" IN (SELECT CAST("id" AS varchar) FROM "listings" WHERE "publishedAt" IS NOT NULL OR "status" = 'en_attente')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "listing_photos" DROP COLUMN "lockedAt"`);
  }
}
