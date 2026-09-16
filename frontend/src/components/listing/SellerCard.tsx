import Link from "next/link";
import { mediaUrl } from "@/lib/api";
import { memberSince } from "@/lib/format";
import type { PublicProfile, SellerSummary } from "@/lib/types";
import { Rating } from "@/components/ui/Rating";
import { FollowSellerButton } from "./FollowSellerButton";

/**
 * Bloc vendeur de la fiche : avatar, nom, type de compte, identité vérifiée, note, « Suivre »,
 * « Membre depuis », et les repères de confiance calculés à partir de données réelles seulement
 * (taux de réponse aux messages, annonces en ligne). Pas de numéro de téléphone : Trocoin ne le rend
 * jamais public, le contact passe par la messagerie (boutons du bloc d'actions au-dessus).
 */
export function SellerCard({ seller, profile, listingId }: { seller: SellerSummary; profile?: PublicProfile | null; listingId?: string }) {
  const isPro = seller.accountType === "professionnel";
  const name = isPro && seller.shopName ? seller.shopName : seller.displayName;
  const trust: string[] = [];
  if (profile && profile.responseRate !== null && profile.responseRate >= 80) trust.push(`Répond à ${profile.responseRate} % des messages`);
  if (profile && profile.activeListingsCount > 1) trust.push(`${profile.activeListingsCount} annonces en ligne`);
  return (
    <div className="card" data-testid="seller-card">
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--bottle)", color: "var(--white)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: "1.1rem", overflow: "hidden", flexShrink: 0 }}>
          {seller.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(seller.avatarUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            seller.displayName.slice(0, 1).toUpperCase()
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 8 }}>
            <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</strong>
            {!seller.deleted && <FollowSellerButton sellerId={seller.id} sellerName={name} returnTo={listingId ? `/annonces/${listingId}` : `/vendeurs/${seller.id}`} />}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            {isPro ? <span className="pill pill-dark">Professionnel</span> : <span className="pill">Particulier</span>}
            {seller.identityVerified && <span className="pill pill-green">Identité vérifiée</span>}
          </div>
          <div style={{ marginTop: 6 }}><Rating value={seller.ratingAvg} count={seller.ratingCount} /></div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>Membre depuis {memberSince(seller.createdAt)}{seller.city ? ` · ${seller.city}` : ""}</p>
          {trust.length > 0 && (
            <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3, color: "var(--sage-dark)" }} data-testid="seller-trust">
              {trust.map((t) => (
                <li key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg>
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!seller.deleted && (
        <Link href={`/vendeurs/${seller.id}`} className="btn btn-outline btn-sm btn-block" style={{ marginTop: 14 }}>
          {isPro ? "Voir la boutique" : "Voir le profil et les autres annonces"}
        </Link>
      )}
    </div>
  );
}
