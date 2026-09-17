import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AUDIT §58 : une annonce payée passe « vendue » dès le paiement (elle restait « en ligne » jusqu'à la réception).
 * Rattrapage des ventes en cours au moment du déploiement ; rien d'autre n'est touché.
 */
export class AnnoncesVenduesPendantLaVente1789560000000 implements MigrationInterface {
  name = 'AnnoncesVenduesPendantLaVente1789560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "listings" SET "status" = 'vendue' WHERE "status" = 'en_ligne' AND CAST("id" AS varchar) IN (SELECT "listingId" FROM "transactions" WHERE "status" IN ('sequestre', 'livree', 'litige'))`);
  }

  public async down(): Promise<void> {
    // Rien à défaire : le statut d'origine des annonces concernées n'est pas conservé
  }
}
