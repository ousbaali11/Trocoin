import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Séquestre sur le solde de la plateforme (AUDIT §39) : capture rapide sur le compte Trocoin, virement
 * (Transfer) au vendeur à la confirmation. Les transactions existantes au moment de la migration gardent
 * l'ancien modèle « destination » (capture à la confirmation, fonds versés directement au vendeur) et se
 * terminent avec l'ancienne logique ; seules les ventes créées ensuite naissent en « platform ».
 */
export class SequestrePlateforme1789490000000 implements MigrationInterface {
  name = 'SequestrePlateforme1789490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" ADD "escrowModel" character varying NOT NULL DEFAULT 'platform'`);
    await queryRunner.query(`UPDATE "transactions" SET "escrowModel" = 'destination'`);
    await queryRunner.query(`CREATE INDEX "IDX_transactions_escrowModel" ON "transactions" ("escrowModel")`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "capturedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "shipBy" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "transferId" character varying`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "transferredAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "transferredAt"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "transferId"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "shipBy"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "capturedAt"`);
    await queryRunner.query(`DROP INDEX "IDX_transactions_escrowModel"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "escrowModel"`);
  }
}
