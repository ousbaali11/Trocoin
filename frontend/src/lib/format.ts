import type { Condition, ListingStatus, PriceType, TransactionStatus } from "./types";

export function formatPrice(price?: number | null, priceType: PriceType = "fixe"): string {
  if (priceType === "gratuit") return "Gratuit";
  if (priceType === "echange") return "Échange";
  if (priceType === "sur_demande") return "Prix sur demande";
  if (price === null || price === undefined) return "Prix non renseigné";
  const formatted = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: Number.isInteger(price) ? 0 : 2 }).format(price);
  return priceType === "negociable" ? `${formatted} à débattre` : formatted;
}

/** Barème du paiement sécurisé (AUDIT §51) : réglé par l'admin, jamais écrit en dur dans les textes. */
export interface FeeRates { commissionPercent: number; buyerFeePercent: number; buyerFeeFixed: number; buyerFeeCap: number }
export const DEFAULT_FEE_RATES: FeeRates = { commissionPercent: 8, buyerFeePercent: 5, buyerFeeFixed: 0.5, buyerFeeCap: 15 };
const frNumber = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n);
/** « 8 % » */
export function formatPercent(n: number): string {
  return `${frNumber(n)} %`;
}
/** « 5 % + 0,50 € (plafonnés à 15 €) » */
export function formatBuyerFeeFormula(r: FeeRates): string {
  const parts = [r.buyerFeePercent > 0 ? formatPercent(r.buyerFeePercent) : "", r.buyerFeeFixed > 0 ? formatEuros(r.buyerFeeFixed) : ""].filter(Boolean);
  return `${parts.join(" + ") || "0 €"} (plafonnés à ${formatEuros(r.buyerFeeCap).replace(",00", "")})`;
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

const PARIS_TZ = "Europe/Paris";
function parisParts(d: Date) {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long", hourCycle: "h23" }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hm: `${get("hour")}:${get("minute")}`, weekday: get("weekday"), date: `${get("day")}/${get("month")}/${get("year")}` };
}

/**
 * Date de dépôt d'une annonce, à la manière de leboncoin : « aujourd'hui à 17:31 », « hier à 09:12 »,
 * « mardi dernier à 17:35 » (moins de sept jours), sinon « 01/09/2026 ».
 * Toujours en heure de Paris, quel que soit le fuseau du serveur : rendu identique en SSR et côté client.
 */
export function postedAt(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const a = parisParts(d);
  const b = parisParts(now);
  const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
  if (days <= 0) return `aujourd'hui à ${a.hm}`;
  if (days === 1) return `hier à ${a.hm}`;
  if (days < 7) return `${a.weekday} dernier à ${a.hm}`;
  return a.date;
}

/** Ancienneté d'une annonce en jours entiers : « aujourd'hui », « hier », « il y a 12 jours », puis la date au-delà de 60 jours. */
export function daysAgo(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days <= 60) return `il y a ${days} jours`;
  return `le ${formatDate(iso)}`;
}

/** +33612345678 → « 06 12 34 56 78 » ; toute autre valeur rendue telle quelle. */
export function formatPhone(phone?: string | null): string {
  if (!phone) return "";
  const national = phone.replace(/^\+33/, "0");
  return /^0\d{9}$/.test(national) ? national.replace(/(\d{2})(?=\d)/g, "$1 ") : phone;
}

/** Numéro de mobile français (06 / 07) sous ses formes courantes ; même règle que l'API (french-phone.ts). */
export function isFrenchMobile(raw: string): boolean {
  const cleaned = raw.replace(/[\s.\-()]/g, "");
  return /^(\+33|0033|33|0)[67]\d{8}$/.test(cleaned);
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
  annulee: { label: "Annulée", pill: "pill", help: "Annulée avant expédition : aucun montant n'est conservé." },
};

export const DELIVERY_LABELS = {
  main_propre: "Remise en main propre",
  colissimo: "Colissimo",
  mondial_relay: "Mondial Relay",
};

export const PICKUP_TYPE_LABELS = {
  relais: "Point relais",
  bureau_poste: "Bureau de poste",
  consigne: "Consigne automatique",
} as const;

/** Libellé complet du mode de remise d'une vente : transporteur et, si l'acheteur l'a choisi, domicile ou point de retrait. */
export function deliveryLabel(tx: { deliveryMethod: keyof typeof DELIVERY_LABELS; deliveryMode?: "domicile" | "point_relais" | null; pickupPoint?: { name: string; city: string; type: keyof typeof PICKUP_TYPE_LABELS } | null }): string {
  if (tx.deliveryMethod === "main_propre") return DELIVERY_LABELS.main_propre;
  const carrier = DELIVERY_LABELS[tx.deliveryMethod];
  if (tx.deliveryMode === "domicile") return `${carrier} à domicile`;
  if (tx.deliveryMode === "point_relais") return tx.pickupPoint ? `${carrier} · ${PICKUP_TYPE_LABELS[tx.pickupPoint.type].toLowerCase()} ${tx.pickupPoint.name} (${tx.pickupPoint.city})` : `${carrier} en point de retrait`;
  // Ventes antérieures au choix par l'acheteur : libellés d'origine
  return tx.deliveryMethod === "colissimo" ? "Colissimo (domicile)" : "Mondial Relay (point relais)";
}

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
