import { IShippingProvider, ShippingProviderError } from './shipping-provider.interface';

/**
 * SHIPPING_PROVIDER=none : aucun compte prestataire. Toute demande répond « non configuré »
 * (503 côté API) ; le vendeur continue à saisir son numéro de suivi à la main.
 */
export class UnconfiguredShippingProvider implements IShippingProvider {
  readonly name = 'none';
  private fail(): never {
    throw new ShippingProviderError('none', 'non_configure', "l'impression d'étiquettes n'est pas encore activée : saisissez votre numéro de suivi");
  }
  async quote(): Promise<never> {
    this.fail();
  }
  async searchRelayPoints(): Promise<never> {
    this.fail();
  }
  async createLabel(): Promise<never> {
    this.fail();
  }
  async track(): Promise<never> {
    this.fail();
  }
}
