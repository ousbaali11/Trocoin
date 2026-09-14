export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

/** Durée de vie d'une page de paiement hébergée (minimum Stripe : 30 minutes) ; au-delà, la transaction « en_attente » est annulée. */
export const CHECKOUT_TTL_MINUTES = 30;
