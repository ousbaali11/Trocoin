import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PayPal via Stripe (AUDIT §40) : le moyen de paiement réellement utilisé par l'acheteur (card, paypal, …)
 * est relu chez Stripe à l'autorisation et mémorisé ; rien dans le code ne suppose une carte.
 */
export class MoyenDePaiement1789500000000 implements MigrationInterface {
  name = 'MoyenDePaiement1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" ADD "paymentMethod" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "paymentMethod"`);
  }
}
