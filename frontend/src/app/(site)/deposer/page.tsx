import type { Metadata } from "next";
import { RequireAuth } from "@/components/ui/RequireAuth";
import { ListingForm } from "@/components/listing/ListingForm";

export const metadata: Metadata = { title: "Déposer une annonce", robots: { index: false } };

export default function DeposerPage() {
  return (
    <RequireAuth>
      <div className="container page" style={{ maxWidth: 860 }}>
        <p className="eyebrow">Dépôt gratuit</p>
        <h1>Déposer une annonce</h1>
        <ListingForm />
      </div>
    </RequireAuth>
  );
}
