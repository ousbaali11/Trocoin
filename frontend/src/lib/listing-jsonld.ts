import type { ListingDetail } from "@/lib/types";

/**
 * Données structurées d'une fiche annonce (schema.org Product + Offer), AUDIT §52.
 *
 * Règle : on ne publie que ce qui est vrai et visible sur la page.
 *  - `shippingDetails` : « pas d'expédition » (`doesNotShip`) pour une remise en main propre seule ; pour une annonce
 *    livrable, destination France, délais réels (jours accordés au vendeur pour expédier, transport des transporteurs
 *    proposés) et coût estimé seulement si le vendeur a déclaré le poids du colis.
 *  - `hasMerchantReturnPolicy` : `MerchantReturnNotPermitted` pour une vente entre particuliers ; rien pour un vendeur
 *    professionnel (ses propres conditions et le droit de rétractation légal s'appliquent, Trocoin ne les connaît pas).
 *  - Jamais de `gtin`, `brand`, `review` ni `aggregateRating` : articles d'occasion sans code-barres, réputation par
 *    vendeur et non par article (voir docs/seo-checklist.md). Ne pas les ajouter pour faire taire une alerte.
 */

/** Familles qui ne sont pas des biens matériels : ni livraison ni politique de retour à déclarer. */
export const NON_GOODS_ROOTS = ["immobilier", "emploi", "services", "vacances"];

export function isGoodsListing(listing: Pick<ListingDetail, "rootCategory">): boolean {
  return !listing.rootCategory || !NON_GOODS_ROOTS.includes(listing.rootCategory.slug);
}

const FRANCE = { "@type": "DefinedRegion", addressCountry: "FR" } as const;
const days = (minValue: number, maxValue: number) => ({ "@type": "QuantitativeValue", minValue, maxValue, unitCode: "DAY" });

export function listingShippingDetails(listing: ListingDetail): Record<string, unknown> | null {
  if (!isGoodsListing(listing)) return null;
  const d = listing.delivery;
  if (!d?.available) return { "@type": "OfferShippingDetails", doesNotShip: true, shippingDestination: FRANCE };
  return {
    "@type": "OfferShippingDetails",
    shippingDestination: FRANCE,
    deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime: days(0, d.shipWithinDays), transitTime: days(d.transitDaysMin, d.transitDaysMax) },
    ...(d.estimate ? { shippingRate: { "@type": "MonetaryAmount", currency: "EUR", minValue: d.estimate.minCents / 100, maxValue: d.estimate.maxCents / 100 } } : {}),
  };
}

export function listingReturnPolicy(listing: ListingDetail): Record<string, unknown> | null {
  if (!isGoodsListing(listing) || listing.seller?.accountType !== "particulier") return null;
  return { "@type": "MerchantReturnPolicy", applicableCountry: "FR", returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" };
}

export function buildProductJsonLd(listing: ListingDetail, pageUrl: string, images: string[]): Record<string, unknown> {
  const shippingDetails = listingShippingDetails(listing);
  const returnPolicy = listingReturnPolicy(listing);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: listing.description.slice(0, 5000),
    sku: listing.id,
    url: pageUrl,
    image: images,
    ...(listing.category ? { category: listing.category.name } : {}),
    offers: {
      "@type": "Offer",
      url: pageUrl,
      priceCurrency: "EUR",
      price: listing.price ?? 0,
      availability: listing.status === "en_ligne" ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
      itemCondition: listing.condition === "neuf" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
      areaServed: "FR",
      ...(shippingDetails ? { availableDeliveryMethod: listing.delivery?.available ? ["https://schema.org/OnSitePickup", "https://schema.org/ParcelService"] : "https://schema.org/OnSitePickup", shippingDetails } : {}),
      ...(returnPolicy ? { hasMerchantReturnPolicy: returnPolicy } : {}),
      ...(listing.seller ? { seller: { "@type": listing.seller.accountType === "professionnel" ? "Organization" : "Person", name: listing.seller.accountType === "professionnel" && listing.seller.shopName ? listing.seller.shopName : listing.seller.displayName } } : {}),
    },
  };
}
