import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AUDIT §60 : une proposition de prix acceptée devient le prix payé. `messages.offerAnsweredAt` date la réponse du
 * vendeur (la proposition acceptée vaut un temps limité) ; `transactions.listPrice` garde le prix affiché de l'annonce
 * quand la vente s'est faite à un prix négocié.
 */
export class PrixNegocie1789580000000 implements MigrationInterface {
  name = 'PrixNegocie1789580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" ADD "offerAnsweredAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`UPDATE "messages" SET "offerAnsweredAt" = "createdAt" WHERE "type" = 'offer' AND "offerStatus" IN ('acceptee', 'refusee')`);
    await queryRunner.query(`ALTER TABLE "transactions" ADD "listPrice" double precision`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "listPrice"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "offerAnsweredAt"`);
  }
}
