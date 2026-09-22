import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AUDIT §63 : à la fin d'une vente, l'annonce est archivée (statut « archivee », `archivedAt`) au lieu d'être effacée :
 * invisible pour les membres, consultable par l'administration tant qu'un litige est possible, effacée après 90 jours.
 */
export class AnnoncesArchivees1789590000000 implements MigrationInterface {
  name = 'AnnoncesArchivees1789590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "listings" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "listings" DROP COLUMN "archivedAt"`);
  }
}
