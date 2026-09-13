export interface ISmsProvider {
  send(toFrenchE164: string, message: string): Promise<void>;
}

/** Erreur d'envoi typée : le service OTP annule proprement la demande de code. */
export class SmsDeliveryError extends Error {
  constructor(public readonly provider: string, public readonly reason: string) {
    super(`SMS non envoyé (${provider}) : ${reason}`);
  }
}
