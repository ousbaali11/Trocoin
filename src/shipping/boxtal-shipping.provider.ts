import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  TrackingState,
} from './shipping-provider.interface';

/**
 * Boxtal (docs/etiquettes-transporteur.md §7) — deux API :
 *   v1 « cotation » (test.envoimoinscher.com / www.envoimoinscher.com) : HTTP Basic identifiant + mot de passe
 *       de l'application, en-tête Api-Version, réponse XML ;
 *   v3 (api.boxtal.build / api.boxtal.com) : clé d'accès + clé secrète échangées contre un jeton porteur
 *       (POST /iam/account-app/token), puis commandes d'expédition, documents (étiquette PDF), suivi, points relais.
 * Les codes d'offre v3 (SHIPPING_OFFER_CODE) viennent du portail : BOXTAL_OFFER_COLISSIMO_DOMICILE,
 * BOXTAL_OFFER_COLISSIMO_RELAIS, BOXTAL_OFFER_MONDIAL_RELAY_RELAIS ; à défaut, le code renvoyé par la cotation
 * (opérateur_service) est tenté tel quel et le refus éventuel de Boxtal est rendu tel quel au vendeur.
 */
const V3 = { sandbox: 'https://api.boxtal.build', production: 'https://api.boxtal.com' };
const V1 = { sandbox: 'https://test.envoimoinscher.com', production: 'https://www.envoimoinscher.com' };
const CARRIER_LABEL: Record<ShippingCarrier, string> = { colissimo: 'Colissimo', mondial_relay: 'Mondial Relay' };
const TRACKING_URL: Record<ShippingCarrier, (n: string) => string> = {
  colissimo: (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(n)}`,
  mondial_relay: (n) => `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${encodeURIComponent(n)}`,
};

/** Lecture minimale d'un XML plat (la cotation v1) : texte d'un élément, liste de blocs. */
function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function xmlText(xml: string, path: string): string {
  let cur = xml;
  for (const tag of path.split('/')) {
    const b = xmlBlocks(cur, tag);
    if (!b.length) return '';
    cur = b[0];
  }
  return cur
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}
function splitStreet(line1: string): { number?: string; street: string } {
  const m = line1.trim().match(/^(\d+[a-zA-Z]?(?:\s?(?:bis|ter))?)\s+(.+)$/i);
  return m ? { number: m[1], street: m[2] } : { street: line1.trim() };
}
function carrierOf(operatorCode: string, operatorLabel: string): ShippingCarrier | null {
  const s = `${operatorCode} ${operatorLabel}`.toLowerCase();
  if (/monr|mondial/.test(s)) return 'mondial_relay';
  if (/pofr|colissimo|la poste|laposte/.test(s)) return 'colissimo';
  return null;
}
function modeOf(deliveryTypeCode: string, deliveryTypeLabel: string): ShippingMode {
  return /pickup|point|relais|relay/i.test(`${deliveryTypeCode} ${deliveryTypeLabel}`) ? 'point_relais' : 'domicile';
}

export class BoxtalShippingProvider implements IShippingProvider {
  readonly name = 'boxtal';
  private readonly logger = new Logger('Shipping(boxtal)');
  private readonly env: 'sandbox' | 'production';
  private readonly v3Base: string;
  private readonly v1Base: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly v1Login: string;
  private readonly v1Password: string;
  private readonly offerCodes: Partial<Record<`${ShippingCarrier}:${ShippingMode}`, string>>;
  private readonly contentCode: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(config: ConfigService) {
    this.env = config.get<string>('BOXTAL_ENV') === 'production' ? 'production' : 'sandbox';
    this.v3Base = (config.get<string>('BOXTAL_V3_API_URL') || V3[this.env]).replace(/\/$/, '');
    this.v1Base = (config.get<string>('BOXTAL_V1_API_URL') || V1[this.env]).replace(/\/$/, '');
    this.accessKey = config.get<string>('BOXTAL_V3_ACCESS_KEY') || '';
    this.secretKey = config.get<string>('BOXTAL_V3_SECRET_KEY') || '';
    this.v1Login = config.get<string>('BOXTAL_V1_LOGIN') || '';
    this.v1Password = config.get<string>('BOXTAL_V1_PASSWORD') || '';
    this.offerCodes = {
      'colissimo:domicile': config.get<string>('BOXTAL_OFFER_COLISSIMO_DOMICILE') || undefined,
      'colissimo:point_relais': config.get<string>('BOXTAL_OFFER_COLISSIMO_RELAIS') || undefined,
      'mondial_relay:point_relais': config.get<string>('BOXTAL_OFFER_MONDIAL_RELAY_RELAIS') || undefined,
    };
    this.contentCode = config.get<string>('BOXTAL_CONTENT_CODE') || '10120';
    this.logger.log(`Boxtal ${this.env} (v3 ${this.v3Base}, v1 ${this.v1Base})`);
  }

  get environment(): 'sandbox' | 'production' {
    return this.env;
  }

  // ------------------------------------------------------------------ v3 : jeton et appels

  private async bearer(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    let res: Response;
    try {
      res = await fetch(`${this.v3Base}/iam/account-app/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${this.accessKey}:${this.secretKey}`).toString('base64')}`, Accept: 'application/json' },
      });
    } catch (err) {
      throw new ShippingProviderError('boxtal', 'reseau', `jeton v3 : ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { accessToken?: string; expiresIn?: number; message?: string };
    if (!res.ok || !body.accessToken) {
      const code = res.status === 401 || res.status === 403 ? 'non_configure' : 'transporteur_indisponible';
      throw new ShippingProviderError('boxtal', code, `jeton v3 refusé (HTTP ${res.status}${body.message ? ' ' + body.message : ''}) — vérifier BOXTAL_V3_ACCESS_KEY / BOXTAL_V3_SECRET_KEY et BOXTAL_ENV`);
    }
    this.token = { value: body.accessToken, expiresAt: Date.now() + (body.expiresIn ?? 300) * 1000 };
    return body.accessToken;
  }

  private async v3<T>(method: string, path: string, body?: unknown, raw = false): Promise<{ status: number; data: T; text: string }> {
    const token = await this.bearer();
    let res: Response;
    try {
      res = await fetch(`${this.v3Base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: raw ? '*/*' : 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ShippingProviderError('boxtal', 'reseau', `${method} ${path} : ${(err as Error).message}`);
    }
    if (raw) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, data: buf as unknown as T, text: '' };
    }
    const text = await res.text();
    let data: T = null as unknown as T;
    try {
      data = text ? (JSON.parse(text) as T) : (null as unknown as T);
    } catch {
      /* corps non JSON */
    }
    return { status: res.status, data, text };
  }

  private v3Error(status: number, text: string, fallback: ShippingProviderError['code']): ShippingProviderError {
    const short = text.replace(/\s+/g, ' ').slice(0, 300);
    if (status === 401 || status === 403) return new ShippingProviderError('boxtal', 'non_configure', `accès v3 refusé (HTTP ${status}) ${short}`);
    if (status === 400 || status === 422) {
      const code = /address|postal|city|street|adresse|zip/i.test(short) ? 'adresse_invalide' : 'etiquette_impossible';
      return new ShippingProviderError('boxtal', code, `demande refusée (HTTP ${status}) ${short}`);
    }
    if (status >= 500) return new ShippingProviderError('boxtal', 'transporteur_indisponible', `Boxtal indisponible (HTTP ${status})`);
    return new ShippingProviderError('boxtal', fallback, `HTTP ${status} ${short}`);
  }

  // ------------------------------------------------------------------ v1 : cotation

  private async v1Cotation(params: Record<string, string>): Promise<string> {
    // La cotation se lit en GET (la bibliothèque officielle construit server + action + '?' + query ; POST répond 405)
    const query = new URLSearchParams({ ...params, platform: 'trocoin', platform_version: '1', module_version: '1' });
    const attempt = async (authHeader: string) => {
      try {
        return await fetch(`${this.v1Base}/api/v1/cotation?${query.toString()}`, {
          method: 'GET',
          headers: { Authorization: authHeader, 'Api-Version': '1.3.7', 'Accept-Language': 'fr-FR', Accept: 'application/xml' },
        });
      } catch (err) {
        throw new ShippingProviderError('boxtal', 'reseau', `cotation v1 : ${(err as Error).message}`);
      }
    };
    const credentials = Buffer.from(`${this.v1Login}:${this.v1Password}`).toString('base64');
    // La bibliothèque officielle envoie l'encodage nu ; certains serveurs attendent le mot « Basic » : on tente les deux
    let res = await attempt(`Basic ${credentials}`);
    if (res.status === 401 || res.status === 403) res = await attempt(credentials);
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new ShippingProviderError('boxtal', 'non_configure', `identifiants v1 refusés (HTTP ${res.status})`);
    const errMsg = xmlText(text, 'error/message') || xmlText(text, 'error/code');
    if (!res.ok || errMsg) {
      const code = /postal|adresse|address|ville|city/i.test(errMsg) ? 'adresse_invalide' : res.status >= 500 ? 'transporteur_indisponible' : 'etiquette_impossible';
      throw new ShippingProviderError('boxtal', code, `cotation v1 refusée (HTTP ${res.status}) ${errMsg || text.slice(0, 200)}`);
    }
    return text;
  }

  /** Offres brutes de la cotation v1 (toutes), utilisées par quote() et par le diagnostic. */
  async rawQuote(input: QuoteInput & { fromCity?: string; toCity?: string }): Promise<Array<ShippingRate & { operatorCode: string; operatorLabel: string; serviceCode: string; serviceLabel: string; deliveryType: string; carrier: ShippingCarrier | null }>> {
    const today = new Date().toISOString().slice(0, 10);
    const xml = await this.v1Cotation({
      'shipper.pays': 'FR',
      'shipper.code_postal': input.fromPostalCode,
      'shipper.ville': input.fromCity || '',
      'shipper.type': 'individual',
      'recipient.pays': 'FR',
      'recipient.code_postal': input.toPostalCode,
      'recipient.ville': input.toCity || '',
      'recipient.type': 'individual',
      'colis_1.poids': String(Math.max(0.01, input.parcel.weightGrams / 1000)),
      'colis_1.longueur': String(input.parcel.lengthCm ?? 30),
      'colis_1.largeur': String(input.parcel.widthCm ?? 20),
      'colis_1.hauteur': String(input.parcel.heightCm ?? 10),
      code_contenu: this.contentCode,
      collecte: today,
      delai: 'aucun',
    });
    return xmlBlocks(xml, 'offer').map((offer) => {
      const operatorCode = xmlText(offer, 'operator/code');
      const operatorLabel = xmlText(offer, 'operator/label');
      const serviceCode = xmlText(offer, 'service/code');
      const serviceLabel = xmlText(offer, 'service/label');
      const deliveryType = xmlText(offer, 'delivery/type/code') || xmlText(offer, 'delivery/type/label');
      const priceTtc = parseFloat(xmlText(offer, 'price/tax-inclusive').replace(',', '.'));
      const priceHt = parseFloat(xmlText(offer, 'price/tax-exclusive').replace(',', '.'));
      const price = Number.isFinite(priceTtc) ? priceTtc : priceHt;
      const carrier = carrierOf(operatorCode, operatorLabel);
      const mode = modeOf(deliveryType, xmlText(offer, 'delivery/type/label'));
      const deliveryDate = xmlText(offer, 'delivery/date');
      const days = deliveryDate ? Math.max(1, Math.round((new Date(deliveryDate).getTime() - Date.now()) / 86_400_000)) : 3;
      const configured = carrier ? this.offerCodes[`${carrier}:${mode}`] : undefined;
      return {
        carrier: carrier as ShippingCarrier,
        mode,
        priceCents: Math.round((Number.isFinite(price) ? price : 0) * 100),
        deliveryDays: days,
        offerCode: configured || `${operatorCode}_${serviceCode}`,
        label: `${operatorLabel || CARRIER_LABEL[carrier || 'colissimo']} ${serviceLabel || ''}`.trim(),
        operatorCode,
        operatorLabel,
        serviceCode,
        serviceLabel,
        deliveryType,
      };
    });
  }

  async quote(input: QuoteInput & { fromCity?: string; toCity?: string }): Promise<ShippingRate[]> {
    const offers = await this.rawQuote(input);
    const seen = new Set<string>();
    const rates: ShippingRate[] = [];
    for (const o of offers) {
      if (o.carrier !== input.carrier || !o.priceCents) continue;
      if (seen.has(o.mode)) continue; // une offre par mode : la première (la moins chère selon Boxtal)
      seen.add(o.mode);
      const { operatorCode, operatorLabel, serviceCode, serviceLabel, deliveryType, ...rate } = o;
      void operatorCode;
      void operatorLabel;
      void serviceCode;
      void serviceLabel;
      void deliveryType;
      rates.push(rate);
    }
    return rates.sort((a, b) => a.priceCents - b.priceCents);
  }

  // ------------------------------------------------------------------ v3 : points relais, étiquette, suivi

  async searchRelayPoints(carrier: ShippingCarrier, postalCode: string, city?: string): Promise<RelayPoint[]> {
    const qs = new URLSearchParams({ countryIsoCode: 'FR', postalCode, ...(city ? { city } : {}) });
    const r = await this.v3<{ content?: Array<{ parcelPoint?: { code?: string; name?: string; network?: unknown; location?: { number?: string; street?: string; postalCode?: string; city?: string }; openingDays?: unknown }; distanceFromSearchLocation?: number }> }>('GET', `/shipping/v3.1/parcel-point?${qs}`);
    if (r.status >= 400) throw this.v3Error(r.status, r.text, 'transporteur_indisponible');
    const all = (r.data?.content || []).map((p) => {
      const pp = p.parcelPoint || {};
      const net = JSON.stringify(pp.network || '').toLowerCase();
      return {
        id: pp.code || '',
        name: pp.name || 'Point relais',
        line1: [pp.location?.number, pp.location?.street].filter(Boolean).join(' '),
        postalCode: pp.location?.postalCode || postalCode,
        city: pp.location?.city || city || '',
        hours: pp.openingDays ? summarizeHours(pp.openingDays) : undefined,
        distanceMeters: p.distanceFromSearchLocation,
        network: net,
      };
    });
    const wanted = carrier === 'mondial_relay' ? /monr|mondial|inpost/ : /pofr|colissimo|poste|pickup/;
    const filtered = all.filter((p) => wanted.test(p.network));
    return (filtered.length ? filtered : all).slice(0, 12).map(({ network, ...p }) => {
      void network;
      return p;
    });
  }

  async createLabel(input: CreateLabelInput): Promise<LabelResult> {
    const from = splitName(input.sender.name);
    const to = splitName(input.recipient.name);
    const fromStreet = splitStreet(input.sender.line1);
    const toStreet = splitStreet(input.recipient.line1);
    const body = {
      labelType: 'PDF_10x15',
      shippingOfferCode: input.offerCode,
      shipment: {
        externalId: `trocoin-${input.reference}`,
        packages: [
          {
            type: 'PARCEL',
            weight: Math.max(0.01, input.parcel.weightGrams / 1000),
            length: input.parcel.lengthCm ?? 30,
            width: input.parcel.widthCm ?? 20,
            height: input.parcel.heightCm ?? 10,
            value: { value: Math.max(1, Math.round(input.declaredValueCents / 100)), currency: 'EUR' },
          },
        ],
        fromAddress: {
          type: 'RESIDENTIAL',
          contact: { firstName: from.firstName, lastName: from.lastName, email: input.sender.email || 'no-reply@trocoin.fr', phone: input.sender.phone || '' },
          location: { ...fromStreet, city: input.sender.city, postalCode: input.sender.postalCode, countryIsoCode: input.sender.country || 'FR' },
          ...(input.sender.line2 ? { additionalInformation: input.sender.line2 } : {}),
        },
        toAddress: {
          type: 'RESIDENTIAL',
          contact: { firstName: to.firstName, lastName: to.lastName, email: input.recipient.email || 'no-reply@trocoin.fr', phone: input.recipient.phone || '' },
          location: { ...toStreet, city: input.recipient.city, postalCode: input.recipient.postalCode, countryIsoCode: input.recipient.country || 'FR' },
          ...(input.recipient.line2 ? { additionalInformation: input.recipient.line2 } : {}),
        },
        ...(input.mode === 'point_relais' && input.relayPointId ? { pickupPointCode: input.relayPointId } : {}),
      },
    };
    const created = await this.v3<{ id?: string; status?: string; deliveryPriceExclTax?: { value?: number }; content?: { id?: string; status?: string; deliveryPriceExclTax?: { value?: number } } }>('POST', '/shipping/v3.1/shipping-order', body);
    if (created.status >= 400) throw this.v3Error(created.status, created.text, 'etiquette_impossible');
    const order = created.data?.content ?? created.data;
    const orderId = order?.id;
    if (!orderId) throw new ShippingProviderError('boxtal', 'etiquette_impossible', `réponse sans identifiant : ${created.text.slice(0, 200)}`);

    // Étiquette : liste des documents puis téléchargement du PDF (quelques secondes peuvent être nécessaires)
    let labelPdf: Buffer | null = null;
    let lastText = '';
    for (let attempt = 0; attempt < 6 && !labelPdf; attempt++) {
      const docs = await this.v3<{ content?: Array<{ url?: string; type?: string; format?: string }> }>('GET', `/shipping/v3.1/shipping-order/${encodeURIComponent(orderId)}/shipping-document`);
      lastText = docs.text;
      const label = (docs.data?.content || []).find((d) => d.type === 'LABEL' && d.url) || (docs.data?.content || []).find((d) => d.url);
      if (label?.url) {
        const file = await this.download(label.url);
        if (file) labelPdf = file;
      }
      if (!labelPdf) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!labelPdf) throw new ShippingProviderError('boxtal', 'etiquette_impossible', `étiquette non disponible pour la commande ${orderId} : ${lastText.slice(0, 200)}`);

    const tracking = await this.trackOrder(orderId).catch(() => null);
    const trackingNumber = tracking?.trackingNumber || orderId;
    const priceCents = Math.round(((order?.deliveryPriceExclTax?.value ?? 0) * 1.2) * 100);
    this.logger.log(`Commande Boxtal ${orderId} (${input.carrier}, ${input.mode}) créée, suivi ${trackingNumber}`);
    return { trackingNumber, trackingUrl: tracking?.url || TRACKING_URL[input.carrier](trackingNumber), labelPdf, providerRef: orderId, priceCents };
  }

  private async download(url: string): Promise<Buffer | null> {
    const token = await this.bearer();
    const attempts: Record<string, string>[] = [{ Authorization: `Bearer ${token}` }, {}];
    for (const headers of attempts) {
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.subarray(0, 5).toString() === '%PDF-') return buf;
      } catch {
        /* essai suivant */
      }
    }
    return null;
  }

  private async trackOrder(orderId: string): Promise<{ state: TrackingState; trackingNumber?: string; url?: string; events: TrackingInfo['events'] } | null> {
    const r = await this.v3<{ content?: Array<{ status?: string; trackingNumber?: string; packageTrackingUrl?: string; history?: Array<{ status?: string; message?: string; trackingDateTime?: string; location?: string }> }> }>('GET', `/shipping/v3.1/shipping-order/${encodeURIComponent(orderId)}/tracking`);
    if (r.status >= 400) throw this.v3Error(r.status, r.text, 'transporteur_indisponible');
    const pkg = r.data?.content?.[0];
    if (!pkg) return null;
    const map: Record<string, TrackingState> = {
      ANNOUNCED: 'etiquette_creee',
      SHIPPED: 'pris_en_charge',
      IN_TRANSIT: 'en_transit',
      OUT_FOR_DELIVERY: 'en_transit',
      FAILED_ATTEMPT: 'incident',
      REACHED_DELIVERY_PICKUP_POINT: 'disponible_en_relais',
      DELIVERED: 'livre',
      RETURNED: 'incident',
      EXCEPTION: 'incident',
    };
    return {
      state: map[pkg.status || ''] || 'etiquette_creee',
      trackingNumber: pkg.trackingNumber,
      url: pkg.packageTrackingUrl,
      events: (pkg.history || []).map((h) => ({ at: h.trackingDateTime || '', label: h.message || h.status || '', location: h.location })),
    };
  }

  async track(carrier: ShippingCarrier, trackingNumber: string, providerRef?: string): Promise<TrackingInfo> {
    void carrier;
    if (!providerRef) return { state: 'pris_en_charge', events: [] };
    const t = await this.trackOrder(providerRef);
    if (!t) return { state: 'etiquette_creee', events: [] };
    void trackingNumber;
    return { state: t.state, events: t.events };
  }

  /** Annulation d'une commande (nettoyage des tests en sandbox ; usage futur : annulation par le vendeur). */
  async cancel(providerRef: string): Promise<boolean> {
    const r = await this.v3('DELETE', `/shipping/v3.1/shipping-order/${encodeURIComponent(providerRef)}`);
    return r.status < 400;
  }

  /**
   * Diagnostic (sandbox uniquement, voir ShippingController) : jeton v3, cotation v1 pour un colis type,
   * points relais, et — sur demande — création d'une commande d'expédition, étiquette, suivi, annulation.
   * Ne renvoie jamais d'identifiant ni de jeton.
   */
  async diagnostic(withLabel: boolean): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { provider: 'boxtal', environment: this.env, v3: this.v3Base, v1: this.v1Base };
    const step = async (name: string, fn: () => Promise<unknown>) => {
      try {
        out[name] = { ok: true, result: await fn() };
      } catch (err) {
        out[name] = { ok: false, error: err instanceof ShippingProviderError ? { code: err.code, reason: err.reason } : String((err as Error).message) };
      }
    };
    await step('jeton_v3', async () => {
      await this.bearer();
      return 'jeton obtenu';
    });
    if (!(out.jeton_v3 as { ok: boolean }).ok) {
      // Aide au diagnostic : quel hôte et quel ordre de clés accepte les identifiants (statuts HTTP seulement)
      await step('jeton_v3_essais', async () => {
        const tries: Record<string, number | string> = {};
        for (const [host, base] of Object.entries(V3)) {
          for (const [label, pair] of [['acces:secret', `${this.accessKey}:${this.secretKey}`], ['secret:acces', `${this.secretKey}:${this.accessKey}`]] as const) {
            try {
              const r = await fetch(`${base}/iam/account-app/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(pair).toString('base64')}`, Accept: 'application/json' } });
              tries[`${host} ${label}`] = r.status;
            } catch (err) {
              tries[`${host} ${label}`] = (err as Error).message;
            }
          }
        }
        tries['longueur cle acces'] = this.accessKey.length;
        tries['longueur cle secrete'] = this.secretKey.length;
        return tries;
      });
    }
    const parcel = { weightGrams: 900, lengthCm: 30, widthCm: 20, heightCm: 10 };
    let offers: Awaited<ReturnType<BoxtalShippingProvider['rawQuote']>> = [];
    await step('cotation_v1', async () => {
      offers = await this.rawQuote({ carrier: 'colissimo', parcel, fromPostalCode: '69003', toPostalCode: '75017', fromCity: 'Lyon', toCity: 'Paris' });
      return offers.map((o) => ({ operateur: `${o.operatorCode} ${o.operatorLabel}`, service: `${o.serviceCode} ${o.serviceLabel}`, livraison: o.deliveryType, transporteur: o.carrier, mode: o.mode, prixTtcCents: o.priceCents, codeOffre: o.offerCode }));
    });
    await step('points_relais_v3', async () => (await this.searchRelayPoints('mondial_relay', '75017', 'Paris')).slice(0, 3));
    if (withLabel) {
      const candidate = offers.find((o) => o.carrier && o.mode === 'domicile' && o.priceCents) || offers.find((o) => o.carrier && o.priceCents);
      await step('etiquette_v3', async () => {
        if (!candidate) throw new ShippingProviderError('boxtal', 'etiquette_impossible', 'aucune offre exploitable dans la cotation');
        const label = await this.createLabel({
          carrier: candidate.carrier,
          mode: candidate.mode,
          offerCode: candidate.offerCode,
          parcel,
          sender: { name: 'Camille Vendeur', line1: '12 rue de la République', postalCode: '69003', city: 'Lyon', country: 'FR', phone: '+33612345678', email: 'sandbox-expediteur@trocoin.fr' },
          recipient: { name: 'Alex Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris', country: 'FR', phone: '+33687654321', email: 'sandbox-destinataire@trocoin.fr' },
          reference: `diag-${Date.now()}`,
          contentDescription: 'Enceinte Bluetooth (test sandbox)',
          declaredValueCents: 12000,
        });
        const suivi = await this.track(candidate.carrier, label.trackingNumber, label.providerRef).catch((e) => ({ erreur: String((e as Error).message) }));
        const annulation = await this.cancel(label.providerRef).catch(() => false);
        return { offre: candidate.offerCode, commande: label.providerRef, numeroSuivi: label.trackingNumber, urlSuivi: label.trackingUrl, pdfOctets: label.labelPdf.length, pdfEntete: label.labelPdf.subarray(0, 5).toString(), prixCents: label.priceCents, suivi, annulee: annulation };
      });
    }
    return out;
  }
}

function summarizeHours(openingDays: unknown): string | undefined {
  try {
    const days = openingDays as Record<string, Array<{ start?: string; end?: string }> | unknown>;
    const parts: string[] = [];
    for (const [day, slots] of Object.entries(days)) {
      if (Array.isArray(slots) && slots.length) parts.push(`${day.slice(0, 3).toLowerCase()} ${slots.map((s) => `${s.start ?? ''}-${s.end ?? ''}`).join(', ')}`);
    }
    return parts.length ? parts.join(' · ').slice(0, 160) : undefined;
  } catch {
    return undefined;
  }
}
