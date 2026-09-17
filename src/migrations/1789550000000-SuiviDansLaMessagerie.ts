import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AUDIT §57.
 *  - Messages automatiques de suivi de vente dans la conversation : `messages.systemEvent`, `transactionId`, `meta`.
 *  - Vente : mode d'envoi et point de retrait choisis par l'acheteur (`deliveryMode`, `pickupPoint`), confirmation
 *    de disponibilité par le vendeur (`sellerConfirmedAt`).
 */
export class SuiviDansLaMessagerie1789550000000 implements MigrationInterface {
  name = 'SuiviDansLaMessagerie1789550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" ADD "systemEvent" character varying`);
    await queryRunner.query(`ALTER TABLE "messages" ADD "transactionId" character varying`);
    await queryRunner.query(`ALTER TABLE "messages" ADD "meta" jsonb`);
    await queryRunner.query(`CREATE INDEX "IDX_messages_transactionId" ON "messages" ("transactionId")`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "deliveryMode" character varying`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "pickupPoint" jsonb`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "sellerConfirmedAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "sellerConfirmedAt"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "pickupPoint"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "deliveryMode"`);
    await queryRunner.query(`DROP INDEX "IDX_messages_transactionId"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "meta"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "transactionId"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "systemEvent"`);
  }
}
