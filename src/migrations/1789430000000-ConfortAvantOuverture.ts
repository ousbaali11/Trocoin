import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Items « confort » avant ouverture publique (AUDIT.md §19) :
 * historique des localisations par compte et double authentification (TOTP).
 */
export class ConfortAvantOuverture1789430000000 implements MigrationInterface {
  name = 'ConfortAvantOuverture1789430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "recentLocations" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD "twoFactorEnabled" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD "twoFactorEnabledAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "users" ADD "totpSecret" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD "totpRecoveryCodes" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD "totpLastStep" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "totpLastStep"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "totpRecoveryCodes"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "totpSecret"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "twoFactorEnabledAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "twoFactorEnabled"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "recentLocations"`);
  }
}
