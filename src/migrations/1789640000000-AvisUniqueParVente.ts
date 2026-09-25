import { MigrationInterface, QueryRunner } from 'typeorm';

/** AUDIT §73 : un seul avis par membre et par vente, garanti par la base (deux envois simultanés en créaient deux). */
export class AvisUniqueParVente1789640000000 implements MigrationInterface {
  name = 'AvisUniqueParVente1789640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Doublons éventuels déjà présents : le plus ancien est conservé
    await queryRunner.query(`DELETE FROM "reviews" a USING "reviews" b WHERE a."transactionId" = b."transactionId" AND a."reviewerId" = b."reviewerId" AND a."createdAt" > b."createdAt"`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_reviews_transaction_reviewer" ON "reviews" ("transactionId", "reviewerId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_reviews_transaction_reviewer"`);
  }
}
