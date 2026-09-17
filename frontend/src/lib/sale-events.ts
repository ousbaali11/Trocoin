import { DELIVERY_LABELS, formatDateTime, formatEuros } from "@/lib/format";
import type { Message } from "@/lib/types";

/**
 * Messages automatiques de suivi de vente (AUDIT §57) : le serveur inscrit l'étape dans la conversation, le site
 * compose le texte selon le lecteur (acheteur ou vendeur). Aucun de ces textes n'est écrit par une personne.
 * Textes volontairement COURTS (AUDIT §60) : un titre, une phrase ; le détail vit dans « Détails de la vente ».
 */
export interface SaleEventText {
  icon: string;
  title: string;
  body: string;
  /** Lien de suivi du transporteur, quand l'étape en porte un. */
  trackingUrl?: string;
}

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function saleEventText(m: Message, role: "acheteur" | "vendeur", otherName: string): SaleEventText {
  const meta = m.meta ?? {};
  const buyer = role === "acheteur";
  const handDelivery = meta.deliveryMethod === "main_propre";
  const payout = num(meta.payout);
  const paidOut = meta.transferred !== 0;
  const amount = payout ? ` de ${formatEuros(payout)}` : "";
  switch (m.systemEvent) {
    case "achat_confirme": {
      const negotiated = num(meta.listPrice) ? " (prix négocié)" : "";
      return buyer
        ? { icon: "✅", title: "Achat confirmé", body: `${formatEuros(num(meta.amount))} payés${negotiated}, conservés par Trocoin. Vous suivrez ${handDelivery ? "la remise" : "le colis"} ici.` }
        : { icon: "🛒", title: "Nouvelle vente", body: `${otherName} a payé ${formatEuros(num(meta.price))}${negotiated}. Confirmez que l'article est disponible.` };
    }
    case "disponibilite_confirmee":
      return buyer
        ? { icon: "👍", title: "Article disponible", body: handDelivery ? "Convenez du rendez-vous ici." : "Le vendeur prépare l'envoi." }
        : { icon: "👍", title: "Disponibilité confirmée", body: "L'acheteur est prévenu." };
    case "etiquette_generee": {
      const tracking = str(meta.trackingNumber);
      return buyer
        ? { icon: "🏷️", title: "Bon d'envoi généré", body: tracking ? `Votre numéro de suivi : ${tracking}` : "Le vendeur va déposer le colis.", trackingUrl: str(meta.trackingUrl) }
        : { icon: "🏷️", title: "Bon d'envoi prêt", body: "Imprimez-le, collez-le sur le colis, déposez-le, puis confirmez l'expédition." };
    }
    case "expedie": {
      const tracking = str(meta.trackingNumber);
      const until = str(meta.autoConfirmAt);
      const carrier = meta.carrier === "colissimo" || meta.carrier === "mondial_relay" ? DELIVERY_LABELS[meta.carrier] : "transporteur";
      return buyer
        ? { icon: "📦", title: "Colis expédié", body: `${carrier}${tracking ? ` · suivi ${tracking}` : ""}. Confirmez la réception à l'arrivée${until ? ` (acquise d'office le ${formatDateTime(until)})` : ""}.`, trackingUrl: str(meta.trackingUrl) }
        : { icon: "📦", title: "Colis expédié", body: `${tracking ? `Suivi ${tracking}. ` : ""}Vous serez payé dès la réception confirmée.`, trackingUrl: str(meta.trackingUrl) };
    }
    case "pret_pour_remise":
      return buyer
        ? { icon: "🤝", title: "Vendeur prêt pour la remise", body: "Une fois l'objet en main, donnez-lui votre code de remise." }
        : { icon: "🤝", title: "Prêt pour la remise", body: "Au rendez-vous, saisissez le code que l'acheteur vous donne." };
    case "reception_confirmee":
      return buyer
        ? { icon: "🎉", title: "Réception confirmée", body: "Le vendeur est payé. Pensez à laisser un avis." }
        : { icon: "🎉", title: "Réception confirmée", body: paidOut ? `Virement${amount} déclenché. Annonce retirée.` : `Virement${amount} en attente : configurez « Mes paiements ».` };
    case "remise_validee":
      return buyer
        ? { icon: "🎉", title: "Remise validée", body: "Vente terminée. Pensez à laisser un avis." }
        : { icon: "🎉", title: "Remise validée", body: paidOut ? `Virement${amount} déclenché. Annonce retirée.` : `Virement${amount} en attente : configurez « Mes paiements ».` };
    case "reception_presumee":
      return buyer
        ? { icon: "⏱️", title: "Réception considérée acquise", body: "Le vendeur est payé. Un litige reste possible quelques jours." }
        : { icon: "⏱️", title: "Réception considérée acquise", body: `Virement${amount} déclenché.` };
    case "vente_annulee": {
      const by = meta.by === "delai" ? "Délai dépassé" : meta.by === "vendeur" ? (buyer ? "Annulée par le vendeur" : "Vous avez annulé") : buyer ? "Vous avez annulé" : "Annulée par l'acheteur";
      return { icon: "↩️", title: "Vente annulée", body: buyer ? `${by}. Vous êtes intégralement remboursé.` : `${by}. Acheteur remboursé ; remettez l'annonce en ligne si l'article est toujours à vendre.` };
    }
    case "litige_ouvert":
      return { icon: "⚠️", title: "Litige ouvert", body: "Un médiateur Trocoin examine le dossier ; les fonds restent bloqués." };
    case "litige_resolu":
      return { icon: "⚖️", title: "Litige clos", body: meta.decision === "rembourser" ? "L'acheteur est remboursé." : "Les fonds sont versés au vendeur." };
    default:
      return { icon: "ℹ️", title: "Suivi de la vente", body: m.content ?? "" };
  }
}
