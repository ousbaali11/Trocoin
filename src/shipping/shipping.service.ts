import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Listing } from '../listings/listing.entity';
import { Transaction } from '../payments/transaction.entity';
import { User } from '../users/user.entity';
import { CreateShipmentDto, QuoteShipmentDto } from './dto/shipment.dto';
import { Shipment } from './shipment.entity';
import { IShippingProvider, RelayPoint, ShippingCarrier, ShippingProviderError, ShippingRate, TrackingInfo } from './shipping-provider.interface';
import { SHIPPING_PROVIDER } from './shipping.constants';

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
  ) {}

  get providerName(): string {
    return this.provider.name;
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
    if (dto.mode === 'point_relais' && !dto.relayPointId) throw new BadRequestException('Choisissez un point relais.');
    const existing = await this.shipments.findOne({ where: { transactionId } });
    if (existing && existing.status !== 'echec') throw new ConflictException('Une étiquette existe déjà pour cette vente.');
    const listing = await this.listings.findOne({ where: { id: tx.listingId } });

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
      sender: { ...dto.sender, country: dto.sender.country || 'FR' },
      recipient: { ...dto.recipient, country: dto.recipient.country || 'FR' },
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
        recipient: shipment.recipient,
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

  async getForViewer(transactionId: string, userId: string): Promise<ShipmentView> {
    const tx = await this.ownedTransaction(transactionId, userId);
    const shipment = await this.shipments.findOne({ where: { transactionId: tx.id } });
    if (!shipment) throw new NotFoundException('Aucune expédition pour cette vente.');
    return this.view(shipment);
  }

  async labelPdf(transactionId: string, sellerId: string): Promise<Buffer> {
    await this.sellerTransaction(transactionId, sellerId, false);
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
