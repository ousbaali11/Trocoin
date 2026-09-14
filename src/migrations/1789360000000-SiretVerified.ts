import { MigrationInterface, QueryRunner } from 'typeorm';

/** Statut de vérification du SIRET au registre public des entreprises. */
export class SiretVerified1789360000000 implements MigrationInterface {
  name = 'SiretVerified1789360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "siretVerified" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD "siretVerifiedAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "siretVerifiedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "siretVerified"`);
  }
}
