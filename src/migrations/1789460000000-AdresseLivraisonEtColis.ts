import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Étiquettes transporteur, phase 2 : adresse de livraison de l'acheteur sur la vente (saisie au
 * paiement, vue du vendeur seul) et colis déclaré au dépôt de l'annonce (poids, dimensions).
 * Colonnes toutes facultatives : les ventes et annonces existantes restent valides.
 */
export class AdresseLivraisonEtColis1789460000000 implements MigrationInterface {
  name = 'AdresseLivraisonEtColis1789460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" ADD "shippingAddress" jsonb`);
    await queryRunner.query(`ALTER TABLE "listings" ADD "weightGrams" integer`);
    await queryRunner.query(`ALTER TABLE "listings" ADD "lengthCm" integer`);
    await queryRunner.query(`ALTER TABLE "listings" ADD "widthCm" integer`);
    await queryRunner.query(`ALTER TABLE "listings" ADD "heightCm" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "listings" DROP COLUMN "heightCm"`);
    await queryRunner.query(`ALTER TABLE "listings" DROP COLUMN "widthCm"`);
    await queryRunner.query(`ALTER TABLE "listings" DROP COLUMN "lengthCm"`);
    await queryRunner.query(`ALTER TABLE "listings" DROP COLUMN "weightGrams"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "shippingAddress"`);
  }
}
