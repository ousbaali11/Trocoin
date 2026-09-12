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
}

export interface IPaymentProvider {
  createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult>;
  capture(providerPaymentId: string): Promise<{ status: 'succeeded' }>;
  refund(providerPaymentId: string): Promise<{ status: 'rembourse' }>;
}
