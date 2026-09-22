import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AUDIT §63 : compte de versement en un formulaire (nom, date de naissance, adresse, IBAN). Trocoin ne garde de l'IBAN
 * que ses quatre derniers caractères (affichage), et la liste des pièces encore demandées par le prestataire.
 */
export class CompteDeVersementFormulaire1789600000000 implements MigrationInterface {
  name = 'CompteDeVersementFormulaire1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "payoutIbanLast4" character varying(4)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "payoutRequirements" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD "payoutAccountKind" character varying(16)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "payoutAccountKind"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "payoutRequirements"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "payoutIbanLast4"`);
  }
}
