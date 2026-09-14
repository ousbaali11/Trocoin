import { MigrationInterface, QueryRunner } from 'typeorm';

/** Préférences de notification granulaires (JSON par famille d'évènement et canal). */
export class NotificationPrefs1789390000000 implements MigrationInterface {
  name = 'NotificationPrefs1789390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "notificationPrefs" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "notificationPrefs"`);
  }
}
