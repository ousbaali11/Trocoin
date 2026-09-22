import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { api, ApiError, mediaUrl, SITE_URL } from "@/lib/api";
import { CONDITION_LABELS, daysAgo, formatDate, formatEuros, formatPrice } from "@/lib/format";
import { buildProductJsonLd, isGoodsListing } from "@/lib/listing-jsonld";
import type { ListingCard as ListingCardType, ListingDetail, PublicProfile } from "@/lib/types";
import { ListingCard } from "@/components/ui/ListingCard";
import { ListingActions } from "@/components/listing/ListingActions";
import { PhotoGallery } from "@/components/listing/PhotoGallery";
import { SellerCard } from "@/components/listing/SellerCard";
import { MarketPosition } from "@/components/listing/MarketPosition";
import { ListingHighlights } from "@/components/listing/ListingHighlights";
import { Equipments, KeyInfo, type KeyInfoItem } from "@/components/listing/KeyInfo";
import { ExpandableText } from "@/components/listing/ExpandableText";
import { ReportListingButton } from "@/components/listing/ReportListingButton";
import { CardCarousel } from "@/components/listing/CardCarousel";
import { ViewedMarker } from "@/components/listing/ViewedMarker";
import { SoldBanner } from "@/components/listing/SoldBanner";
import { ApproxMapDynamic } from "@/components/ui/DynamicMap";
import styles from "./listing.module.css";

/**
 * Une seule lecture de l'annonce par affichage (métadonnées + page partagent le résultat grâce à
 * `cache`) : l'API compte une vue par appel, la fiche ne doit en compter qu'une par chargement.
 */
const getListing = cache(async (id: string): Promise<ListingDetail | null> => {
  try {
    return await api<ListingDetail>(`/listings/${id}`, { token: null, revalidate: 0 });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) return { title: "Annonce introuvable" };
  const desc = listing.description.slice(0, 155);
  // Titre de résultat lisible : les titres d'annonce vont jusqu'à 150 caractères, Google en affiche ~60
  const shortTitle = listing.title.length > 60 ? `${listing.title.slice(0, 57).trimEnd()}…` : listing.title;
  return {
    title: `${shortTitle} — ${formatPrice(listing.price, listing.priceType)}`,
    description: desc,
    alternates: { canonical: `${SITE_URL}/annonces/${listing.id}` },
    openGraph: { title: listing.title, description: desc, images: listing.photos[0] ? [{ url: mediaUrl(listing.photos[0].url)! }] : [] },
    robots: listing.status === "en_ligne" ? undefined : { index: false },
  };
}

/** Repères affichés sous le titre selon la catégorie (comme « année · km · carburant » sur une voiture). */
const SUMMARY_KEYS = ["annee", "kilometrage", "carburant", "boite", "surface", "pieces", "type_bien", "taille", "marque", "modele"];

function formatValue(a: { value: string | number | boolean; unit?: string; key: string }): string {
  if (typeof a.value === "boolean") return a.value ? "Oui" : "Non";
  if (typeof a.value === "number") return `${a.key === "annee" ? String(a.value) : a.value.toLocaleString("fr-FR")}${a.unit ? ` ${a.unit}` : ""}`;
  return `${a.value}${a.unit ? ` ${a.unit}` : ""}`;
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) notFound();
  const sellerAlive = !!listing.seller && !listing.seller.deleted;
  const [similar, fromSeller, profile] = await Promise.all([
    api<ListingCardType[]>(`/listings/${id}/similar`, { token: null, revalidate: 120 }).catch(() => [] as ListingCardType[]),
    // Autres annonces du même vendeur (comme « Les annonces de ce pro » sur leboncoin)
    sellerAlive
      ? api<{ items: ListingCardType[] }>(`/listings?seller=${listing.seller!.id}&page_size=5`, { token: null, revalidate: 120 }).then((r) => r.items.filter((l) => l.id !== listing.id).slice(0, 4)).catch(() => [] as ListingCardType[])
      : Promise.resolve([] as ListingCardType[]),
    // Profil public : taux de réponse et annonces en ligne (repères de confiance réels du bloc vendeur)
    sellerAlive ? api<PublicProfile>(`/users/${listing.seller!.id}/profile`, { token: null, revalidate: 60 }).catch(() => null) : Promise.resolve(null),
  ]);

  const pageUrl = `${SITE_URL}/annonces/${listing.id}`;
  const categorySlug = listing.category?.slug ?? listing.rootCategory?.slug;
  const catParam = categorySlug ? `category=${categorySlug}&` : "";
  // Fil d'Ariane : Accueil › Famille › Catégorie › Région › Département › Ville › Titre
  const crumbs: Array<{ name: string; href?: string }> = [{ name: "Accueil", href: "/" }];
  if (listing.rootCategory) crumbs.push({ name: listing.rootCategory.name, href: `/recherche?category=${listing.rootCategory.slug}` });
  if (listing.category && listing.category.id !== listing.rootCategory?.id) crumbs.push({ name: listing.category.name, href: `/recherche?category=${listing.category.slug}` });
  if (listing.location) {
    crumbs.push({ name: listing.location.region, href: `/recherche?${catParam}region=${listing.location.regionSlug}` });
    crumbs.push({ name: listing.location.department, href: `/recherche?${catParam}postal_code=${listing.location.postalPrefix}` });
  }
  if (listing.city) crumbs.push({ name: listing.city, href: `/recherche?${catParam}city=${encodeURIComponent(listing.city)}` });
  crumbs.push({ name: listing.title });

  const jsonLd = [
    // Product + Offer, avec livraison et politique de retour réelles (AUDIT §52) : lib/listing-jsonld.ts
    buildProductJsonLd(listing, pageUrl, listing.photos.map((p) => mediaUrl(p.url)).filter((u): u is string => !!u)),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.href ? (c.href === "/" ? SITE_URL : `${SITE_URL}${c.href}`) : pageUrl })),
    },
  ];

  // Informations clés (état + critères non booléens) et équipements (options cochées)
  const keyInfo: KeyInfoItem[] = [];
  if (listing.condition) keyInfo.push({ key: "condition", label: "État", value: CONDITION_LABELS[listing.condition] });
  const equipments: string[] = [];
  for (const a of listing.attributesLabeled) {
    if (a.value === true) equipments.push(a.label);
    else keyInfo.push({ key: a.key, label: a.label, value: formatValue(a) });
  }
  const summary = SUMMARY_KEYS.map((k) => listing.attributesLabeled.find((a) => a.key === k)).filter((a): a is NonNullable<typeof a> => !!a && typeof a.value !== "boolean").slice(0, 3);
  const publishedIso = listing.publishedAt || listing.createdAt;
  const isOwner = listing.isOwner;

  return (
    <div className="container page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <ViewedMarker listingId={listing.id} />
      <nav className="small muted" aria-label="Fil d'Ariane">
        <ol className={styles.crumbs}>
          {crumbs.map((c, i) => (
            <li key={`${c.name}-${i}`}>
              {c.href ? <Link href={c.href}>{c.name}</Link> : <span aria-current="page" title={c.name}>{c.name}</span>}
            </li>
          ))}
        </ol>
      </nav>

      {listing.status === "vendue" && <SoldBanner sellerId={listing.userId} />}
      {listing.status !== "en_ligne" && listing.status !== "vendue" && (
        <div className="alert alert-info">
          {listing.status === "expiree" && "Cette annonce a expiré."}
          {listing.status === "en_attente" && `Votre annonce est en cours de vérification par notre équipe. ${listing.moderationReason || ""}`}
          {listing.status === "refusee" && `Annonce refusée : ${listing.moderationReason || "non conforme aux règles de diffusion."}`}
          {listing.status === "brouillon" && "Brouillon : cette annonce n'est visible que par vous."}
          {listing.status === "desactivee" && "Annonce en pause : elle n'est visible que par vous."}
        </div>
      )}

      <div className={styles.layout}>
        <div className={styles.main}>
          <PhotoGallery photos={listing.photos} title={listing.title} listingId={listing.id} favoritesCount={listing.favoritesCount} showActions={!isOwner} />

          <div className={styles.head}>
            {listing.status === "vendue" && <span className="pill pill-dark" data-testid="sold-badge" style={{ marginBottom: 6, display: "inline-block" }}>Vendu</span>}
            <h1>{listing.title}</h1>
            <p className={styles.summary} data-testid="listing-summary">
              <span>{listing.city || "France"}{listing.postalCode ? ` (${listing.postalCode})` : ""}</span>
              {summary.map((a) => <span key={a.key}>{formatValue(a)}</span>)}
            </p>
            <div className={styles.price} data-testid="listing-price">{formatPrice(listing.price, listing.priceType)}</div>
            <div className="row small muted">
              {listing.isUrgent && <span className="pill pill-brick">Urgent</span>}
              {listing.isBoosted && <span className="pill pill-ochre">À la une</span>}
              {listing.completeness?.complete && <span className="pill pill-green" title="Le vendeur a renseigné les photos, une description détaillée et tous les critères de la catégorie">✓ Fiche complète</span>}
              {listing.deliveryAvailable && <span className="pill pill-sage">Livraison possible</span>}
              <span title={`Publiée le ${formatDate(publishedIso, { day: "numeric", month: "long", year: "numeric" })}`} data-testid="published-ago">Publiée {daysAgo(publishedIso)}</span>
            </div>
            <MarketPosition categorySlug={categorySlug} title={listing.title} price={listing.price} priceType={listing.priceType} />
          </div>

          <ListingHighlights listing={listing} />

          {keyInfo.length > 0 && (
            <section className="panel" style={{ marginTop: 20 }}>
              <h2 className="h3">Les informations clés</h2>
              <KeyInfo items={keyInfo} />
            </section>
          )}

          {equipments.length > 0 && (
            <section className="panel" style={{ marginTop: 20 }}>
              <h2 className="h3">Équipements</h2>
              <Equipments items={equipments} />
            </section>
          )}

          <section className="panel" style={{ marginTop: 20 }}>
            <h2 className="h3">Description</h2>
            <ExpandableText text={listing.description} />
          </section>

          {/* Livraison et retours : ce que disent aussi les données structurées (même source, rien d'inventé) */}
          {isGoodsListing(listing) && (
            <section className="panel" style={{ marginTop: 20 }} data-testid="delivery-returns">
              <h2 className="h3">Livraison et retours</h2>
              <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                {listing.delivery?.available ? (
                  <>
                    <li>Livraison possible en France par Colissimo ou Mondial Relay — à domicile, en point relais, en bureau de poste ou en consigne selon votre adresse —, ou remise en main propre.</li>
                    <li>Le vendeur expédie sous {listing.delivery.shipWithinDays} jours après le paiement, puis comptez {listing.delivery.transitDaysMin} à {listing.delivery.transitDaysMax} jours de transport.</li>
                    <li>
                      {listing.delivery.estimate
                        ? `Envoi estimé entre ${formatEuros(listing.delivery.estimate.minCents / 100)} et ${formatEuros(listing.delivery.estimate.maxCents / 100)} d'après le poids déclaré (${new Intl.NumberFormat("fr-FR").format(listing.delivery.estimate.weightGrams)} g), à convenir avec le vendeur.`
                        : "Frais d'envoi à convenir avec le vendeur."}
                    </li>
                  </>
                ) : (
                  <li>Remise en main propre uniquement : ce vendeur n&apos;expédie pas cet article.</li>
                )}
                {listing.seller?.accountType === "professionnel" ? (
                  <li>Vendeur professionnel : ses conditions de retour s&apos;appliquent (droit de rétractation légal de 14 jours pour un achat à distance).</li>
                ) : (
                  <li>Vente entre particuliers : pas de droit de retour ni de rétractation. Avec le paiement sécurisé, vous pouvez ouvrir un litige si l&apos;article n&apos;arrive pas ou n&apos;est pas conforme à l&apos;annonce.</li>
                )}
              </ul>
            </section>
          )}

          {typeof listing.latitude === "number" && typeof listing.longitude === "number" && (
            <section className="panel" style={{ marginTop: 20 }}>
              <h2 className="h3">Localisation</h2>
              <p className="muted small">
                {[listing.city, listing.location?.department, listing.location?.region].filter(Boolean).join(", ")} — position approximative, l&apos;adresse exacte est convenue par messagerie.
              </p>
              <ApproxMapDynamic latitude={listing.latitude} longitude={listing.longitude} />
            </section>
          )}

          <div className={styles.bottomRow}>
            <p className="small muted" style={{ margin: 0 }}>Référence : {listing.id.slice(0, 8)} · {listing.viewsCount} vue{listing.viewsCount > 1 ? "s" : ""} · {listing.favoritesCount} favori{listing.favoritesCount > 1 ? "s" : ""}</p>
            {!isOwner && <ReportListingButton listingId={listing.id} variant="link" label="Signaler l'annonce" />}
          </div>
        </div>

        <aside className={styles.side}>
          <ListingActions listing={listing} />
          {listing.seller && <SellerCard seller={listing.seller} profile={profile} listingId={listing.id} />}
          <div className="card small muted">
            <strong style={{ color: "var(--ink)" }}>Conseils de sécurité</strong>
            <ul style={{ paddingLeft: 18, margin: "8px 0 0" }}>
              <li>Ne payez jamais en dehors de Trocoin.</li>
              <li>Privilégiez le paiement sécurisé ou la remise en main propre dans un lieu public.</li>
              <li>Méfiez-vous des prix anormalement bas et des demandes de coordonnées.</li>
            </ul>
            <Link href="/aide/conseils-de-securite" style={{ display: "inline-block", marginTop: 8 }}>Tous nos conseils</Link>
          </div>
        </aside>
      </div>

      {fromSeller.length > 0 && listing.seller && (
        <section style={{ marginTop: 48 }}>
          <div className="page-head">
            <h2 style={{ margin: 0 }}>{listing.seller.accountType === "professionnel" ? "Les annonces de cette boutique" : "Les autres annonces de ce vendeur"}</h2>
            <Link href={`/vendeurs/${listing.seller.id}`} className="btn btn-outline btn-sm">Tout voir</Link>
          </div>
          <div className="grid-cards">
            {fromSeller.map((l) => <ListingCard key={l.id} listing={l} />)}
          </div>
        </section>
      )}

      {similar.length > 0 && (
        <section style={{ marginTop: 48 }} data-testid="similar">
          <div className="page-head">
            <h2 style={{ margin: 0 }}>Ces annonces peuvent vous intéresser</h2>
            <Link href={categorySlug ? `/recherche?category=${categorySlug}` : "/recherche"} className="btn btn-outline btn-sm">Voir plus d&apos;annonces</Link>
          </div>
          <CardCarousel label="Annonces similaires">
            {similar.map((l) => <ListingCard key={l.id} listing={l} />)}
          </CardCarousel>
        </section>
      )}
    </div>
  );
}
