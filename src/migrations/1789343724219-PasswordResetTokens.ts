import { MigrationInterface, QueryRunner } from "typeorm";

export class PasswordResetTokens1789343724219 implements MigrationInterface {
    name = 'PasswordResetTokens1789343724219'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "password_reset_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "userId" character varying NOT NULL, "tokenHash" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d16bebd73e844c48bca50ff8d3d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d6a19d4b4f6c62dcd29daa497e" ON "password_reset_tokens" ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1143abb8c3fad8b06dd857a8c9" ON "password_reset_tokens" ("tokenHash") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_1143abb8c3fad8b06dd857a8c9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d6a19d4b4f6c62dcd29daa497e"`);
        await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
    }

}
