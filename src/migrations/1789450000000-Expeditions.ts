import { MigrationInterface, QueryRunner } from 'typeorm';

/** Étiquettes transporteur, phase 1 : une expédition par transaction (docs/etiquettes-transporteur.md). */
export class Expeditions1789450000000 implements MigrationInterface {
  name = 'Expeditions1789450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "shipments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "transactionId" character varying NOT NULL, "listingId" character varying NOT NULL, "sellerId" character varying NOT NULL, "buyerId" character varying NOT NULL, "provider" character varying NOT NULL, "carrier" character varying NOT NULL, "mode" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'en_creation', "weightGrams" integer NOT NULL, "lengthCm" integer, "widthCm" integer, "heightCm" integer, "sender" jsonb NOT NULL, "recipient" jsonb NOT NULL, "relayPointId" character varying, "offerCode" character varying, "priceCents" integer, "trackingNumber" character varying, "trackingUrl" character varying, "labelUrl" character varying, "labelPdfBase64" text, "providerRef" character varying, "error" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_shipments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_shipments_transaction" ON "shipments" ("transactionId")`);
    await queryRunner.query(`CREATE INDEX "IDX_shipments_seller" ON "shipments" ("sellerId")`);
    await queryRunner.query(`CREATE INDEX "IDX_shipments_buyer" ON "shipments" ("buyerId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_shipments_buyer"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_shipments_seller"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_shipments_transaction"`);
    await queryRunner.query(`DROP TABLE "shipments"`);
  }
}
