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
  seller?: { id: string; displayName: string; accountType: AccountType; shopName?: string; identityVerified: boolean };
}

export interface ListingPhoto {
  id: string;
  listingId: string;
  url: string;
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
}

export interface SearchResult {
  items: ListingCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Me {
  id: string;
  phoneNumber: string;
  phoneVerified: boolean;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  companyName?: string | null;
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
  handoverCode?: string;
  disputeReason?: string | null;
  resolutionNote?: string | null;
  shippedAt?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
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
