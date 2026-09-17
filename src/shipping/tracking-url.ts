/** Page publique de suivi du transporteur pour un numéro de colis (lien « Suivre le colis »). */
export function carrierTrackingUrl(carrier: string, trackingNumber: string): string | null {
  const n = encodeURIComponent(trackingNumber.trim());
  if (!n) return null;
  if (carrier === 'colissimo') return `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`;
  if (carrier === 'mondial_relay') return `https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${n}`;
  return null;
}
