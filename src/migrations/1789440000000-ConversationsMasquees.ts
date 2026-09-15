import { MigrationInterface, QueryRunner } from 'typeorm';

/** Suppression de conversations côté utilisateur : masquage par participant (AUDIT.md §20). */
export class ConversationsMasquees1789440000000 implements MigrationInterface {
  name = 'ConversationsMasquees1789440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" ADD "hiddenForBuyerAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "conversations" ADD "hiddenForSellerAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "hiddenForSellerAt"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "hiddenForBuyerAt"`);
  }
}
