import { MigrationInterface, QueryRunner } from 'typeorm';

/** AUDIT §74 : table des évènements webhook traités (déduplication des livraisons « au moins une fois »). */
export class EvenementsWebhook1789650000000 implements MigrationInterface {
  name = 'EvenementsWebhook1789650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "webhook_events" ("id" character varying(120) NOT NULL, "type" character varying(80) NOT NULL, "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_webhook_events" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_webhook_events_receivedAt" ON "webhook_events" ("receivedAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhook_events_receivedAt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_events"`);
  }
}
