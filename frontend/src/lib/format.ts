import type { Condition, ListingStatus, PriceType, TransactionStatus } from "./types";

export function formatPrice(price?: number | null, priceType: PriceType = "fixe"): string {
  if (priceType === "gratuit") return "Gratuit";
  if (priceType === "echange") return "Échange";
  if (priceType === "sur_demande") return "Prix sur demande";
  if (price === null || price === undefined) return "Prix non renseigné";
  const formatted = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: Number.isInteger(price) ? 0 : 2 }).format(price);
  return priceType === "negociable" ? `${formatted} à débattre` : formatted;
}

export function formatEuros(n?: number | null): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

export function formatDate(iso?: string | null, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("fr-FR", opts).format(new Date(iso));
}

export function formatDateTime(iso?: string | null): string {
  return formatDate(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `il y a ${Math.floor(diff / 86400)} j`;
  return formatDate(iso);
}

export function memberSince(iso?: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date(iso));
}

export const CONDITION_LABELS: Record<Condition, string> = {
  neuf: "Neuf",
  tres_bon_etat: "Très bon état",
  bon_etat: "Bon état",
  etat_satisfaisant: "État satisfaisant",
  pour_pieces: "Pour pièces",
};

export const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  fixe: "Prix fixe",
  negociable: "Prix à débattre",
  gratuit: "Don (gratuit)",
  echange: "Échange",
  sur_demande: "Prix sur demande",
};

export const LISTING_STATUS_LABELS: Record<ListingStatus, { label: string; pill: string }> = {
  brouillon: { label: "Brouillon", pill: "pill" },
  en_attente: { label: "En vérification", pill: "pill pill-ochre" },
  en_ligne: { label: "En ligne", pill: "pill pill-green" },
  vendue: { label: "Vendue", pill: "pill pill-dark" },
  refusee: { label: "Refusée", pill: "pill pill-brick" },
  expiree: { label: "Expirée", pill: "pill" },
  desactivee: { label: "En pause", pill: "pill" },
};

export const TX_STATUS_LABELS: Record<TransactionStatus, { label: string; pill: string; help: string }> = {
  en_attente: { label: "En attente", pill: "pill", help: "Paiement en cours d'autorisation." },
  sequestre: { label: "Fonds bloqués", pill: "pill pill-ochre", help: "Le paiement est sécurisé : le vendeur doit expédier ou organiser la remise." },
  livree: { label: "Expédiée / prête", pill: "pill pill-ochre", help: "En attente de la confirmation de réception par l'acheteur." },
  confirme: { label: "Terminée", pill: "pill pill-green", help: "Réception confirmée, fonds versés au vendeur." },
  litige: { label: "Litige", pill: "pill pill-brick", help: "Un médiateur Trocoin examine le dossier." },
  rembourse: { label: "Remboursée", pill: "pill", help: "L'acheteur a été remboursé." },
  annulee: { label: "Annulée", pill: "pill", help: "Annulée avant expédition, acheteur remboursé." },
};

export const DELIVERY_LABELS = {
  main_propre: "Remise en main propre",
  colissimo: "Colissimo (domicile)",
  mondial_relay: "Mondial Relay (point relais)",
};

export const REPORT_REASON_LABELS: Record<string, string> = {
  arnaque: "Arnaque ou fraude",
  contrefacon: "Contrefaçon",
  objet_interdit: "Objet ou service interdit",
  mauvaise_categorie: "Mauvaise catégorie",
  doublon: "Annonce en double",
  annonce_mensongere: "Annonce mensongère",
  contenu_offensant: "Contenu offensant",
  coordonnees_dans_annonce: "Coordonnées dans l'annonce",
  harcelement: "Harcèlement",
  autre: "Autre",
};

export function pluralize(n: number, singular: string, plural = singular + "s"): string {
  return `${n} ${n > 1 ? plural : singular}`;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
