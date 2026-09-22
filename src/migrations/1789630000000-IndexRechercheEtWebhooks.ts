import { MigrationInterface, QueryRunner } from 'typeorm';

/** AUDIT §69 : index sur les colonnes filtrées à chaque webhook (providerPaymentId), à chaque recherche (publishedAt) et à chaque sonde /health (paymentIssue, index partiel). */
export class IndexRechercheEtWebhooks1789630000000 implements MigrationInterface {
  name = 'IndexRechercheEtWebhooks1789630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_transactions_providerPaymentId" ON "transactions" ("providerPaymentId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_listings_publishedAt" ON "listings" ("publishedAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_transactions_paymentIssue" ON "transactions" ("paymentIssue") WHERE "paymentIssue" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transactions_paymentIssue"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_listings_publishedAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transactions_providerPaymentId"`);
  }
}
