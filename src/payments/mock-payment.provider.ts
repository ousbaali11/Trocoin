import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CheckoutResult,
  CheckoutSync,
  CreateCheckoutParams,
  CreatePaymentIntentParams,
  IPaymentProvider,
  PaymentIntentResult,
  TransferParams,
} from './payment-provider.interface';

/** Session de la page de paiement simulée (mode hébergé du fournisseur simulé). */
export interface MockCheckoutSession {
  id: string;
  transactionId: string;
  title: string;
  amountEuros: number;
  successUrl: string;
  cancelUrl: string;
  state: 'ouverte' | 'payee' | 'expiree';
  /** Nombre de refus simulés (carte refusée) : la page reste affichée, comme chez Stripe. */
  refusals: number;
}

/**
 * Simule un séquestre sans appeler de service externe : utile pour développer
 * et tester tout le flux (création -> confirmation -> litige) hors-ligne.
 * Interdit en production (bloqué par validateEnv).
 *
 * Mode hébergé (AUDIT §57) : désactivé par défaut (paiement immédiat, comme avant). Activé par
 * `POST /dev/mock-checkout/mode` ou MOCK_PAYMENT_HOSTED=1, il se comporte comme Stripe Checkout : la transaction
 * naît « en_attente », l'acheteur part sur une page de paiement servie par l'API (`/dev/mock-checkout/:id`), puis
 * revient sur l'adresse de succès ou d'annulation. Sert à tester les retours de paiement de bout en bout.
 */
@Injectable()
export class MockPaymentProvider implements IPaymentProvider {
  private readonly logger = new Logger('Paiement(mock)');
  private hosted = false;
  private readonly sessions = new Map<string, MockCheckoutSession>();
  /** Présent seulement en mode hébergé : c'est sa présence qui fait naître la transaction « en_attente ». */
  createCheckout?: (params: CreateCheckoutParams) => Promise<CheckoutResult>;

  constructor() {
    this.setHosted(process.env.MOCK_PAYMENT_HOSTED === '1');
  }

  setHosted(on: boolean) {
    this.hosted = on;
    this.createCheckout = on ? (params) => this.hostedCheckout(params) : undefined;
  }
  get isHosted(): boolean {
    return this.hosted;
  }
  getSession(id: string): MockCheckoutSession | undefined {
    return this.sessions.get(id);
  }

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    const providerPaymentId = `mock_pi_${randomUUID()}`;
    this.logger.log(
      `Séquestre simulé de ${params.amountEuros} € (part plateforme ${params.applicationFeeEuros} €, vendeur ${params.sellerConnectedAccountId || 'non connecté'}) réf ${providerPaymentId}`,
    );
    // Comme une carte en ligne chez Stripe : l'autorisation vaut 7 jours (date limite de capture)
    return { providerPaymentId, status: 'requires_capture', captureBefore: new Date(Date.now() + 7 * 86_400_000) };
  }

  private async hostedCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const id = `mock_cs_${randomUUID()}`;
    this.sessions.set(id, { id, transactionId: params.transactionId, title: params.title, amountEuros: params.amountEuros, successUrl: params.successUrl, cancelUrl: params.cancelUrl, state: 'ouverte', refusals: 0 });
    const base = (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
    this.logger.log(`Page de paiement simulée ${id} pour la transaction ${params.transactionId} (${params.amountEuros} €)`);
    return { providerSessionId: id, checkoutUrl: `${base}/dev/mock-checkout/${id}`, expiresAt: new Date(Date.now() + 30 * 60_000) };
  }

  async syncCheckout(providerSessionId: string): Promise<CheckoutSync> {
    const s = this.sessions.get(providerSessionId);
    if (!s || s.state === 'expiree') return { status: 'annulee' };
    if (s.state === 'payee') return { status: 'sequestre', providerPaymentId: `mock_pi_${s.id.slice(8)}`, paymentMethodType: 'card', captureBefore: new Date(Date.now() + 7 * 86_400_000) };
    const base = (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
    return { status: 'en_attente', checkoutUrl: `${base}/dev/mock-checkout/${s.id}` };
  }

  async expireCheckout(providerSessionId: string): Promise<void> {
    const s = this.sessions.get(providerSessionId);
    if (s && s.state === 'ouverte') s.state = 'expiree';
  }

  async capture(providerPaymentId: string) {
    this.logger.log(`Capture simulée : ${providerPaymentId}`);
    return { status: 'succeeded' as const };
  }

  async refund(providerPaymentId: string) {
    this.logger.log(`Remboursement simulé : ${providerPaymentId}`);
    return { status: 'rembourse' as const };
  }

  async transfer(params: TransferParams) {
    const transferId = `mock_tr_${randomUUID()}`;
    this.logger.log(`Virement simulé de ${params.amountEuros} € vers ${params.sellerConnectedAccountId} (paiement ${params.providerPaymentId}) réf ${transferId}`);
    return { transferId };
  }

  async reverseTransfer(transferId: string) {
    this.logger.log(`Annulation de virement simulée : ${transferId}`);
  }
}
