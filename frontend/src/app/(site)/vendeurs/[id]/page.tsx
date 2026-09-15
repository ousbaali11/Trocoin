import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api, ApiError, mediaUrl, SITE_URL } from "@/lib/api";
import { formatDate, memberSince } from "@/lib/format";
import type { ListingCard as ListingCardType, PublicProfile, Review, SearchResult } from "@/lib/types";
import { ListingCard } from "@/components/ui/ListingCard";
import { Rating } from "@/components/ui/Rating";
import { BlockButton } from "@/components/listing/BlockButton";
import { ShareMenu } from "@/components/ui/ShareMenu";
import { FilterSection } from "@/components/search/FilterSection";

async function getProfile(id: string): Promise<PublicProfile | null> {
  try {
    return await api<PublicProfile>(`/users/${id}/profile`, { token: null, revalidate: 60 });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = await getProfile(id);
  if (!p) return { title: "Vendeur introuvable" };
  const name = p.accountType === "professionnel" && p.shopName ? p.shopName : p.displayName;
  return { title: `${name} — ${p.activeListingsCount} annonce${p.activeListingsCount > 1 ? "s" : ""}`, description: p.shopDescription || `Annonces de ${name} sur Trocoin.`, alternates: { canonical: `${SITE_URL}/vendeurs/${p.id}` } };
}

/** Profil public d'un vendeur ou vitrine d'un professionnel : identité en tête, puis sections repliables (docs/design-system.md §5). */
export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const [listings, reviews] = await Promise.all([
    api<SearchResult>(`/listings?seller=${id}&page_size=48`, { token: null, revalidate: 60 }).catch(() => ({ items: [] as ListingCardType[], total: 0 })),
    api<Review[]>(`/users/${id}/reviews`, { token: null, revalidate: 60 }).catch(() => []),
  ]);
  const isPro = profile.accountType === "professionnel";
  const name = isPro && profile.shopName ? profile.shopName : profile.displayName;
  const hasShopInfo = isPro && !!(profile.shopDescription || profile.shopAddress || profile.shopHours || profile.shopWebsite);

  return (
    <div className="container page">
      <section className="panel" style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ width: 96, height: 96, borderRadius: isPro ? 16 : "50%", background: "var(--bottle)", color: "var(--white)", display: "grid", placeItems: "center", fontSize: "2rem", fontWeight: 700, overflow: "hidden", flexShrink: 0 }}>
          {profile.shopLogoUrl || profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(profile.shopLogoUrl || profile.avatarUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            name.slice(0, 1).toUpperCase()
          )}
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <p className="eyebrow">{isPro ? "Boutique professionnelle" : "Profil vendeur"}</p>
          <h1 style={{ marginBottom: 6 }}>{name}</h1>
          <div className="row">
            {isPro ? <span className="pill pill-dark">Professionnel</span> : <span className="pill">Particulier</span>}
            {profile.identityVerified && <span className="pill pill-green">Identité vérifiée</span>}
          </div>
          <div style={{ margin: "10px 0" }}><Rating value={profile.ratingAvg} count={profile.ratingCount} size={16} /></div>
          <p className="muted small" style={{ margin: 0 }}>
            Membre depuis {memberSince(profile.createdAt)}
            {profile.city && ` · ${profile.city}`}
            {profile.responseRate !== null && ` · Répond à ${profile.responseRate} % des messages`}
            {` · ${profile.activeListingsCount} annonce${profile.activeListingsCount > 1 ? "s" : ""} en ligne`}
          </p>
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <ShareMenu url={`${SITE_URL}/vendeurs/${profile.id}`} title={`${name} sur Trocoin`} text={isPro ? "Découvrez cette boutique" : "Découvrez ce vendeur"} compact />
          <BlockButton userId={profile.id} />
        </div>
      </section>

      <div style={{ marginTop: 28 }}>
        {/* La section la plus utile (les annonces) est ouverte d'emblée ; les autres se déplient à la demande, état mémorisé pour la session */}
        <FilterSection id="annonces" title={`Annonces en ligne (${listings.total})`} defaultOpen storageKey="trocoin_profile_sections" size="lg">
          {listings.items.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Aucune annonce en ligne pour le moment.</p>
          ) : (
            <div className="grid-cards">{listings.items.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
          )}
        </FilterSection>

        {hasShopInfo && (
          <FilterSection id="boutique" title="Informations de la boutique" storageKey="trocoin_profile_sections" size="lg">
            {profile.shopDescription && <p style={{ marginTop: 0, whiteSpace: "pre-wrap" }}>{profile.shopDescription}</p>}
            {(profile.shopAddress || profile.shopHours || profile.shopWebsite) && (
              <dl className="small" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0 }}>
                {profile.shopAddress && <><dt className="muted">Adresse</dt><dd style={{ margin: 0 }}>{profile.shopAddress}</dd></>}
                {profile.shopHours && <><dt className="muted">Horaires</dt><dd style={{ margin: 0 }}>{profile.shopHours}</dd></>}
                {profile.shopWebsite && <><dt className="muted">Site web</dt><dd style={{ margin: 0 }}><a href={profile.shopWebsite} rel="nofollow noopener" target="_blank">{profile.shopWebsite}</a></dd></>}
              </dl>
            )}
          </FilterSection>
        )}

        <FilterSection id="avis" title={`Avis reçus (${reviews.length})`} storageKey="trocoin_profile_sections" size="lg">
          {reviews.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Pas encore d&apos;avis. Les avis sont laissés après une transaction sécurisée confirmée.</p>
          ) : (
            <div className="stack">
              {reviews.map((r) => (
                <div key={r.id} className="card">
                  <div className="row spread">
                    <strong>{r.reviewer?.displayName || "Membre"}</strong>
                    <span className="small muted">{formatDate(r.createdAt)}</span>
                  </div>
                  <Rating value={r.rating} />
                  {r.comment && <p style={{ margin: "8px 0 0" }}>{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </FilterSection>
      </div>
    </div>
  );
}
