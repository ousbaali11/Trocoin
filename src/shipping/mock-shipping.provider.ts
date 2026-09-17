import { Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import { buildLabelPdf } from './pdf-label';
import {
  CreateLabelInput,
  IShippingProvider,
  LabelResult,
  QuoteInput,
  RelayPoint,
  ShippingCarrier,
  ShippingMode,
  ShippingProviderError,
  ShippingRate,
  TrackingInfo,
} from './shipping-provider.interface';
import { INDICATIVE_GRID, TRANSIT_DAYS } from './indicative-rates';

/**
 * Fournisseur simulé : tarifs indicatifs par tranche de poids (ordre de grandeur des grilles
 * publiques 2026 pour un particulier, à remplacer par la cotation réelle en phase 2), points relais
 * fictifs, étiquette PDF marquée « SIMULATION », numéro de suivi préfixé SIM.
 *
 * Pannes simulées (tests, démonstration des cas d'erreur) :
 *   SHIPPING_MOCK_FAIL=etiquette   → toute création d'étiquette échoue (prestataire indisponible)
 *   SHIPPING_MOCK_FAIL=adresse     → l'adresse du destinataire est refusée
 *   code postal destinataire 99999 → adresse invalide, quelle que soit la variable
 */
const GRID = INDICATIVE_GRID;

const CARRIER_LABEL: Record<ShippingCarrier, string> = { colissimo: 'Colissimo', mondial_relay: 'Mondial Relay' };

export class MockShippingProvider implements IShippingProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('Shipping(mock)');
  /** Étiquettes créées, pour le suivi simulé (numéro → date de création). */
  private readonly created = new Map<string, { at: number; carrier: ShippingCarrier; mode: ShippingMode }>();

  async quote(input: QuoteInput): Promise<ShippingRate[]> {
    if (input.parcel.weightGrams > 30000) return [];
    const rates: ShippingRate[] = [];
    for (const mode of ['point_relais', 'domicile'] as ShippingMode[]) {
      const row = GRID[`${input.carrier}:${mode}`].find(([max]) => input.parcel.weightGrams <= max);
      if (!row) continue;
      rates.push({
        carrier: input.carrier,
        mode,
        priceCents: row[1],
        deliveryDays: TRANSIT_DAYS[input.carrier],
        offerCode: `SIM-${input.carrier.toUpperCase()}-${mode.toUpperCase()}`,
        label: `${CARRIER_LABEL[input.carrier]} ${mode === 'domicile' ? 'à domicile' : 'en point relais'}`,
      });
    }
    return rates;
  }

  async searchRelayPoints(carrier: ShippingCarrier, postalCode: string): Promise<RelayPoint[]> {
    const names = carrier === 'colissimo' ? ['Bureau de poste', 'Tabac-presse du centre', 'Pickup Épicerie des Halles'] : ['Point Relais Boulangerie Martin', 'Locker Mondial Relay Gare', 'Pressing des Lices'];
    return names.map((name, i) => ({
      id: `${carrier === 'colissimo' ? 'CP' : 'MR'}${postalCode}${i + 1}`,
      name,
      line1: `${(i + 1) * 7} rue de la République`,
      postalCode,
      city: 'Commune simulée',
      hours: 'Lun–Sam 9h–19h',
      distanceMeters: 300 * (i + 1),
    }));
  }

  async createLabel(input: CreateLabelInput): Promise<LabelResult> {
    const fail = process.env.SHIPPING_MOCK_FAIL;
    if (fail === 'etiquette') throw new ShippingProviderError('mock', 'transporteur_indisponible', 'panne simulée du prestataire');
    if (fail === 'adresse' || input.recipient.postalCode === '99999') throw new ShippingProviderError('mock', 'adresse_invalide', 'adresse du destinataire refusée par le transporteur (simulation)');
    if (input.mode === 'point_relais' && !input.relayPointId) throw new ShippingProviderError('mock', 'etiquette_impossible', 'point relais manquant');
    const rates = await this.quote({ carrier: input.carrier, parcel: input.parcel, fromPostalCode: input.sender.postalCode, toPostalCode: input.recipient.postalCode });
    const rate = rates.find((r) => r.mode === input.mode);
    if (!rate) throw new ShippingProviderError('mock', 'transporteur_indisponible', `${CARRIER_LABEL[input.carrier]} ne propose pas ce mode pour ce colis`);

    const trackingNumber = `SIM${String(randomInt(0, 1e10)).padStart(10, '0')}`;
    const trackingUrl = input.carrier === 'colissimo' ? `https://www.laposte.fr/outils/suivre-vos-envois?code=${trackingNumber}` : `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${trackingNumber}`;
    this.created.set(trackingNumber, { at: Date.now(), carrier: input.carrier, mode: input.mode });
    const fmt = (a: CreateLabelInput['sender']) => [a.name, a.line1, a.line2, `${a.postalCode} ${a.city}`].filter(Boolean) as string[];
    const price = (rate.priceCents / 100).toFixed(2).replace('.', ',');
    const labelPdf = buildLabelPdf({
      rects: [
        { x: 3, y: 3, w: 94, h: 144 },
        { x: 3, y: 127, w: 94, h: 0.6, fill: true },
        { x: 6, y: 56, w: 88, h: 0.2, fill: true },
      ],
      barcode: { x: 12, y: 16, w: 76, h: 22, value: trackingNumber },
      lines: [
        { x: 6, y: 139, text: 'SIMULATION', size: 18, bold: true },
        { x: 6, y: 131, text: 'Étiquette non valable pour un envoi réel (SHIPPING_PROVIDER=mock)', size: 6.5 },
        { x: 6, y: 120, text: `${CARRIER_LABEL[input.carrier]} · ${input.mode === 'domicile' ? 'Domicile' : 'Point relais'} · ${input.parcel.weightGrams} g · ${price} EUR`, size: 9, bold: true },
        { x: 6, y: 112, text: 'EXPÉDITEUR', size: 6.5, bold: true },
        ...fmt(input.sender).map((t, i) => ({ x: 6, y: 107 - i * 4.2, text: t, size: 7.5 })),
        { x: 6, y: 86, text: 'DESTINATAIRE', size: 6.5, bold: true },
        ...fmt(input.recipient).map((t, i) => ({ x: 6, y: 80 - i * 5, text: t, size: 10, bold: i === 0 })),
        ...(input.relayPointId ? [{ x: 6, y: 58.5, text: `Point relais : ${input.relayPointId}`, size: 7.5 }] : []),
        { x: 6, y: 51, text: `Réf. Trocoin ${input.reference.slice(0, 8)} · ${input.contentDescription.slice(0, 40)}`, size: 7 },
        { x: 6, y: 46.5, text: `Valeur déclarée ${(input.declaredValueCents / 100).toFixed(2).replace('.', ',')} EUR`, size: 7 },
        { x: 6, y: 40.5, text: 'N° DE SUIVI', size: 6.5, bold: true },
        { x: 30, y: 9, text: trackingNumber, size: 12, bold: true },
      ],
    });
    this.logger.log(`Étiquette simulée ${trackingNumber} (${input.carrier}, ${input.mode}, ${input.parcel.weightGrams} g)`);
    return { trackingNumber, trackingUrl, labelPdf, providerRef: `sim_${trackingNumber.toLowerCase()}`, priceCents: rate.priceCents };
  }

  /** Suivi simulé : l'envoi progresse avec le temps écoulé depuis la création (utile en démonstration). */
  async track(carrier: ShippingCarrier, trackingNumber: string): Promise<TrackingInfo> {
    const c = this.created.get(trackingNumber);
    const at = c?.at ?? Date.now();
    const elapsedH = (Date.now() - at) / 3_600_000;
    const events: TrackingInfo['events'] = [{ at: new Date(at).toISOString(), label: 'Étiquette créée', location: 'Trocoin (simulation)' }];
    let state: TrackingInfo['state'] = 'etiquette_creee';
    if (elapsedH >= 12) {
      state = 'pris_en_charge';
      events.push({ at: new Date(at + 12 * 3_600_000).toISOString(), label: 'Colis pris en charge', location: CARRIER_LABEL[carrier] });
    }
    if (elapsedH >= 36) {
      state = 'en_transit';
      events.push({ at: new Date(at + 36 * 3_600_000).toISOString(), label: 'En cours d\'acheminement' });
    }
    if (elapsedH >= 60) {
      state = c?.mode === 'point_relais' ? 'disponible_en_relais' : 'livre';
      events.push({ at: new Date(at + 60 * 3_600_000).toISOString(), label: state === 'livre' ? 'Livré' : 'Disponible en point relais' });
    }
    return { state, events };
  }
}
