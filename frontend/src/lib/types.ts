export type AccountType = "particulier" | "professionnel" | "admin";
export type ListingStatus = "brouillon" | "en_attente" | "en_ligne" | "vendue" | "refusee" | "expiree" | "desactivee";
export type PriceType = "fixe" | "negociable" | "gratuit" | "echange" | "sur_demande";
export type Condition = "neuf" | "tres_bon_etat" | "bon_etat" | "etat_satisfaisant" | "pour_pieces";
export type TransactionStatus = "en_attente" | "sequestre" | "livree" | "confirme" | "litige" | "rembourse" | "annulee";

export interface Category {
  id: number;
  parentId?: number | null;
  slug: string;
  name: string;
  icon?: string;
  sortOrder: number;
}
export interface CategoryNode extends Category {
  children: Category[];
}
export interface FieldSchema {
  key: string;
  label: string;
  type: "select" | "number" | "text" | "boolean";
  required?: boolean;
  options?: string[];
  unit?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  filterable?: boolean;
  /** Liste dépendante : options = optionsByParent[valeur du champ dependsOn] (ex. modèles d'une marque). */
  dependsOn?: string;
  optionsByParent?: Record<string, string[]>;
}

/** Options d'un champ select, en tenant compte d'une liste dépendante (modèles filtrés par la marque choisie). */
export function fieldOptions(field: FieldSchema, values: Record<string, unknown>): string[] {
  if (!field.dependsOn || !field.optionsByParent) return field.options ?? [];
  const parent = values[field.dependsOn];
  if (typeof parent === "string" && field.optionsByParent[parent]) return field.optionsByParent[parent];
  return [];
}

export interface SellerSummary {
  id: string;
  displayName: string;
  avatarUrl?: string;
  accountType: AccountType;
  city?: string;
  shopName?: string;
  ratingAvg: number;
  ratingCount: number;
  identityVerified: boolean;
  createdAt: string;
  deleted?: boolean;
}

export interface ListingCard {
  id: string;
  /** Badge « Fiche complète » (3 photos, description longue, tous les critères) */
  isComplete?: boolean;
  userId: string;
  categoryId: number;
  rootCategoryId?: number;
  title: string;
  description: string;
  price?: number | null;
  priceType: PriceType;
  condition?: Condition | null;
  status: ListingStatus;
  moderationReason?: string | null;
  attributes?: Record<string, string | number | boolean> | null;
  city?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  deliveryAvailable: boolean;
  /** Colis déclaré au dépôt (facultatif) : grammes et centimètres. */
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  viewsCount: number;
  publishedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  coverUrl: string | null;
  photosCount: number;
  categorySlug?: string;
  categoryName?: string;
  distanceKm?: number;
  isBoosted: boolean;
  isUrgent: boolean;
  boostedUntil?: string | null;
  urgentUntil?: string | null;
  externalRef?: string | null;
  shopOwnerId?: string;
  createdBy?: string | null;
  seller?: { id: string; displayName: string; accountType: AccountType; shopName?: string; identityVerified: boolean; ratingAvg?: number; ratingCount?: number };
  /** Présent uniquement sur « Mes annonces » */
  stats?: ListingStats;
}

export interface ListingPhoto {
  id: string;
  listingId: string;
  url: string;
  /** Vignette 480 px (listes, miniatures) ; absente pour les photos antérieures */
  thumbUrl?: string | null;
  sortOrder: number;
}

export interface ListingDetail extends Omit<ListingCard, "coverUrl" | "photosCount" | "seller" | "isBoosted" | "isUrgent"> {
  photos: ListingPhoto[];
  category: { id: number; slug: string; name: string } | null;
  rootCategory: { id: number; slug: string; name: string } | null;
  seller: SellerSummary | null;
  favoritesCount: number;
  completeness?: { complete: boolean; score: number; missing: string[] };
  attributesLabeled: Array<{ key: string; label: string; value: string | number | boolean; unit?: string }>;
  isOwner: boolean;
  isBoosted: boolean;
  isUrgent: boolean;
  /** Région et département dérivés du code postal (fil d'Ariane) ; `postalPrefix` sert au filtre `postal_code=` */
  location?: { departmentCode: string; department: string; postalPrefix: string; region: string; regionSlug: string } | null;
  /** Bouton « Voir le numéro » proposé (vendeur avec numéro visible) ; le numéro vient de POST /listings/:id/phone */
  phoneAvailable?: boolean;
}

/** Statistiques d'une annonce, vues du propriétaire seul (GET /listings/mine). */
export interface ListingStats {
  views: number;
  favorites: number;
  messages: number;
  phoneClicks: number;
}

export interface SearchResult {
  items: ListingCard[];
  total: number;
  page: number;
  pageSize: number;
}

export type NotificationChannelPrefs = { push: boolean; sms: boolean; email: boolean };
export interface NotificationPrefs {
  message: NotificationChannelPrefs;
  transaction: NotificationChannelPrefs;
  alerte_recherche: NotificationChannelPrefs;
  moderation: NotificationChannelPrefs;
  systeme: NotificationChannelPrefs;
}

export interface Me {
  id: string;
  phoneNumber: string;
  phoneVerified: boolean;
  /** Numéro proposé sur les annonces (« Voir le numéro ») ; réglable au dépôt et dans les paramètres */
  phonePublic?: boolean;
  email?: string | null;
  /** Adresse confirmée via le lien reçu par e-mail. */
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
  /** Double authentification (application d'authentification) activée. */
  twoFactorEnabled?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  companyName?: string | null;
  siretVerified?: boolean;
  siretVerifiedAt?: string | null;
  displayName: string;
  avatarUrl?: string | null;
  accountType: AccountType;
  city?: string | null;
  postalCode?: string | null;
  shopName?: string | null;
  shopDescription?: string | null;
  shopLogoUrl?: string | null;
  shopAddress?: string | null;
  shopHours?: string | null;
  shopWebsite?: string | null;
  siret?: string | null;
  stripeConnected: boolean;
  stripeOnboardingComplete: boolean;
  ratingAvg: number;
  ratingCount: number;
  identityVerified: boolean;
  notifyPush: boolean;
  notifySms: boolean;
  /** Préférences effectives par famille d'évènement et canal (voir Paramètres → Notifications). */
  notificationPrefs?: NotificationPrefs;
  /** Dernières localisations utilisées (5 au plus), partagées entre appareils. */
  recentLocations?: Array<{ city: string; postalCode?: string; latitude?: number; longitude?: number }>;
  createdAt: string;
  suspendedAt?: string | null;
}

export interface PublicProfile {
  id: string;
  displayName: string;
  avatarUrl?: string;
  accountType: AccountType;
  city?: string;
  shopName?: string;
  shopDescription?: string;
  shopLogoUrl?: string;
  shopAddress?: string;
  shopHours?: string;
  shopWebsite?: string;
  ratingAvg: number;
  ratingCount: number;
  identityVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
  activeListingsCount: number;
  responseRate: number | null;
}

export interface Review {
  id: string;
  transactionId: string;
  reviewerId: string;
  reviewedId: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
  reviewer?: SellerSummary | null;
  reviewed?: SellerSummary | null;
}

export interface ConversationSummary {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  lastMessageAt?: string | null;
  createdAt: string;
  role: "acheteur" | "vendeur";
  other: SellerSummary | null;
  listing: { id: string; title: string; price?: number | null; priceType: PriceType; status: ListingStatus; coverUrl: string | null; userId?: string } | null;
  lastMessage: { content?: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
}
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  type: "text" | "image" | "offer";
  content?: string;
  attachmentUrl?: string | null;
  offerAmount?: number | null;
  offerStatus?: "en_attente" | "acceptee" | "refusee" | "retiree" | null;
  readAt?: string | null;
  createdAt: string;
}
export interface ConversationDetail extends Omit<ConversationSummary, "lastMessage" | "unreadCount"> {
  messages: Message[];
  blocked: boolean;
  quickReplies: string[];
}

export interface Quote {
  eligible: boolean;
  reason?: string;
  isOwner: boolean;
  deliveryAvailable: boolean;
  price?: number;
  commission?: number;
  buyerFee?: number;
  buyerTotal?: number;
  sellerPayout?: number;
}

export interface Transaction {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  commission: number;
  buyerFee: number;
  status: TransactionStatus;
  deliveryMethod: "main_propre" | "colissimo" | "mondial_relay";
  deliveryTrackingNumber?: string | null;
  /** Adresse de livraison saisie par l'acheteur au paiement (envoi) ; visible des deux parties seulement. */
  shippingAddress?: DeliveryAddress | null;
  handoverCode?: string;
  disputeReason?: string | null;
  resolutionNote?: string | null;
  shippedAt?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
  /** Échéances du séquestre : autorisation bancaire limitée dans le temps (AUDIT §37). */
  paidAt?: string | null;
  captureBefore?: string | null;
  /** Réception présumée : sans action de l'acheteur à cette date, le vendeur est payé. */
  autoConfirmAt?: string | null;
  autoResolution?: "reception_presumee" | "capture_echeance" | "annulation_echeance" | null;
  /** Après une capture automatique, litige encore possible jusqu'à cette date. */
  disputeAllowedUntil?: string | null;
  /** Paiement hébergé (Stripe Checkout) encore ouvert : URL pour reprendre le paiement (acheteur, statut en_attente). */
  checkoutUrl?: string;
  role?: "acheteur" | "vendeur";
  other?: SellerSummary | null;
  listing?: { id: string; title: string; price?: number | null; status: ListingStatus } | null;
  quote?: Quote;
}

export interface Notification {
  id: string;
  type: "message" | "transaction" | "alerte_recherche" | "moderation" | "systeme";
  title: string;
  body?: string | null;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: Record<string, unknown>;
  notifyPush: boolean;
  notifySms: boolean;
  matchesNotified: number;
  createdAt: string;
}

export interface Report {
  id: string;
  reporterId: string;
  listingId?: string | null;
  reportedUserId?: string | null;
  conversationId?: string | null;
  reason: string;
  details?: string | null;
  status: "ouvert" | "traite" | "rejete";
  resolutionNote?: string | null;
  createdAt: string;
  reporter?: { id: string; displayName: string } | null;
  reportedUser?: { id: string; displayName: string; suspended: boolean } | null;
  listing?: { id: string; title: string; status: ListingStatus } | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ----- Phase 2 -----
export interface Plan {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  priceMonthly: number;
  listingsIncluded?: number | null;
  boostsIncluded?: number | null;
  advancedStats: boolean;
  verifiedBadge: boolean;
  customShop: boolean;
  active: boolean;
  sortOrder: number;
}
export interface Entitlements {
  monetizationEnabled: boolean;
  plan: Plan | null;
  listingsLimit: number | null;
  boostsLimit: number | null;
  boostPrice: number;
  urgentPrice: number;
  advancedStats: boolean;
  subscription: { id: string; status: string; startedAt: string; endsAt?: string | null; provider?: string } | null;
}
export interface PublicSettings {
  monetizationEnabled: boolean;
  boostPrice: number;
  urgentPrice: number;
  freeListingsPer30Days: number;
}
export interface LegalPage {
  slug: string;
  title: string;
  content: string;
  published: boolean;
  updatedAt: string;
}
export interface ShopMember {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; displayName: string; phoneMasked: string } | null;
}
export interface ManagedShop {
  ownerId: string;
  shopName: string;
  role: string;
}
export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  pending: number;
  errors: Array<{ line: number; reference?: string; error: string }>;
}

/** GET /listings/price-estimate : prix moyen constaté (médiane, quartiles) */
export interface PriceEstimate {
  count: number;
  median: number | null;
  low: number | null;
  high: number | null;
  basis: "mots" | "categorie" | null;
}

/** Adresse postale complète pour un envoi (acheteur au paiement, expéditeur à l'étiquette). */
export interface DeliveryAddress {
  name: string;
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  phone?: string;
  email?: string;
}

export type ShippingMode = "domicile" | "point_relais";
export type ShipmentStatus = "en_creation" | "etiquette_prete" | "expediee" | "livree" | "echec";

export interface ShippingRate {
  carrier: "colissimo" | "mondial_relay";
  mode: ShippingMode;
  priceCents: number;
  deliveryDays: number;
  offerCode: string;
  label: string;
}

export interface RelayPoint {
  id: string;
  name: string;
  line1: string;
  postalCode: string;
  city: string;
  hours?: string;
  distanceMeters?: number;
}

export interface Shipment {
  id: string;
  transactionId: string;
  provider: string;
  carrier: "colissimo" | "mondial_relay";
  mode: ShippingMode;
  status: ShipmentStatus;
  weightGrams: number;
  sender: DeliveryAddress;
  recipient: DeliveryAddress;
  relayPointId?: string | null;
  priceCents?: number | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  labelAvailable: boolean;
  error?: string | null;
  createdAt: string;
}

export interface TrackingInfo {
  state: "etiquette_creee" | "pris_en_charge" | "en_transit" | "disponible_en_relais" | "livre" | "incident";
  events: Array<{ at: string; label: string; location?: string }>;
  trackingNumber: string;
  trackingUrl?: string;
}
