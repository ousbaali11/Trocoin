import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Échéances du séquestre (AUDIT §37) : une autorisation de carte non capturée expire (7 jours en ligne).
 * Colonnes de suivi : date d'autorisation, date limite de capture donnée par le fournisseur, date de
 * réception présumée annoncée à l'acheteur, étape des rappels, action automatique appliquée, fenêtre de
 * litige après capture automatique. Les transactions existantes reçoivent une date limite estimée par la
 * tâche périodique (paidAt = createdAt).
 */
export class SequestreEcheances1789480000000 implements MigrationInterface {
  name = 'SequestreEcheances1789480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" ADD "paidAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "captureBefore" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "autoConfirmAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "escrowStage" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "autoResolution" character varying`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "disputeAllowedUntil" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "disputeAllowedUntil"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "autoResolution"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "escrowStage"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "autoConfirmAt"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "captureBefore"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "paidAt"`);
  }
}
