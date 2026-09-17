import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateLabelInput,
  IShippingProvider,
  LabelResult,
  QuoteInput,
  RelayPoint,
  classifyPickupPoint,
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
/** Nombre de points de retrait proposés autour d'une adresse. */
const MAX_POINTS = 20;
/** Offre « point de retrait » de chaque transporteur (codes v3 vérifiés en sandbox le 16 septembre 2026) ; `BOXTAL_OFFER_*` reste prioritaire. */
const DEFAULT_PICKUP_OFFER: Record<ShippingCarrier, string> = { mondial_relay: 'MONR-CpourToi', colissimo: 'POFR-ColissimoPickupStation' };

interface RawParcelPointHit {
  parcelPoint?: { code?: string; name?: string; network?: unknown; type?: string; typeCode?: string; parcelPointType?: string; location?: { number?: string; street?: string; postalCode?: string; city?: string }; openingDays?: unknown };
  distanceFromSearchLocation?: number;
}
function mapParcelPoint(p: RawParcelPointHit, postalCode: string, city?: string): RelayPoint {
  const pp = p.parcelPoint || {};
  const name = pp.name || 'Point de retrait';
  return {
    id: pp.code || '',
    name,
    type: classifyPickupPoint(name, [pp.type, pp.typeCode, pp.parcelPointType].filter(Boolean).join(' ')),
    line1: [pp.location?.number, pp.location?.street].filter(Boolean).join(' '),
    postalCode: pp.location?.postalCode || postalCode,
    city: pp.location?.city || city || '',
    hours: pp.openingDays ? summarizeHours(pp.openingDays) : undefined,
    distanceMeters: p.distanceFromSearchLocation,
  };
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

/**
 * Refus de validation de Boxtal (HTTP 400 / 422) traduit en une phrase pour le vendeur (AUDIT §55). Le corps est de la
 * forme { errors: [{ code, parameters: [{ code, field, message, value }] }] } ; chaque champ refusé devient un motif
 * lisible (« numéro de téléphone de l'expéditeur invalide »). Jamais de JSON brut à l'écran.
 */
export function describeBoxtalRefusal(text: string): string {
  const reasons = new Set<string>();
  try {
    const body = JSON.parse(text) as { errors?: Array<{ code?: string; message?: string; parameters?: Array<{ code?: string; field?: string; message?: string }> }> };
    for (const err of body.errors ?? []) {
      const params = err.parameters?.length ? err.parameters : [{ code: err.code, field: '', message: err.message }];
      for (const prm of params) {
        const field = prm.field ?? '';
        const who = /fromAddress|sender|shipper/i.test(field) ? "de l'expéditeur" : /toAddress|recipient|receiver/i.test(field) ? 'du destinataire' : '';
        const kind = String(prm.code ?? '') + ' ' + field;
        if (/phone/i.test(kind)) reasons.add(('numéro de téléphone ' + who).trim() + ' manquant ou invalide');
        else if (/zip|postal/i.test(kind)) reasons.add(('code postal ' + who).trim() + ' non reconnu');
        else if (/city/i.test(kind)) reasons.add(('ville ' + who).trim() + ' non reconnue pour ce code postal');
        else if (/street|address|line/i.test(kind)) reasons.add(('adresse ' + who).trim() + ' incomplète ou non reconnue');
        else if (/email/i.test(kind)) reasons.add(('adresse e-mail ' + who).trim() + ' invalide');
        else if (/weight|dimension|length|width|height|package/i.test(kind)) reasons.add('poids ou dimensions du colis refusés');
        else if (/pickupPoint|dropOff|parcelPoint|relay/i.test(kind)) reasons.add('point relais refusé : choisissez-en un autre');
        else if (/ShippingOfferCode|offer/i.test(kind)) reasons.add("cette offre n'est pas disponible pour ce colis");
      }
    }
  } catch {
    /* corps non JSON : message générique ci-dessous */
  }
  if (reasons.size === 0) return "le transporteur a refusé la demande. Vérifiez les adresses, les téléphones et le colis, puis réessayez, ou saisissez votre numéro de suivi à la main.";
  return 'le transporteur a refusé la demande : ' + [...reasons].join(' ; ') + '. Corrigez puis réessayez.';
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

  private async bearer(base = this.v3Base): Promise<string> {
    if (base === this.v3Base && this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    let res: Response;
    try {
      res = await fetch(`${base}/iam/account-app/token`, {
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
    if (base === this.v3Base) this.token = { value: body.accessToken, expiresAt: Date.now() + (body.expiresIn ?? 300) * 1000 };
    return body.accessToken;
  }

  private async v3<T>(method: string, path: string, body?: unknown, raw = false, base = this.v3Base): Promise<{ status: number; data: T; text: string }> {
    const token = await this.bearer(base);
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
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
      // Le refus technique (JSON de Boxtal) va au journal ; le vendeur lit une phrase (AUDIT §55)
      this.logger.warn(`Demande refusée par Boxtal (HTTP ${status}) : ${short}`);
      return new ShippingProviderError('boxtal', code, describeBoxtalRefusal(text));
    }
    if (status >= 500) return new ShippingProviderError('boxtal', 'transporteur_indisponible', `Boxtal indisponible (HTTP ${status})`);
    return new ShippingProviderError('boxtal', fallback, `HTTP ${status} ${short}`);
  }

  // ------------------------------------------------------------------ v1 : cotation

  private async v1Cotation(params: Record<string, string>, base = this.v1Base): Promise<string> {
    // La cotation se lit en GET (la bibliothèque officielle construit server + action + '?' + query ; POST répond 405)
    const query = new URLSearchParams({ ...params, platform: 'trocoin', platform_version: '1', module_version: '1' });
    const attempt = async (authHeader: string) => {
      try {
        return await fetch(`${base}/api/v1/cotation?${query.toString()}`, {
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
  async rawQuote(input: QuoteInput & { fromCity?: string; toCity?: string }, v1Base = this.v1Base): Promise<Array<ShippingRate & { operatorCode: string; operatorLabel: string; serviceCode: string; serviceLabel: string; deliveryType: string; carrier: ShippingCarrier | null }>> {
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
    }, v1Base);
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
        // Code d'offre v3 = « OPÉRATEUR-Service » (tiret) : vérifié en sandbox le 16 septembre 2026 (MONR-DomicileFrance
        // accepté, MONR_DomicileFrance refusé « ValidShippingOfferCode »)
        offerCode: configured || `${operatorCode}-${serviceCode}`,
        label: `${operatorLabel || CARRIER_LABEL[carrier || 'colissimo']} ${serviceLabel || ''}`.trim(),
        operatorCode,
        operatorLabel,
        serviceCode,
        serviceLabel,
        deliveryType,
      };
    });
  }

  /**
   * La cotation v1 renvoie les offres de TOUS les transporteurs pour un trajet et un colis : Colissimo et Mondial Relay,
   * demandés ensemble par la fenêtre d'achat, partagent donc la même requête (AUDIT §61 — avant : deux requêtes
   * identiques de plusieurs secondes). Gardée dix minutes ; un échec n'est jamais gardé.
   */
  private readonly quoteMemo = new Map<string, { at: number; offers: ReturnType<BoxtalShippingProvider['rawQuote']> }>();
  private sharedRawQuote(input: QuoteInput & { fromCity?: string; toCity?: string }): ReturnType<BoxtalShippingProvider['rawQuote']> {
    const p = input.parcel;
    const key = [input.fromPostalCode, (input.fromCity || '').toLowerCase(), input.toPostalCode, (input.toCity || '').toLowerCase(), p.weightGrams, p.lengthCm ?? '', p.widthCm ?? '', p.heightCm ?? '', new Date().toISOString().slice(0, 10)].join('|');
    const hit = this.quoteMemo.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.offers;
    const offers = this.rawQuote(input);
    this.quoteMemo.set(key, { at: Date.now(), offers });
    offers.catch(() => {
      if (this.quoteMemo.get(key)?.offers === offers) this.quoteMemo.delete(key);
    });
    if (this.quoteMemo.size > 300) for (const [k, v] of this.quoteMemo) if (Date.now() - v.at > 10 * 60_000 || this.quoteMemo.size > 200) this.quoteMemo.delete(k);
    return offers;
  }

  async quote(input: QuoteInput & { fromCity?: string; toCity?: string }): Promise<ShippingRate[]> {
    const offers = await this.sharedRawQuote(input);
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

  /**
   * Points de retrait réels du transporteur autour d'une adresse : relais commerçants, bureaux de poste et consignes
   * automatiques (AUDIT §57). D'abord les points valables pour l'offre « point de retrait » du transporteur
   * (v3.2, `parcel-point-by-shipping-offer`, côté arrivée) ; à défaut, la recherche générale v3.1 filtrée par réseau.
   */
  async searchRelayPoints(carrier: ShippingCarrier, postalCode: string, city?: string, v3Base = this.v3Base): Promise<RelayPoint[]> {
    const byOffer = await this.pointsByOffer(carrier, postalCode, city, v3Base).catch(() => [] as RelayPoint[]);
    if (byOffer.length) return byOffer;
    const qs = new URLSearchParams({ countryIsoCode: 'FR', postalCode, ...(city ? { city } : {}) });
    const r = await this.v3<{ content?: RawParcelPointHit[] }>('GET', `/shipping/v3.1/parcel-point?${qs}`, undefined, false, v3Base);
    if (r.status >= 400) throw this.v3Error(r.status, r.text, 'transporteur_indisponible');
    const all = (r.data?.content || []).map((p) => ({ point: mapParcelPoint(p, postalCode, city), network: JSON.stringify(p.parcelPoint?.network || '').toLowerCase() }));
    const wanted = carrier === 'mondial_relay' ? /monr|mondial|inpost/ : /pofr|colissimo|poste|pickup/;
    const filtered = all.filter((p) => wanted.test(p.network));
    return (filtered.length ? filtered : all).slice(0, MAX_POINTS).map((p) => p.point);
  }

  /** Points valables pour l'offre « point de retrait » du transporteur (code configuré, sinon code public de l'offre). */
  private async pointsByOffer(carrier: ShippingCarrier, postalCode: string, city: string | undefined, v3Base: string): Promise<RelayPoint[]> {
    const offer = this.offerCodes[`${carrier}:point_relais`] || DEFAULT_PICKUP_OFFER[carrier];
    const qs = new URLSearchParams({ countryIsoCode: 'FR', operationType: 'ARRIVAL', shippingOfferCode: offer, postalCode, ...(city ? { city } : {}) });
    const r = await this.v3<{ content?: RawParcelPointHit[] }>('GET', `/shipping/v3.2/parcel-point-by-shipping-offer?${qs}`, undefined, false, v3Base);
    if (r.status >= 400) return [];
    return (r.data?.content || []).map((p) => mapParcelPoint(p, postalCode, city)).filter((p) => p.id).slice(0, MAX_POINTS);
  }

  /** Diagnostic : forme brute d'un point (noms de champs seulement) et répartition par nature, pour vérifier le classement. */
  async describeParcelPoints(carrier: ShippingCarrier, postalCode: string, city?: string): Promise<{ source: string; champs: string[]; reseaux: string[]; parNature: Record<string, number>; exemples: Array<{ nom: string; nature: string }> }> {
    const offer = this.offerCodes[`${carrier}:point_relais`] || DEFAULT_PICKUP_OFFER[carrier];
    const qsOffer = new URLSearchParams({ countryIsoCode: 'FR', operationType: 'ARRIVAL', shippingOfferCode: offer, postalCode, ...(city ? { city } : {}) });
    let r = await this.v3<{ content?: RawParcelPointHit[] }>('GET', `/shipping/v3.2/parcel-point-by-shipping-offer?${qsOffer}`);
    let source = `v3.2 par offre ${offer} → ${r.status}`;
    if (r.status >= 400 || !(r.data?.content || []).length) {
      const qs = new URLSearchParams({ countryIsoCode: 'FR', postalCode, ...(city ? { city } : {}) });
      r = await this.v3<{ content?: RawParcelPointHit[] }>('GET', `/shipping/v3.1/parcel-point?${qs}`);
      source += ` ; repli v3.1 → ${r.status}`;
    }
    const hits = r.data?.content || [];
    const first = (hits[0]?.parcelPoint || {}) as Record<string, unknown>;
    const points = hits.map((p) => mapParcelPoint(p, postalCode, city));
    const parNature: Record<string, number> = {};
    for (const p of points) parNature[p.type] = (parNature[p.type] || 0) + 1;
    return {
      source,
      champs: Object.keys(first).map((k) => `${k}:${Array.isArray(first[k]) ? 'liste' : typeof first[k]}${typeof first[k] === 'string' && /type|kind|categ/i.test(k) ? '=' + String(first[k]) : ''}`),
      reseaux: [...new Set(hits.map((p) => JSON.stringify(p.parcelPoint?.network ?? null)))].slice(0, 6),
      parNature,
      exemples: points.slice(0, 12).map((p) => ({ nom: p.name, nature: p.type })),
    };
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
        // Même chose pour la cotation v1 : hôte de test et hôte de production, en-tête avec et sans « Basic »
        const q = new URLSearchParams({ 'shipper.pays': 'FR', 'shipper.code_postal': '69003', 'shipper.ville': 'Lyon', 'shipper.type': 'individual', 'recipient.pays': 'FR', 'recipient.code_postal': '75017', 'recipient.ville': 'Paris', 'recipient.type': 'individual', 'colis_1.poids': '0.9', 'colis_1.longueur': '30', 'colis_1.largeur': '20', 'colis_1.hauteur': '10', code_contenu: this.contentCode, collecte: new Date().toISOString().slice(0, 10), delai: 'aucun' });
        const cred = Buffer.from(`${this.v1Login}:${this.v1Password}`).toString('base64');
        for (const [host, base] of Object.entries(V1)) {
          for (const [label, header] of [['Basic', `Basic ${cred}`], ['nu', cred]] as const) {
            try {
              const r = await fetch(`${base}/api/v1/cotation?${q}`, { headers: { Authorization: header, 'Api-Version': '1.3.7', 'Accept-Language': 'fr-FR', Accept: 'application/xml' } });
              const t = await r.text();
              tries[`v1 ${host} ${label}`] = `${r.status}${r.ok ? ' ' + xmlBlocks(t, 'offer').length + ' offre(s)' : ' ' + (xmlText(t, 'error_description') || xmlText(t, 'error/message') || '').slice(0, 80)}`;
            } catch (err) {
              tries[`v1 ${host} ${label}`] = (err as Error).message;
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
    await step('nature_des_points', async () => ({ mondial_relay: await this.describeParcelPoints('mondial_relay', '75017', 'Paris'), colissimo: await this.describeParcelPoints('colissimo', '75017', 'Paris') }));
    if (!(out.jeton_v3 as { ok: boolean }).ok && this.env === 'sandbox') {
      // Les clés ne sont pas acceptées par le sandbox : lectures sans effet (cotation, points relais) sur l'hôte de
      // production pour valider les formats d'échange. Aucune commande n'est jamais passée hors sandbox ici.
      await step('lecture_seule_production', async () => {
        const offers = await this.rawQuote({ carrier: 'colissimo', parcel, fromPostalCode: '69003', toPostalCode: '75017', fromCity: 'Lyon', toCity: 'Paris' }, V1.production).catch((e) => ({ erreur: e instanceof ShippingProviderError ? { code: e.code, reason: e.reason } : String((e as Error).message) }));
        const points = await this.searchRelayPoints('mondial_relay', '75017', 'Paris', V3.production).catch((e) => ({ erreur: e instanceof ShippingProviderError ? { code: e.code, reason: e.reason } : String((e as Error).message) }));
        return {
          avertissement: 'clés acceptées par api.boxtal.com et non par api.boxtal.build : les applications ont été créées dans le compte de production ; aucune étiquette ne sera achetée tant que BOXTAL_ENV=sandbox',
          cotation: Array.isArray(offers) ? offers.map((o) => ({ operateur: `${o.operatorCode} ${o.operatorLabel}`, service: `${o.serviceCode} ${o.serviceLabel}`, livraison: o.deliveryType, transporteur: o.carrier, mode: o.mode, prixTtcCents: o.priceCents, codeOffre: o.offerCode })) : offers,
          pointsRelais: Array.isArray(points) ? points.slice(0, 3) : points,
        };
      });
    }
    // Codes d'offre v3 : la commande exige un code de contrat activé sur l'application (portail développeur),
    // sans point d'entrée de recherche. Sonde en lecture seule : `parcel-point-by-shipping-offer` (v3.2) refuse
    // un code inconnu (ValidationException.ValidShippingOfferCode) et répond 200 pour un code utilisable.
    const probed: Array<{ code: string; carrier: ShippingCarrier | null; mode: ShippingMode; ok: boolean; statut: string }> = [];
    if ((out.jeton_v3 as { ok: boolean }).ok) {
      await step('codes_offre_v3', async () => {
        const configured = Object.entries(this.offerCodes).filter(([, v]) => v).map(([k, v]) => ({ code: v as string, carrier: k.split(':')[0] as ShippingCarrier, mode: k.split(':')[1] as ShippingMode }));
        const fromQuote = offers.filter((o) => o.carrier).map((o) => ({ code: o.offerCode, carrier: o.carrier, mode: o.mode }));
        const seen = new Set<string>();
        for (const c of [...configured, ...fromQuote]) {
          for (const code of [c.code, c.code.replace('_', '-')]) {
            if (seen.has(code)) continue;
            seen.add(code);
            // operationType : DEPARTURE (points de dépôt pour l'expéditeur) — valeur attendue par l'API v3.2
            const qs = new URLSearchParams({ countryIsoCode: 'FR', operationType: 'DEPARTURE', shippingOfferCode: code, postalCode: '69003', city: 'Lyon' });
            const r = await this.v3<{ errors?: Array<{ code?: string; parameters?: unknown; message?: string }>; content?: unknown[] }>('GET', `/shipping/v3.2/parcel-point-by-shipping-offer?${qs}`).catch((e) => ({ status: 0, data: undefined, text: String((e as Error).message) }));
            const err = r.data?.errors?.[0];
            const ok = r.status >= 200 && r.status < 300;
            probed.push({ code, carrier: c.carrier, mode: c.mode, ok, statut: ok ? `200 (${Array.isArray(r.data?.content) ? r.data!.content!.length : '?'} point(s))` : `${r.status} ${err ? JSON.stringify(err).slice(0, 200) : r.text.slice(0, 200)}` });
          }
        }
        return probed.map((p) => `${p.code} [${p.mode}] → ${p.statut}`);
      });
    }
    if ((out.jeton_v3 as { ok: boolean }).ok) {
      // Y a-t-il un point d'entrée listant les offres du compte ? Statuts et début de réponse, sans effet.
      await step('liste_offres_v3', async () => {
        const tries: Record<string, string> = {};
        for (const [method, path, body] of [
          ['GET', '/shipping/v3.1/shipping-offer', undefined],
          ['GET', '/shipping/v3.2/shipping-offer', undefined],
          ['GET', '/shipping/v3.1/shipping-offer?countryIsoCode=FR', undefined],
          ['GET', '/shipping/v3.1/contract', undefined],
          ['POST', '/shipping/v3.1/shipping-offer', { shipment: { packages: [{ type: 'PARCEL', weight: 0.9, length: 30, width: 20, height: 10, value: { value: 120, currency: 'EUR' } }], fromAddress: { type: 'RESIDENTIAL', location: { city: 'Lyon', postalCode: '69003', countryIsoCode: 'FR' } }, toAddress: { type: 'RESIDENTIAL', location: { city: 'Paris', postalCode: '75017', countryIsoCode: 'FR' } } } }],
        ] as const) {
          const r = await this.v3<unknown>(method, path, body).catch((e) => ({ status: 0, data: undefined, text: String((e as Error).message) }));
          tries[`${method} ${path}`] = `${r.status} ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`;
        }
        return tries;
      });
    }
    if (withLabel) {
      await step('etiquette_v3', async () => {
        // Candidats : codes acceptés par la sonde d'abord (domicile avant relais), puis la cotation telle quelle
        const ranked = [
          ...probed.filter((p) => p.ok && p.mode === 'domicile'),
          ...probed.filter((p) => p.ok && p.mode === 'point_relais'),
          ...offers.filter((o) => o.carrier && o.priceCents && o.mode === 'domicile').map((o) => ({ code: o.offerCode, carrier: o.carrier, mode: o.mode, ok: false, statut: 'non sondé' })),
        ].filter((c, i, arr) => c.carrier && arr.findIndex((x) => x.code === c.code) === i).slice(0, 4);
        if (ranked.length === 0) throw new ShippingProviderError('boxtal', 'etiquette_impossible', "aucun code d'offre utilisable (activez des contrats sur l'application sandbox et renseignez BOXTAL_OFFER_*)");
        const relay = ranked.some((c) => c.mode === 'point_relais') ? await this.searchRelayPoints('mondial_relay', '75017', 'Paris').catch(() => []) : [];
        const essais: Array<{ offre: string; erreur: string }> = [];
        for (const candidate of ranked) {
          try {
            const label = await this.createLabel({
              carrier: candidate.carrier!,
              mode: candidate.mode,
              offerCode: candidate.code,
              relayPointId: candidate.mode === 'point_relais' ? relay[0]?.id : undefined,
              parcel,
              sender: { name: 'Camille Vendeur', line1: '12 rue de la République', postalCode: '69003', city: 'Lyon', country: 'FR', phone: '+33612345678', email: 'sandbox-expediteur@trocoin.fr' },
              recipient: { name: 'Alex Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris', country: 'FR', phone: '+33687654321', email: 'sandbox-destinataire@trocoin.fr' },
              reference: `diag-${Date.now()}`,
              contentDescription: 'Enceinte Bluetooth (test sandbox)',
              declaredValueCents: 12000,
            });
            const suivi = await this.track(candidate.carrier!, label.trackingNumber, label.providerRef).catch((e) => ({ erreur: String((e as Error).message) }));
            const annulation = await this.cancel(label.providerRef).catch(() => false);
            return {
              offre: candidate.code,
              mode: candidate.mode,
              pointRelais: candidate.mode === 'point_relais' ? relay[0] : undefined,
              essaisPrecedents: essais,
              commande: label.providerRef,
              numeroSuivi: label.trackingNumber,
              urlSuivi: label.trackingUrl,
              prixCents: label.priceCents,
              pdfOctets: label.labelPdf.length,
              pdfEntete: label.labelPdf.subarray(0, 5).toString(),
              // Étiquette de test (adresses fictives, sandbox) : preuve téléchargeable
              pdfBase64: label.labelPdf.toString('base64'),
              suivi,
              annulee: annulation,
            };
          } catch (err) {
            essais.push({ offre: candidate.code, erreur: err instanceof ShippingProviderError ? `${err.code} : ${err.reason}` : String((err as Error).message) });
          }
        }
        throw new ShippingProviderError('boxtal', 'etiquette_impossible', essais.map((e) => `${e.offre} → ${e.erreur}`).join(' | '));
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
    // Les créneaux réels arrivent parfois sans heures (« - ») : on n'affiche rien plutôt qu'une ligne de tirets
    const useful = parts.filter((p) => /\d/.test(p));
    return useful.length ? useful.join(' · ').slice(0, 160) : undefined;
  } catch {
    return undefined;
  }
}
