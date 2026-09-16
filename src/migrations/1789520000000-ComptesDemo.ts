import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Contenu de lancement (AUDIT §46) : indicateur interne « compte de démonstration » (admin seulement) et
 * préférence du vendeur « pas de paiement sécurisé sur mes annonces » (remise en main propre uniquement).
 */
export class ComptesDemo1789520000000 implements MigrationInterface {
  name = 'ComptesDemo1789520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "isDemoAccount" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD "securePaymentDisabled" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "securePaymentDisabled"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "isDemoAccount"`);
  }
}
