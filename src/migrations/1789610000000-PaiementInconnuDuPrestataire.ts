import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AUDIT §65 : `transactions.paymentIssue` / `paymentIssueAt` — paiement que le prestataire ne reconnaît plus (ou autorisation
 * expirée) : la tâche périodique ne retente plus, l'administration est prévenue et tranche.
 */
export class PaiementInconnuDuPrestataire1789610000000 implements MigrationInterface {
  name = 'PaiementInconnuDuPrestataire1789610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" ADD "paymentIssue" text`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "paymentIssueAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "paymentIssueAt"`);
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "paymentIssue"`);
  }
}
