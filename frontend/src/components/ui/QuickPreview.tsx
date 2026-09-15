"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import type { ListingDetail } from "@/lib/types";
import { Modal } from "./Modal";

/**
 * Aperçu rapide d'une annonce (clic long sur une carte, souris) : première photo, prix, lieu,
 * début de la description et les critères principaux, sans quitter la liste.
 */
export function QuickPreview({ listingId, onClose }: { listingId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<ListingDetail>(`/listings/${listingId}`, { token: null })
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setError("Aperçu indisponible pour le moment."));
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  const cover = detail?.photos?.[0]?.url;
  return (
    <Modal open onClose={onClose} title={detail ? detail.title : "Aperçu de l'annonce"} width={640}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {!detail && !error && (
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16 }} aria-busy="true" aria-label="Chargement de l'aperçu">
          <div className="skeleton" style={{ aspectRatio: "1" }} />
          <div className="stack">
            <div className="skeleton" style={{ height: 24, width: "40%" }} />
            <div className="skeleton" style={{ height: 16 }} />
            <div className="skeleton" style={{ height: 16, width: "80%" }} />
          </div>
        </div>
      )}
      {detail && (
        <div data-testid="quick-preview">
          <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 200px) 1fr", gap: 16, alignItems: "start" }}>
            <div style={{ aspectRatio: "1", borderRadius: 12, overflow: "hidden", background: "var(--ivory-warm)" }}>
              {cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(cover)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 600 }}>{formatPrice(detail.price, detail.priceType)}</div>
              <div className="small muted">{[detail.city, detail.postalCode].filter(Boolean).join(" ")}{detail.category ? ` · ${detail.category.name}` : ""}</div>
              {detail.attributesLabeled.length > 0 && (
                <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {detail.attributesLabeled.slice(0, 4).map((a) => (
                    <li key={a.key}><span className="muted">{a.label} :</span> {typeof a.value === "boolean" ? (a.value ? "Oui" : "Non") : String(a.value)}{a.unit ? ` ${a.unit}` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="small" style={{ marginTop: 12, whiteSpace: "pre-line" }}>{detail.description.length > 280 ? `${detail.description.slice(0, 277)}…` : detail.description}</p>
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button>
            <Link href={`/annonces/${detail.id}`} className="btn btn-primary">Voir l&apos;annonce</Link>
          </div>
        </div>
      )}
    </Modal>
  );
}
