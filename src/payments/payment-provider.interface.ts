export interface CreatePaymentIntentParams {
  /** Montant total débité à l'acheteur (prix + frais acheteur). */
  amountEuros: number;
  /** Part conservée par la plateforme (commission vendeur + frais acheteur). */
  applicationFeeEuros: number;
  sellerConnectedAccountId?: string;
  metadata: Record<string, string>;
}

export interface PaymentIntentResult {
  providerPaymentId: string;
  clientSecret?: string;
  status: 'requires_capture' | 'succeeded' | 'processing';
  /** Date limite de capture de l'autorisation, quand le fournisseur la connaît (Stripe : `capture_before`). */
  captureBefore?: Date;
}

/** Paiement hébergé (page de paiement du fournisseur, ex. Stripe Checkout). */
export interface CreateCheckoutParams extends CreatePaymentIntentParams {
  transactionId: string;
  /** Libellé affiché sur la page de paiement. */
  title: string;
  buyerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  /** Identifiant de la session de paiement (Stripe : cs_…), conservé jusqu'à l'autorisation. */
  providerSessionId: string;
  checkoutUrl: string;
  expiresAt: Date;
}

export interface CheckoutSync {
  /** en_attente : pas encore payé · sequestre : autorisé, capture différée · annulee : session expirée ou paiement annulé */
  status: 'en_attente' | 'sequestre' | 'annulee';
  /** Identifiant du paiement (Stripe : pi_…) dès qu'il existe : remplace l'identifiant de session. */
  providerPaymentId?: string;
  /** URL de la page de paiement tant que la session est ouverte. */
  checkoutUrl?: string;
  /** Date limite de capture de l'autorisation (Stripe : `payment_method_details.card.capture_before` du paiement). */
  captureBefore?: Date;
  /** Autorisation prolongée accordée par le réseau (jusqu'à 30 jours) ; sinon fenêtre standard. */
  extendedAuthorization?: boolean;
}

/** Évènement de webhook normalisé (après vérification de la signature). */
export interface PaymentWebhookEvent {
  id: string;
  type: 'checkout_completed' | 'checkout_expired' | 'payment_canceled' | 'payment_refunded' | 'ignored';
  raw: string;
  providerSessionId?: string;
  providerPaymentId?: string;
  transactionId?: string;
}

export interface IPaymentProvider {
  createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult>;
  capture(providerPaymentId: string): Promise<{ status: 'succeeded' }>;
  refund(providerPaymentId: string): Promise<{ status: 'rembourse' }>;
  /**
   * Paiement hébergé. Quand il est présent, la transaction naît « en_attente », l'acheteur est
   * envoyé sur checkoutUrl, et elle passe « sequestre » au retour (syncCheckout) ou par webhook.
   */
  createCheckout?(params: CreateCheckoutParams): Promise<CheckoutResult>;
  syncCheckout?(providerSessionId: string): Promise<CheckoutSync>;
  /** Vérifie la signature du webhook et normalise l'évènement ; lève une erreur si la signature est invalide. */
  parseWebhook?(rawBody: Buffer, signature: string | undefined): PaymentWebhookEvent;
}
