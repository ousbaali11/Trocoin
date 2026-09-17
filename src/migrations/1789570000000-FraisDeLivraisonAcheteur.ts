import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AUDIT §59 : les frais de livraison sont payés par l'acheteur avec son achat. `shippingFee` (euros, figé à la
 * création de la vente, 0 pour une remise en main propre et pour les ventes antérieures) et `shippingQuote`
 * (offre, mode et colis cotés : le bon d'envoi est généré avec exactement ces données).
 */
export class FraisDeLivraisonAcheteur1789570000000 implements MigrationInterface {
  name = 'FraisDeLivraisonAcheteur1789570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" ADD "shippingFee" double precision NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "shippingQuote" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "shippingQuote"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "shippingFee"`);
  }
}
