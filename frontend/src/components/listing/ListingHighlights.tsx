import { CONDITION_LABELS } from "@/lib/format";
import type { ListingDetail } from "@/lib/types";

/**
 * « Les + de cette annonce » : badges tirés uniquement de ce que Trocoin sait de l'annonce
 * (date, complétude, photos, livraison, état, urgence, vendeur, options cochées dans les critères).
 * Rien n'est affiché quand aucun point ne ressort.
 */
export function listingHighlights(listing: ListingDetail): Array<{ key: string; label: string; icon: Icon }> {
  const out: Array<{ key: string; label: string; icon: Icon }> = [];
  const published = new Date(listing.publishedAt || listing.createdAt).getTime();
  if (Date.now() - published < 7 * 86_400_000) out.push({ key: "recente", label: "Annonce récente", icon: "clock" });
  if (listing.completeness?.complete) out.push({ key: "complete", label: "Fiche complète", icon: "check" });
  if (listing.photos.length >= 3) out.push({ key: "photos", label: `${listing.photos.length} photos`, icon: "camera" });
  if (listing.condition === "neuf") out.push({ key: "neuf", label: CONDITION_LABELS.neuf, icon: "star" });
  if (listing.deliveryAvailable) out.push({ key: "livraison", label: "Livraison possible", icon: "parcel" });
  if (listing.isUrgent) out.push({ key: "urgent", label: "Vente urgente", icon: "bolt" });
  if (listing.seller?.identityVerified) out.push({ key: "identite", label: "Vendeur à l'identité vérifiée", icon: "shield" });
  if (listing.seller?.accountType === "professionnel") out.push({ key: "pro", label: "Vendeur professionnel", icon: "shop" });
  for (const a of listing.attributesLabeled) {
    if (a.value === true && out.length < 8) out.push({ key: `attr-${a.key}`, label: a.label, icon: "check" });
  }
  return out.slice(0, 8);
}

type Icon = "clock" | "check" | "camera" | "star" | "parcel" | "bolt" | "shield" | "shop";

export function ListingHighlights({ listing }: { listing: ListingDetail }) {
  const items = listingHighlights(listing);
  if (items.length === 0) return null;
  return (
    <section className="panel" style={{ marginTop: 20 }} data-testid="highlights" aria-labelledby="highlights-title">
      <h2 className="h3" id="highlights-title">Les + de cette annonce</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.map((it) => (
          <li key={it.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, background: "var(--accent-tint)", color: "var(--accent-dark)", fontSize: ".86rem", fontWeight: 600 }}>
            <HighlightIcon name={it.icon} />
            {it.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HighlightIcon({ name }: { name: Icon }) {
  const common = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "camera":
      return <svg {...common}><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>;
    case "star":
      return <svg {...common}><path d="M12 3l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.5l-5.7 3 1.2-6.4L2.8 9.7l6.4-.8z" /></svg>;
    case "parcel":
      return <svg {...common}><path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></svg>;
    case "bolt":
      return <svg {...common}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>;
    case "shield":
      return <svg {...common}><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "shop":
      return <svg {...common}><path d="M4 9 5.5 4h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6" /></svg>;
    default:
      return <svg {...common}><path d="m5 12 5 5L20 7" /></svg>;
  }
}
