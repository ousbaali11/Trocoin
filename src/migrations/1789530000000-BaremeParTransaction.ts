import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AUDIT §51 : barème (commission, frais de protection) figé sur chaque transaction à sa création, pour qu'un
 * changement de réglage par l'admin ne s'applique qu'aux nouvelles ventes. Les réglages eux-mêmes vivent dans
 * system_settings (clé/valeur) et sont créés au démarrage : aucune colonne à ajouter pour eux.
 */
export class BaremeParTransaction1789530000000 implements MigrationInterface {
  name = 'BaremeParTransaction1789530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" ADD "feeRates" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "feeRates"`);
  }
}
