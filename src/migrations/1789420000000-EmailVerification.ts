import { MigrationInterface, QueryRunner } from 'typeorm';

/** Confirmation de l'adresse e-mail : statut sur l'utilisateur + jetons à usage unique (24 h). */
export class EmailVerification1789420000000 implements MigrationInterface {
  name = 'EmailVerification1789420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "emailVerified" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD "emailVerifiedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE TABLE "email_verification_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "userId" character varying NOT NULL, "tokenHash" character varying NOT NULL, "email" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_email_verification_tokens" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_email_verification_tokens_user" ON "email_verification_tokens" ("userId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_email_verification_tokens_hash" ON "email_verification_tokens" ("tokenHash")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_email_verification_tokens_hash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_email_verification_tokens_user"`);
    await queryRunner.query(`DROP TABLE "email_verification_tokens"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "emailVerifiedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "emailVerified"`);
  }
}
