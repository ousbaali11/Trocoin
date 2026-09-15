import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError, mediaUrl, SITE_URL } from "@/lib/api";
import { CONDITION_LABELS, formatDate, formatPrice } from "@/lib/format";
import type { ListingCard as ListingCardType, ListingDetail } from "@/lib/types";
import { ListingCard } from "@/components/ui/ListingCard";
import { ListingActions } from "@/components/listing/ListingActions";
import { PhotoGallery } from "@/components/listing/PhotoGallery";
import { SellerCard } from "@/components/listing/SellerCard";
import { ApproxMapDynamic } from "@/components/ui/DynamicMap";
import styles from "./listing.module.css";

async function getListing(id: string): Promise<ListingDetail | null> {
  try {
    return await api<ListingDetail>(`/listings/${id}`, { token: null, revalidate: 0 });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) return { title: "Annonce introuvable" };
  const desc = listing.description.slice(0, 155);
  return {
    title: `${listing.title} — ${formatPrice(listing.price, listing.priceType)}`,
    description: desc,
    alternates: { canonical: `${SITE_URL}/annonces/${listing.id}` },
    openGraph: { title: listing.title, description: desc, images: listing.photos[0] ? [{ url: mediaUrl(listing.photos[0].url)! }] : [] },
    robots: listing.status === "en_ligne" ? undefined : { index: false },
  };
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) notFound();
  const similar = await api<ListingCardType[]>(`/listings/${id}/similar`, { token: null, revalidate: 120 }).catch(() => []);
  // Autres annonces du même vendeur (comme « Les annonces de ce pro » sur leboncoin)
  const fromSeller = listing.seller && !listing.seller.deleted
    ? await api<{ items: ListingCardType[] }>(`/listings?seller=${listing.seller.id}&page_size=5`, { token: null, revalidate: 120 }).then((r) => r.items.filter((l) => l.id !== listing.id).slice(0, 4)).catch(() => [])
    : [];

  const pageUrl = `${SITE_URL}/annonces/${listing.id}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: listing.title,
      description: listing.description.slice(0, 5000),
      sku: listing.id,
      url: pageUrl,
      image: listing.photos.map((p) => mediaUrl(p.url)),
      ...(listing.category ? { category: listing.category.name } : {}),
      offers: {
        "@type": "Offer",
        url: pageUrl,
        priceCurrency: "EUR",
        price: listing.price ?? 0,
        availability: listing.status === "en_ligne" ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
        itemCondition: listing.condition === "neuf" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
        areaServed: "FR",
        ...(listing.seller ? { seller: { "@type": listing.seller.accountType === "professionnel" ? "Organization" : "Person", name: listing.seller.accountType === "professionnel" && listing.seller.shopName ? listing.seller.shopName : listing.seller.displayName } } : {}),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: SITE_URL },
        ...(listing.rootCategory ? [{ "@type": "ListItem", position: 2, name: listing.rootCategory.name, item: `${SITE_URL}/recherche?category=${listing.rootCategory.slug}` }] : []),
        ...(listing.category && listing.category.id !== listing.rootCategory?.id ? [{ "@type": "ListItem", position: 3, name: listing.category.name, item: `${SITE_URL}/recherche?category=${listing.category.slug}` }] : []),
        { "@type": "ListItem", position: listing.category && listing.category.id !== listing.rootCategory?.id ? 4 : 3, name: listing.title, item: pageUrl },
      ],
    },
  ];

  return (
    <div className="container page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav className="small muted" aria-label="Fil d'Ariane" style={{ marginBottom: 12 }}>
        <Link href="/">Accueil</Link>
        {listing.rootCategory && <> › <Link href={`/recherche?category=${listing.rootCategory.slug}`}>{listing.rootCategory.name}</Link></>}
        {listing.category && listing.category.id !== listing.rootCategory?.id && <> › <Link href={`/recherche?category=${listing.category.slug}`}>{listing.category.name}</Link></>}
      </nav>

      {listing.status !== "en_ligne" && (
        <div className={`alert ${listing.status === "vendue" ? "alert-success" : "alert-info"}`}>
          {listing.status === "vendue" && "Cette annonce a trouvé preneur. Découvrez des annonces similaires ci-dessous."}
          {listing.status === "expiree" && "Cette annonce a expiré."}
          {listing.status === "en_attente" && `Votre annonce est en cours de vérification par notre équipe. ${listing.moderationReason || ""}`}
          {listing.status === "refusee" && `Annonce refusée : ${listing.moderationReason || "non conforme aux règles de diffusion."}`}
          {listing.status === "brouillon" && "Brouillon : cette annonce n'est visible que par vous."}
          {listing.status === "desactivee" && "Annonce en pause : elle n'est visible que par vous."}
        </div>
      )}

      <div className={styles.layout}>
        <div className={styles.main}>
          <PhotoGallery photos={listing.photos} title={listing.title} />

          <div className={styles.head}>
            <h1>{listing.title}</h1>
            <div className={styles.price}>{formatPrice(listing.price, listing.priceType)}</div>
            <div className="row small muted">
              {listing.isUrgent && <span className="pill pill-brick">Urgent</span>}
              {listing.isBoosted && <span className="pill pill-ochre">À la une</span>}
              {listing.completeness?.complete && <span className="pill pill-green" title="Le vendeur a renseigné les photos, une description détaillée et tous les critères de la catégorie">✓ Fiche complète</span>}
              <span>Publiée le {formatDate(listing.publishedAt || listing.createdAt)}</span>
              <span>·</span>
              <span>{listing.city || "France"}{listing.postalCode ? ` (${listing.postalCode})` : ""}</span>
              {listing.deliveryAvailable && <><span>·</span><span className="pill pill-sage">Livraison possible</span></>}
            </div>
          </div>

          {(listing.condition || listing.attributesLabeled.length > 0) && (
            <section className="panel" style={{ marginTop: 20 }}>
              <h2 className="h3">Caractéristiques</h2>
              <dl className={styles.specs}>
                {listing.condition && (
                  <div><dt>État</dt><dd>{CONDITION_LABELS[listing.condition]}</dd></div>
                )}
                {listing.attributesLabeled.map((a) => (
                  <div key={a.key}>
                    <dt>{a.label}</dt>
                    <dd>{typeof a.value === "boolean" ? (a.value ? "Oui" : "Non") : `${a.value}${a.unit ? ` ${a.unit}` : ""}`}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="panel" style={{ marginTop: 20 }}>
            <h2 className="h3">Description</h2>
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{listing.description}</p>
          </section>

          {typeof listing.latitude === "number" && typeof listing.longitude === "number" && (
            <section className="panel" style={{ marginTop: 20 }}>
              <h2 className="h3">Localisation</h2>
              <p className="muted small">Position approximative — l&apos;adresse exacte est convenue par messagerie.</p>
              <ApproxMapDynamic latitude={listing.latitude} longitude={listing.longitude} />
            </section>
          )}
        </div>

        <aside className={styles.side}>
          <ListingActions listing={listing} />
          {listing.seller && <SellerCard seller={listing.seller} />}
          <div className="card small muted">
            <strong style={{ color: "var(--ink)" }}>Conseils de sécurité</strong>
            <ul style={{ paddingLeft: 18, margin: "8px 0 0" }}>
              <li>Ne payez jamais en dehors de Trocoin.</li>
              <li>Privilégiez le paiement sécurisé ou la remise en main propre dans un lieu public.</li>
              <li>Méfiez-vous des prix anormalement bas et des demandes de coordonnées.</li>
            </ul>
            <Link href="/aide/conseils-de-securite" style={{ display: "inline-block", marginTop: 8 }}>Tous nos conseils</Link>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Référence : {listing.id.slice(0, 8)} · {listing.viewsCount} vue{listing.viewsCount > 1 ? "s" : ""} · {listing.favoritesCount} favori{listing.favoritesCount > 1 ? "s" : ""}</p>
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
        <section style={{ marginTop: 48 }}>
          <h2>Annonces similaires</h2>
          <div className="grid-cards">
            {similar.map((l) => <ListingCard key={l.id} listing={l} />)}
          </div>
        </section>
      )}
    </div>
  );
}
