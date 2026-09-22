import { MigrationInterface, QueryRunner } from 'typeorm';

/** AUDIT §66 : `users.payoutWebhookAt` — date du dernier évènement account.updated reçu (preuve du webhook « comptes connectés »). */
export class WebhookComptesConnectes1789620000000 implements MigrationInterface {
  name = 'WebhookComptesConnectes1789620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "payoutWebhookAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "payoutWebhookAt"`);
  }
}
