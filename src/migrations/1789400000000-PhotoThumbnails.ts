import { MigrationInterface, QueryRunner } from 'typeorm';

/** Vignette 480 px par photo d'annonce (les listes ne chargent plus l'original de 1600 px). */
export class PhotoThumbnails1789400000000 implements MigrationInterface {
  name = 'PhotoThumbnails1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "listing_photos" ADD "thumbUrl" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "listing_photos" DROP COLUMN "thumbUrl"`);
  }
}
