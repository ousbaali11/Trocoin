import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api, ApiError, mediaUrl } from "@/lib/api";
import { formatDate, memberSince } from "@/lib/format";
import type { PublicProfile, Review, SearchResult } from "@/lib/types";
import { ListingCard } from "@/components/ui/ListingCard";
import { Rating } from "@/components/ui/Rating";
import { BlockButton } from "@/components/listing/BlockButton";
import { ShareMenu } from "@/components/ui/ShareMenu";
import { SITE_URL } from "@/lib/api";

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
  return { title: `${name} — ${p.activeListingsCount} annonce${p.activeListingsCount > 1 ? "s" : ""}`, description: p.shopDescription || `Annonces de ${name} sur Trocoin.` };
}

export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const [listings, reviews] = await Promise.all([
    api<SearchResult>(`/listings?seller=${id}&page_size=48`, { token: null, revalidate: 60 }).catch(() => ({ items: [], total: 0, page: 1, pageSize: 48 })),
    api<Review[]>(`/users/${id}/reviews`, { token: null, revalidate: 60 }).catch(() => []),
  ]);
  const isPro = profile.accountType === "professionnel";
  const name = isPro && profile.shopName ? profile.shopName : profile.displayName;

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
          {isPro && profile.shopDescription && <p style={{ marginTop: 14, whiteSpace: "pre-wrap" }}>{profile.shopDescription}</p>}
          {isPro && (profile.shopAddress || profile.shopHours || profile.shopWebsite) && (
            <dl className="small" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginTop: 10 }}>
              {profile.shopAddress && <><dt className="muted">Adresse</dt><dd style={{ margin: 0 }}>{profile.shopAddress}</dd></>}
              {profile.shopHours && <><dt className="muted">Horaires</dt><dd style={{ margin: 0 }}>{profile.shopHours}</dd></>}
              {profile.shopWebsite && <><dt className="muted">Site web</dt><dd style={{ margin: 0 }}><a href={profile.shopWebsite} rel="nofollow noopener" target="_blank">{profile.shopWebsite}</a></dd></>}
            </dl>
          )}
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <ShareMenu url={`${SITE_URL}/vendeurs/${profile.id}`} title={`${name} sur Trocoin`} text={isPro ? "Découvrez cette boutique" : "Découvrez ce vendeur"} compact />
          <BlockButton userId={profile.id} />
        </div>
      </section>

      <section style={{ marginTop: 36 }}>
        <h2>Annonces en ligne ({listings.total})</h2>
        {listings.items.length === 0 ? (
          <p className="muted">Aucune annonce en ligne pour le moment.</p>
        ) : (
          <div className="grid-cards">{listings.items.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
        )}
      </section>

      <section style={{ marginTop: 36 }}>
        <h2>Avis reçus ({reviews.length})</h2>
        {reviews.length === 0 ? (
          <p className="muted">Pas encore d&apos;avis. Les avis sont laissés après une transaction sécurisée confirmée.</p>
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
      </section>
    </div>
  );
}
