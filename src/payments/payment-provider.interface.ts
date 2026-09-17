export interface CreatePaymentIntentParams {
  /** Montant total débité à l'acheteur (prix + frais acheteur). */
  amountEuros: number;
  /** Part conservée par la plateforme (commission vendeur + frais acheteur). */
  applicationFeeEuros: number;
  /**
   * Ancien modèle « destination charge » : les fonds partent chez le vendeur à la capture. Absent
   * (modèle « platform », AUDIT §39) : la charge reste sur le solde de la plateforme et le vendeur est
   * payé plus tard par `transfer`.
   */
  sellerConnectedAccountId?: string;
  /** Modèle platform : identifiant qui relie la charge et le transfert ultérieur (Stripe `transfer_group`). */
  transferGroup?: string;
  metadata: Record<string, string>;
}

/** Modèle platform : virement du solde de la plateforme vers le compte du vendeur, à la confirmation. */
export interface TransferParams {
  providerPaymentId: string;
  sellerConnectedAccountId: string;
  /** Montant net versé au vendeur (prix moins commission). */
  amountEuros: number;
  transactionId: string;
  description?: string;
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
  /** Détail du total (AUDIT §51) : prix de l'article et frais de protection, affichés sur deux lignes de la page de paiement. */
  priceEuros?: number;
  feeEuros?: number;
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
  /** Moyen de paiement utilisé par l'acheteur (Stripe : `card`, `paypal`, …) ; inconnu si le fournisseur ne le dit pas. */
  paymentMethodType?: string;
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
  /** Encaisse l'autorisation (modèle platform : sur le solde de la plateforme ; destination : versé au vendeur). */
  capture(providerPaymentId: string): Promise<{ status: 'succeeded' }>;
  /** Annule l'autorisation si elle n'est pas capturée, sinon rembourse l'acheteur (modèle destination : avec annulation du transfert). */
  refund(providerPaymentId: string): Promise<{ status: 'rembourse' }>;
  /** Modèle platform : paie le vendeur depuis le solde de la plateforme (Stripe Transfer, rattaché à la charge d'origine). */
  transfer(params: TransferParams): Promise<{ transferId: string }>;
  /** Modèle platform : annule un transfert déjà fait (remboursement après versement) ; le compte du vendeur est débité. */
  reverseTransfer(transferId: string): Promise<void>;
  /**
   * Paiement hébergé. Quand il est présent, la transaction naît « en_attente », l'acheteur est
   * envoyé sur checkoutUrl, et elle passe « sequestre » au retour (syncCheckout) ou par webhook.
   */
  createCheckout?(params: CreateCheckoutParams): Promise<CheckoutResult>;
  syncCheckout?(providerSessionId: string): Promise<CheckoutSync>;
  /** Vérifie la signature du webhook et normalise l'évènement ; lève une erreur si la signature est invalide. */
  parseWebhook?(rawBody: Buffer, signature: string | undefined): PaymentWebhookEvent;
}
