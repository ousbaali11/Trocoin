import Link from "next/link";
import { mediaUrl } from "@/lib/api";
import { memberSince } from "@/lib/format";
import type { SellerSummary } from "@/lib/types";
import { Rating } from "@/components/ui/Rating";

export function SellerCard({ seller }: { seller: SellerSummary }) {
  const isPro = seller.accountType === "professionnel";
  return (
    <div className="card">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--bottle)", color: "var(--white)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: "1.1rem", overflow: "hidden", flexShrink: 0 }}>
          {seller.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(seller.avatarUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            seller.displayName.slice(0, 1).toUpperCase()
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: "block" }}>{isPro && seller.shopName ? seller.shopName : seller.displayName}</strong>
          <div className="row" style={{ gap: 6 }}>
            {isPro ? <span className="pill pill-dark">Professionnel</span> : <span className="pill">Particulier</span>}
            {seller.identityVerified && <span className="pill pill-green">Identité vérifiée</span>}
          </div>
          <div style={{ marginTop: 6 }}><Rating value={seller.ratingAvg} count={seller.ratingCount} /></div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>Membre depuis {memberSince(seller.createdAt)}{seller.city ? ` · ${seller.city}` : ""}</p>
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
