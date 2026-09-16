import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Téléphone sur les annonces et statistiques par annonce (brief du 16 septembre 2026) :
 * - users.phonePublic : le numéro du compte est proposé sur les annonces (« Voir le numéro »),
 *   réglable au dépôt et dans les paramètres ; vrai par défaut pour les comptes existants ;
 * - listings.phoneClicksCount : clics sur « Voir le numéro », visible du propriétaire seul.
 */
export class TelephoneEtStatistiques1789470000000 implements MigrationInterface {
  name = 'TelephoneEtStatistiques1789470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "phonePublic" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "listings" ADD "phoneClicksCount" integer NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "listings" DROP COLUMN "phoneClicksCount"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phonePublic"`);
  }
}
