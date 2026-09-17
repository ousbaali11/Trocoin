import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationsService } from '../conversations/conversations.service';
import { Listing } from '../listings/listing.entity';
import { Transaction } from '../payments/transaction.entity';
import { User } from '../users/user.entity';
import { CreateShipmentDto, QuoteShipmentDto } from './dto/shipment.dto';
import { Shipment } from './shipment.entity';
import { normalizeFrenchPhone } from './phone';
import { IShippingProvider, RelayPoint, ShippingCarrier, ShippingProviderError, ShippingRate, TrackingInfo } from './shipping-provider.interface';
import { SHIPPING_PROVIDER } from './shipping.constants';

/** Ce qu'un transporteur propose réellement pour une adresse : domicile, et points de retrait réels (relais, bureaux de poste, consignes). */
export interface CarrierPickupOptions {
  carrier: ShippingCarrier;
  label: string;
  domicile: boolean;
  pointRelais: boolean;
  /** Prix réels cotés pour le colis de l'annonce (AUDIT §59), en centimes TTC : ce que l'acheteur paiera en plus du prix. */
  domicilePriceCents?: number;
  pickupPriceCents?: number;
  points: RelayPoint[];
  /** Les points n'ont pas pu être lus (prestataire absent ou en panne) : le vendeur choisira le point à l'étiquette, comme avant. */
  pointsUnavailable?: boolean;
}
const CARRIER_LABELS: Record<ShippingCarrier, string> = { colissimo: 'Colissimo', mondial_relay: 'Mondial Relay' };
/** Colis de l'annonce ; sans poids déclaré par le vendeur, aucun prix ferme n'est possible : l'envoi n'est pas proposé (AUDIT §59). */
export const NO_WEIGHT_MESSAGE = "Le vendeur n'a pas indiqué le poids du colis : l'envoi n'est pas proposé pour cette annonce. Choisissez la remise en main propre ou demandez-lui de compléter son annonce.";
const parcelOf = (l: Listing) => (l.weightGrams && l.weightGrams > 0 ? { weightGrams: l.weightGrams, lengthCm: l.lengthCm ?? undefined, widthCm: l.widthCm ?? undefined, heightCm: l.heightCm ?? undefined } : null);

/** Ce que voient le vendeur et l'acheteur : jamais le PDF lui-même (route dédiée, vendeur seul). */
export type ShipmentView = Omit<Shipment, 'labelPdfBase64'> & { labelAvailable: boolean };

@Injectable()
export class ShippingService {
  private readonly logger = new Logger('Shipping');

  constructor(
    @InjectRepository(Shipment) private readonly shipments: Repository<Shipment>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(SHIPPING_PROVIDER) private readonly provider: IShippingProvider,
    private readonly conversations: ConversationsService,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Mémoire courte des réponses du prestataire (AUDIT §61). Les tarifs d'un colis entre deux codes postaux et les points
   * de retrait d'un code postal ne changent pas d'une minute à l'autre : les redemander à chaque frappe, à chaque
   * acheteur et de nouveau au paiement coûtait 1 à 3 s par appel. Seules les réussites sont gardées ; une demande déjà
   * en cours est partagée (deux acheteurs, ou le préchargement puis l'ouverture de la fenêtre, ne font qu'un appel).
   */
  private readonly memo = new Map<string, { at: number; value: Promise<unknown> }>();
  private cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.memo.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
    const value = load();
    this.memo.set(key, { at: Date.now(), value });
    value.catch(() => {
      if (this.memo.get(key)?.value === value) this.memo.delete(key);
    });
    if (this.memo.size > 500) for (const [k, v] of this.memo) if (Date.now() - v.at > 30 * 60_000 || this.memo.size > 400) this.memo.delete(k);
    return value;
  }
  private static readonly QUOTE_TTL = 10 * 60_000;
  private static readonly POINTS_TTL = 30 * 60_000;
  private norm(city?: string | null): string {
    return (city || '').trim().toLowerCase();
  }
  private cachedQuote(input: { carrier: ShippingCarrier; parcel: NonNullable<ReturnType<typeof parcelOf>>; fromPostalCode: string; toPostalCode: string; fromCity?: string; toCity?: string }): Promise<ShippingRate[]> {
    const p = input.parcel;
    const key = `q|${input.carrier}|${p.weightGrams}|${p.lengthCm ?? ''}x${p.widthCm ?? ''}x${p.heightCm ?? ''}|${input.fromPostalCode}|${input.toPostalCode}|${this.norm(input.toCity)}`;
    return this.cached(key, ShippingService.QUOTE_TTL, () => this.provider.quote(input));
  }
  private cachedPoints(carrier: ShippingCarrier, postalCode: string, city?: string): Promise<RelayPoint[]> {
    return this.cached(`p|${carrier}|${postalCode}|${this.norm(city)}`, ShippingService.POINTS_TTL, () => this.provider.searchRelayPoints(carrier, postalCode, city));
  }

  /** Tarifs pour le colis déclaré, sur le transporteur choisi par l'acheteur à l'achat. */
  async quote(transactionId: string, sellerId: string, dto: QuoteShipmentDto): Promise<{ carrier: ShippingCarrier; rates: ShippingRate[] }> {
    const tx = await this.sellerTransaction(transactionId, sellerId);
    const carrier = tx.deliveryMethod as ShippingCarrier;
    const [seller, buyer] = await Promise.all([this.users.findOne({ where: { id: tx.sellerId } }), this.users.findOne({ where: { id: tx.buyerId } })]);
    const fromPostalCode = dto.fromPostalCode || seller?.postalCode;
    const toPostalCode = dto.toPostalCode || tx.shippingAddress?.postalCode || buyer?.postalCode;
    if (!fromPostalCode || !toPostalCode) throw new BadRequestException('Codes postaux de départ et d\'arrivée requis.');
    const rates = await this.call(() => this.provider.quote({ carrier, parcel: dto.parcel, fromPostalCode, toPostalCode, fromCity: dto.fromCity || seller?.city, toCity: dto.toCity || tx.shippingAddress?.city || buyer?.city }));
    return { carrier, rates };
  }

  /**
   * Avant le paiement (AUDIT §57) : pour l'adresse de l'acheteur, ce que chaque transporteur propose vraiment — envoi à
   * domicile et/ou retrait — et les points de retrait réels renvoyés par le prestataire (jamais une liste inventée).
   * Un prestataire absent ou en panne ne bloque pas l'achat : les deux modes restent proposés, sans liste de points.
   */
  async pickupOptions(listingId: string, postalCode: string, city?: string, part: 'all' | 'points' | 'prices' = 'all'): Promise<{ postalCode: string; part: 'all' | 'points' | 'prices'; carriers: CarrierPickupOptions[]; unavailableReason?: string }> {
    if (!/^\d{5}$/.test(postalCode)) throw new BadRequestException('Code postal à 5 chiffres requis.');
    const listing = await this.listings.findOne({ where: { id: listingId } });
    if (!listing || !listing.deliveryAvailable) throw new NotFoundException("Cette annonce ne propose pas l'envoi.");
    const parcel = parcelOf(listing);
    if (!parcel || !listing.postalCode) return { postalCode, part, carriers: [], unavailableReason: NO_WEIGHT_MESSAGE };
    // AUDIT §61 : les deux transporteurs, et pour chacun le tarif et les points, sont demandés EN MÊME TEMPS (avant :
    // quatre appels l'un après l'autre — l'acheteur attendait leur somme). Les points sont cherchés sans attendre de
    // savoir si le retrait est coté : ils ne servent que s'il l'est.
    const fromPostalCode = listing.postalCode;
    const carriers = await Promise.all((['colissimo', 'mondial_relay'] as ShippingCarrier[]).map(async (carrier): Promise<CarrierPickupOptions> => {
      const base = { carrier, label: CARRIER_LABELS[carrier] };
      // Moitié « points » : la liste seule, sans attendre la cotation (pointRelais = provisoire, confirmé par les prix)
      if (part === 'points') {
        const points = await this.cachedPoints(carrier, postalCode, city).catch((err) => {
          this.logger.warn(`Points de retrait ${carrier} illisibles pour ${postalCode} : ${(err as Error).message}`);
          return [] as RelayPoint[];
        });
        return { ...base, domicile: false, pointRelais: points.length > 0, points };
      }
      try {
        const [rates, found] = await Promise.all([
          this.cachedQuote({ carrier, parcel, fromPostalCode, toPostalCode: postalCode, fromCity: listing.city ?? undefined, toCity: city }),
          (part === 'prices' ? Promise.resolve([] as RelayPoint[]) : this.cachedPoints(carrier, postalCode, city)).catch((err) => {
            this.logger.warn(`Points de retrait ${carrier} illisibles pour ${postalCode} : ${(err as Error).message}`);
            return [] as RelayPoint[];
          }),
        ]);
        const home = rates.find((r) => r.mode === 'domicile');
        const pickup = rates.find((r) => r.mode === 'point_relais');
        const points = pickup ? found : [];
        return { ...base, domicile: !!home, pointRelais: !!pickup && (part === 'prices' || points.length > 0), domicilePriceCents: home?.priceCents, pickupPriceCents: pickup?.priceCents, points };
      } catch (err) {
        this.logger.warn(`Options de retrait ${carrier} indisponibles pour ${postalCode} : ${(err as Error).message}`);
        // Sans cotation, pas de prix ferme à faire payer : ce transporteur n'est pas proposé pour l'instant
        return { ...base, domicile: false, pointRelais: false, points: [], pointsUnavailable: true };
      }
    }));
    return { postalCode, part, carriers };
  }

  /**
   * Prix ferme de la livraison au moment de l'achat (AUDIT §59) : cotation réelle du colis de l'annonce pour le
   * transporteur, le mode et l'adresse choisis. C'est ce montant que l'acheteur paie ; le bon d'envoi sera généré avec
   * exactement ce colis et ce mode.
   */
  async quoteForPurchase(listing: Listing, carrier: ShippingCarrier, mode: 'domicile' | 'point_relais', toPostalCode: string, toCity?: string) {
    const parcel = parcelOf(listing);
    if (!parcel || !listing.postalCode) throw new BadRequestException(NO_WEIGHT_MESSAGE);
    const rates = await this.call(() => this.cachedQuote({ carrier, parcel, fromPostalCode: listing.postalCode!, toPostalCode, fromCity: listing.city ?? undefined, toCity }));
    const rate = rates.find((r) => r.mode === mode);
    if (!rate || !rate.priceCents) throw new BadRequestException(`${CARRIER_LABELS[carrier]} ne propose pas ${mode === 'domicile' ? 'la livraison à domicile' : 'le retrait en point'} pour ce colis et cette adresse.`);
    return { offerCode: rate.offerCode, priceCents: rate.priceCents, mode, ...parcel };
  }

  /** Vente annulée avant l'expédition : le bon d'envoi déjà généré est annulé chez le prestataire quand il le permet (au mieux, sans bloquer). */
  async cancelLabelFor(transactionId: string): Promise<void> {
    const shipment = await this.shipments.findOne({ where: { transactionId, status: 'etiquette_prete' } });
    if (!shipment) return;
    // Le PDF est effacé dans tous les cas : un bon d'envoi d'une vente remboursée ne doit plus pouvoir servir
    await this.shipments.update(shipment.id, { labelPdfBase64: null as any, status: 'echec', error: 'vente annulée : bon d\'envoi retiré' });
    if (!shipment.providerRef || !this.provider.cancel) return;
    try {
      const done = await this.provider.cancel(shipment.providerRef);
      this.logger.log(`Bon d'envoi ${shipment.providerRef} de la vente annulée ${transactionId} : ${done ? 'annulé chez le prestataire' : 'annulation refusée (à reprendre à la main)'}`);
    } catch (e) {
      this.logger.warn(`Bon d'envoi ${shipment.providerRef} non annulé (${(e as Error).message}) : à reprendre à la main`);
    }
  }

  /**
   * Le point de retrait envoyé par l'acheteur doit exister chez le transporteur autour de son adresse : on le relit
   * chez le prestataire et on garde SA fiche (nom, adresse, nature), pas celle du navigateur. Prestataire injoignable :
   * la fiche transmise est gardée telle quelle plutôt que de bloquer le paiement.
   */
  async resolvePickupPoint(carrier: ShippingCarrier, pointId: string, postalCode: string, city: string | undefined, fallback: RelayPoint): Promise<RelayPoint> {
    let points: RelayPoint[];
    try {
      points = await this.cachedPoints(carrier, postalCode, city);
    } catch (err) {
      this.logger.warn(`Point de retrait ${pointId} non vérifié (${(err as Error).message})`);
      return fallback;
    }
    const found = points.find((p) => p.id === pointId);
    if (!found) throw new BadRequestException("Ce point de retrait n'est plus proposé par le transporteur pour votre adresse. Choisissez-en un autre.");
    return found;
  }

  async relayPoints(transactionId: string, sellerId: string, postalCode: string, city?: string): Promise<RelayPoint[]> {
    const tx = await this.sellerTransaction(transactionId, sellerId);
    if (!/^\d{5}$/.test(postalCode)) throw new BadRequestException('Code postal à 5 chiffres requis.');
    return this.call(() => this.provider.searchRelayPoints(tx.deliveryMethod as ShippingCarrier, postalCode, city));
  }

  /**
   * Achat de l'étiquette. En cas de refus du prestataire, l'expédition est conservée en « echec »
   * avec la raison, l'appel répond 502 et la transaction reste exactement où elle était : le vendeur
   * peut réessayer ou saisir un numéro de suivi à la main.
   */
  async createLabel(transactionId: string, sellerId: string, dto: CreateShipmentDto): Promise<ShipmentView> {
    const tx = await this.sellerTransaction(transactionId, sellerId);
    const carrier = tx.deliveryMethod as ShippingCarrier;
    // Livraison payée par l'acheteur (AUDIT §59) : le vendeur ne paie rien et ne choisit rien — il confirme la
    // disponibilité, puis génère le bon d'envoi avec le mode, le colis et le destinataire de la vente.
    const prepaid = !!tx.shippingQuote;
    if (prepaid) {
      if (!tx.sellerConfirmedAt) throw new BadRequestException("Confirmez d'abord que l'article est disponible : le bon d'envoi se génère ensuite.");
      if (!tx.shippingAddress) throw new BadRequestException("Adresse de livraison de l'acheteur absente : le bon d'envoi ne peut pas être généré.");
      const q = tx.shippingQuote!;
      dto.mode = q.mode;
      dto.parcel = { weightGrams: q.weightGrams, lengthCm: q.lengthCm, widthCm: q.widthCm, heightCm: q.heightCm };
      dto.recipient = { ...tx.shippingAddress, country: 'FR' } as CreateShipmentDto['recipient'];
    } else if (!dto.mode || !dto.parcel || !dto.recipient) {
      throw new BadRequestException('Mode, colis et destinataire requis.');
    }
    // Choix de l'acheteur au paiement (AUDIT §57) : le mode et le point de retrait ne se changent pas à l'étiquette
    if (tx.deliveryMode) dto.mode = tx.deliveryMode;
    if (tx.deliveryMode === 'point_relais' && tx.pickupPoint?.id) dto.relayPointId = tx.pickupPoint.id;
    if (dto.mode === 'point_relais' && !dto.relayPointId) throw new BadRequestException('Choisissez un point relais.');
    const existing = await this.shipments.findOne({ where: { transactionId } });
    if (existing && existing.status !== 'echec') throw new ConflictException('Une étiquette existe déjà pour cette vente.');
    const listing = await this.listings.findOne({ where: { id: tx.listingId } });

    // Téléphones (AUDIT §55) : les transporteurs les exigent pour les deux parties. On les règle AVANT tout appel au
    // prestataire, avec un message clair, au lieu de laisser remonter son refus technique. À défaut de saisie :
    // l'expéditeur reprend le numéro de son compte ; le destinataire celui de son adresse de livraison, puis celui
    // de son compte — ce dernier n'est transmis qu'au transporteur, jamais enregistré ni montré au vendeur.
    const [sellerUser, buyerUser] = await Promise.all([this.users.findOne({ where: { id: tx.sellerId } }), this.users.findOne({ where: { id: tx.buyerId } })]);
    if (dto.sender.phone?.trim() && !normalizeFrenchPhone(dto.sender.phone)) {
      throw new BadRequestException({ message: "Le numéro de téléphone de l'expéditeur n'est pas valide : 10 chiffres, par exemple 06 12 34 56 78.", code: 'telephone_invalide', field: 'sender.phone' });
    }
    if (dto.recipient.phone?.trim() && !normalizeFrenchPhone(dto.recipient.phone)) {
      throw new BadRequestException({ message: "Le numéro de téléphone du destinataire n'est pas valide : 10 chiffres, par exemple 06 12 34 56 78.", code: 'telephone_invalide', field: 'recipient.phone' });
    }
    const senderPhone = normalizeFrenchPhone(dto.sender.phone) ?? normalizeFrenchPhone(sellerUser?.phoneNumber);
    if (!senderPhone) {
      throw new BadRequestException({ message: "Indiquez votre numéro de téléphone (expéditeur) : le transporteur l'exige pour générer l'étiquette.", code: 'telephone_requis', field: 'sender.phone' });
    }
    const recipientShownPhone = normalizeFrenchPhone(dto.recipient.phone) ?? normalizeFrenchPhone(tx.shippingAddress?.phone);
    const recipientCarrierPhone = recipientShownPhone ?? normalizeFrenchPhone(buyerUser?.phoneNumber);
    if (!recipientCarrierPhone) {
      throw new BadRequestException({ message: "Indiquez le numéro de téléphone du destinataire : le transporteur l'exige pour générer l'étiquette. Demandez-le à l'acheteur par la messagerie.", code: 'telephone_requis', field: 'recipient.phone' });
    }

    const shipment = existing ?? this.shipments.create({ transactionId, listingId: tx.listingId, sellerId: tx.sellerId, buyerId: tx.buyerId });
    Object.assign(shipment, {
      provider: this.provider.name,
      carrier,
      mode: dto.mode,
      status: 'en_creation',
      weightGrams: dto.parcel.weightGrams,
      lengthCm: dto.parcel.lengthCm,
      widthCm: dto.parcel.widthCm,
      heightCm: dto.parcel.heightCm,
      sender: { ...dto.sender, phone: senderPhone, country: dto.sender.country || 'FR' },
      recipient: { ...dto.recipient, phone: recipientShownPhone ?? undefined, country: dto.recipient.country || 'FR' },
      relayPointId: dto.relayPointId,
      error: null,
    });
    await this.shipments.save(shipment);

    try {
      const rates = await this.provider.quote({ carrier, parcel: dto.parcel, fromPostalCode: shipment.sender.postalCode, toPostalCode: shipment.recipient.postalCode, fromCity: shipment.sender.city, toCity: shipment.recipient.city });
      const rate = rates.find((r) => r.mode === dto.mode);
      if (!rate) throw new ShippingProviderError(this.provider.name, 'transporteur_indisponible', 'aucune offre pour ce colis et ce mode');
      const label = await this.provider.createLabel({
        carrier,
        mode: dto.mode,
        offerCode: rate.offerCode,
        parcel: dto.parcel,
        sender: shipment.sender,
        recipient: { ...shipment.recipient, phone: recipientCarrierPhone },
        relayPointId: dto.relayPointId,
        reference: tx.id,
        contentDescription: listing?.title || 'Objet vendu sur Trocoin',
        declaredValueCents: Math.round(tx.amount * 100),
      });
      Object.assign(shipment, {
        status: 'etiquette_prete',
        offerCode: rate.offerCode,
        priceCents: label.priceCents,
        trackingNumber: label.trackingNumber,
        trackingUrl: label.trackingUrl,
        providerRef: label.providerRef,
        labelPdfBase64: label.labelPdf.toString('base64'),
      });
      await this.shipments.save(shipment);
      // Le numéro de suivi est repris sur la transaction : « Confirmer l'expédition » n'exige plus de saisie
      tx.deliveryTrackingNumber = label.trackingNumber;
      await this.transactions.save(tx);
      if (prepaid && label.priceCents > Math.round(tx.shippingFee * 100)) this.logger.warn(`Vente ${tx.id} : bon d'envoi à ${label.priceCents} c pour ${Math.round(tx.shippingFee * 100)} c payés par l'acheteur (écart à la charge de Trocoin)`);
      // L'acheteur a payé l'envoi : il reçoit le numéro de suivi dès que le bon existe ; le PDF reste au vendeur seul
      await this.conversations.postSystemEvent({ listingId: tx.listingId, buyerId: tx.buyerId, sellerId: tx.sellerId, actorId: tx.sellerId, transactionId: tx.id, event: 'etiquette_generee', content: `Bon d'envoi généré — suivi ${label.trackingNumber}`, meta: { trackingNumber: label.trackingNumber, trackingUrl: label.trackingUrl, carrier } });
      return this.view(shipment);
    } catch (err) {
      const e = err instanceof ShippingProviderError ? err : new ShippingProviderError(this.provider.name, 'reseau', (err as Error).message);
      shipment.status = 'echec';
      shipment.error = `${e.code} : ${e.reason}`;
      await this.shipments.save(shipment);
      this.logger.warn(`Étiquette refusée pour la transaction ${transactionId} : ${shipment.error}`);
      throw this.toHttp(e);
    }
  }

  /** Étiquette de la vente pour l'une des parties ; `null` (200) quand il n'y en a pas : une vente sans étiquette n'est pas une erreur (audit §42). */
  async getForViewer(transactionId: string, userId: string): Promise<ShipmentView | null> {
    const tx = await this.ownedTransaction(transactionId, userId);
    const shipment = await this.shipments.findOne({ where: { transactionId: tx.id } });
    if (!shipment) return null;
    if (tx.sellerId === userId) return this.view(shipment);
    // Acheteur (AUDIT §60) : l'état et le suivi de SON colis, jamais l'adresse ni le téléphone du vendeur, ni les
    // références et messages techniques du prestataire
    const { sender, providerRef, error, offerCode, ...rest } = this.view(shipment);
    void sender; void providerRef; void error; void offerCode;
    return rest as ShipmentView;
  }

  async labelPdf(transactionId: string, sellerId: string): Promise<Buffer> {
    const tx = await this.sellerTransaction(transactionId, sellerId, false);
    // Vente annulée ou remboursée : le bon d'envoi (payé par la livraison de l'acheteur, qui a été remboursé) n'est plus délivré
    if (['annulee', 'rembourse'].includes(tx.status)) throw new BadRequestException("Cette vente est annulée : le bon d'envoi n'est plus disponible.");
    const shipment = await this.shipments.findOne({ where: { transactionId } });
    if (!shipment || !shipment.labelPdfBase64) throw new NotFoundException("Aucune étiquette disponible pour cette vente.");
    return Buffer.from(shipment.labelPdfBase64, 'base64');
  }

  async tracking(transactionId: string, userId: string): Promise<TrackingInfo & { trackingNumber: string; trackingUrl?: string }> {
    const tx = await this.ownedTransaction(transactionId, userId);
    const shipment = await this.shipments.findOne({ where: { transactionId: tx.id } });
    const trackingNumber = shipment?.trackingNumber || tx.deliveryTrackingNumber;
    if (!trackingNumber) throw new NotFoundException('Aucun numéro de suivi pour cette vente.');
    if (!shipment?.trackingNumber) {
      // Numéro saisi à la main : pas de suivi automatique, seulement le numéro
      return { state: 'pris_en_charge', events: [], trackingNumber };
    }
    const info = await this.call(() => this.provider.track(shipment.carrier, trackingNumber, shipment.providerRef));
    return { ...info, trackingNumber, trackingUrl: shipment.trackingUrl };
  }

  // ------------------------------------------------------------------ helpers

  private view(s: Shipment): ShipmentView {
    const { labelPdfBase64, ...rest } = s;
    return { ...rest, labelAvailable: !!labelPdfBase64 || !!s.labelUrl };
  }

  private async ownedTransaction(transactionId: string, userId: string): Promise<Transaction> {
    const tx = await this.transactions.findOne({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction introuvable.');
    if (tx.buyerId !== userId && tx.sellerId !== userId) throw new ForbiddenException("Vous n'avez pas accès à cette transaction.");
    return tx;
  }

  /** Le vendeur, sur une vente payée (fonds bloqués) avec envoi ; l'étiquette se crée avant l'expédition. */
  private async sellerTransaction(transactionId: string, sellerId: string, mustBeShippable = true): Promise<Transaction> {
    const tx = await this.ownedTransaction(transactionId, sellerId);
    if (tx.sellerId !== sellerId) throw new ForbiddenException('Seul le vendeur gère l\'expédition.');
    if (tx.deliveryMethod === 'main_propre') throw new BadRequestException('Cette vente est une remise en main propre : pas d\'étiquette.');
    if (mustBeShippable && tx.status !== 'sequestre') throw new BadRequestException(`Impossible depuis le statut "${tx.status}".`);
    return tx;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ShippingProviderError) throw this.toHttp(err);
      throw new BadGatewayException({ message: `Prestataire d'expédition injoignable : ${(err as Error).message}`, code: 'reseau' });
    }
  }

  private toHttp(e: ShippingProviderError) {
    const body = { message: e.message, code: e.code, provider: e.provider };
    if (e.code === 'non_configure') return new ServiceUnavailableException(body);
    if (e.code === 'adresse_invalide' || e.code === 'etiquette_impossible') return new BadRequestException(body);
    return new BadGatewayException(body);
  }
}
