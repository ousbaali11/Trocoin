import { MigrationInterface, QueryRunner } from "typeorm";

export class UserCredentials1789341100225 implements MigrationInterface {
    name = 'UserCredentials1789341100225'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "firstName" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "lastName" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "username" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username")`);
        await queryRunner.query(`ALTER TABLE "users" ADD "passwordHash" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "companyName" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "companyName"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "passwordHash"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "username"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastName"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "firstName"`);
    }

}
