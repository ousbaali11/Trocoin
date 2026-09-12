"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ListingDetail } from "@/lib/types";
import { ListingForm } from "@/components/listing/ListingForm";

export default function ModifierAnnoncePage() {
  const { id } = useParams<{ id: string }>();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ListingDetail>(`/listings/${id}`).then((l) => (l.isOwner ? setListing(l) : setError("Vous n'êtes pas propriétaire de cette annonce."))).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!listing) return <div className="skeleton" style={{ height: 320 }} />;
  return (
    <div>
      <p className="eyebrow">Modification</p>
      <h1 style={{ fontSize: "1.6rem" }}>{listing.title}</h1>
      <ListingForm existing={listing} />
    </div>
  );
}
