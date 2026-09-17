import { DELIVERY_LABELS, formatDateTime, formatEuros } from "@/lib/format";
import type { Message } from "@/lib/types";

/**
 * Messages automatiques de suivi de vente (AUDIT §57) : le serveur inscrit l'étape dans la conversation, le site
 * compose le texte selon le lecteur (acheteur ou vendeur). Aucun de ces textes n'est écrit par une personne.
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
  switch (m.systemEvent) {
    case "achat_confirme": {
      const pickup = str(meta.pickupPoint);
      const carrier = meta.deliveryMethod === "colissimo" || meta.deliveryMethod === "mondial_relay" ? DELIVERY_LABELS[meta.deliveryMethod] : null;
      const where = handDelivery ? "Remise en main propre." : pickup ? `Retrait choisi : ${pickup} (${carrier}).` : meta.deliveryMode === "domicile" ? `Livraison à domicile par ${carrier}.` : carrier ? `Envoi par ${carrier}.` : "";
      return buyer
        ? { icon: "✅", title: "Achat confirmé", body: `Votre paiement de ${formatEuros(num(meta.amount))} est sécurisé : Trocoin le conserve jusqu'à ce que vous confirmiez la réception. Vous recevrez ici, dans cette conversation, les mises à jour sur l'avancement ${handDelivery ? "de la remise" : "du colis"}. ${where}`.trim() }
        : { icon: "🛒", title: "Nouvelle vente", body: `${otherName} a acheté votre article (${formatEuros(num(meta.price))}) ; le paiement est conservé par Trocoin. Confirmez que l'article est disponible, puis ${handDelivery ? "convenez du rendez-vous" : "expédiez-le"}. ${where}`.trim() };
    }
    case "disponibilite_confirmee":
      return buyer
        ? { icon: "👍", title: "Article disponible", body: "Le vendeur a confirmé que l'article est disponible et prêt à partir." }
        : { icon: "👍", title: "Disponibilité confirmée", body: "Vous avez confirmé que l'article est disponible : l'acheteur est prévenu." };
    case "expedie": {
      const tracking = str(meta.trackingNumber);
      const until = str(meta.autoConfirmAt);
      const carrier = meta.carrier === "colissimo" || meta.carrier === "mondial_relay" ? DELIVERY_LABELS[meta.carrier] : "le transporteur";
      return buyer
        ? { icon: "📦", title: "Colis expédié", body: `Le vendeur a confié votre colis à ${carrier}.${tracking ? ` Numéro de suivi : ${tracking}.` : ""} À réception, confirmez-la ici pour que le vendeur soit payé${until ? ` (sans nouvelle de votre part, elle sera considérée acquise le ${formatDateTime(until)})` : ""}.`, trackingUrl: str(meta.trackingUrl) }
        : { icon: "📦", title: "Colis expédié", body: `Vous avez déclaré l'expédition${tracking ? ` (suivi ${tracking})` : ""}. Vous serez payé dès que l'acheteur aura confirmé la réception.`, trackingUrl: str(meta.trackingUrl) };
    }
    case "pret_pour_remise":
      return buyer
        ? { icon: "🤝", title: "Vendeur prêt pour la remise", body: "Convenez du rendez-vous ici. Au moment de la remise, une fois l'objet en main, donnez votre code de remise au vendeur (il se trouve dans « Achats et ventes »)." }
        : { icon: "🤝", title: "Prêt pour la remise", body: "Vous avez indiqué être prêt. Au rendez-vous, saisissez le code à 6 chiffres que l'acheteur vous donne pour être payé." };
    case "reception_confirmee":
      return buyer
        ? { icon: "🎉", title: "Réception confirmée", body: "Vous avez confirmé avoir bien reçu l'article : le vendeur est payé. Merci ! Pensez à laisser un avis." }
        : { icon: "🎉", title: "Réception confirmée par l'acheteur", body: paidOut ? `${otherName} a confirmé avoir bien reçu le colis : le virement${payout ? ` de ${formatEuros(payout)}` : ""} vers votre compte de versement est déclenché. La vente est terminée : votre annonce a été supprimée automatiquement.` : `${otherName} a confirmé avoir bien reçu le colis. Votre annonce a été supprimée automatiquement. Le virement${payout ? ` de ${formatEuros(payout)}` : ""} attend votre compte de versement : configurez-le dans « Mes paiements » pour recevoir les fonds.` };
    case "remise_validee":
      return buyer
        ? { icon: "🎉", title: "Remise validée", body: "Le vendeur a saisi votre code de remise : la vente est terminée. Pensez à laisser un avis." }
        : { icon: "🎉", title: "Remise validée", body: paidOut ? `Code de remise accepté : le virement${payout ? ` de ${formatEuros(payout)}` : ""} vers votre compte de versement est déclenché.` : "Code de remise accepté. Le virement attend votre compte de versement : configurez-le dans « Mes paiements »." };
    case "reception_presumee":
      return buyer
        ? { icon: "⏱️", title: "Réception considérée acquise", body: "Sans confirmation ni signalement dans le délai, la réception est considérée acquise et le vendeur est payé. Un problème ? Vous pouvez encore ouvrir un litige depuis « Achats et ventes »." }
        : { icon: "⏱️", title: "Réception considérée acquise", body: `L'acheteur n'a rien signalé dans le délai : la vente est confirmée${payout ? ` et le virement de ${formatEuros(payout)} est déclenché` : ""}.` };
    case "vente_annulee": {
      const by = meta.by === "delai" ? "Le délai d'expédition est dépassé" : meta.by === "vendeur" ? (buyer ? "Le vendeur a annulé la vente" : "Vous avez annulé la vente") : buyer ? "Vous avez annulé votre achat" : "L'acheteur a annulé son achat";
      return { icon: "↩️", title: "Vente annulée", body: `${by} : ${buyer ? "vous êtes intégralement remboursé, frais compris" : "l'acheteur est intégralement remboursé. Votre annonce est restée marquée « Vendue » : remettez-la en ligne d'un clic si l'article est toujours à vendre"}.` };
    }
    case "litige_ouvert":
      return { icon: "⚠️", title: "Litige ouvert", body: "Un médiateur Trocoin examine le dossier ; les fonds restent bloqués jusqu'à sa décision. Vous pouvez continuer à échanger ici pour trouver un accord." };
    case "litige_resolu":
      return { icon: "⚖️", title: "Litige clos", body: meta.decision === "rembourser" ? "Décision du médiateur : l'acheteur est remboursé." : "Décision du médiateur : les fonds sont versés au vendeur." };
    default:
      return { icon: "ℹ️", title: "Suivi de la vente", body: m.content ?? "" };
  }
}
