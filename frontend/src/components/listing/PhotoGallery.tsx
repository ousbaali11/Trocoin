"use client";

import { useEffect, useState } from "react";
import { mediaUrl } from "@/lib/api";
import type { ListingPhoto } from "@/lib/types";
import { FavoriteButton } from "@/components/ui/FavoriteButton";
import { ShareMenu } from "@/components/ui/ShareMenu";

/**
 * Galerie de la fiche annonce : photo principale 4:3, flèches, vignettes, compteur « n / total »,
 * bouton « Voir les photos » (plein écran avec navigation clavier et flèches), et en haut à droite
 * le cœur avec le nombre de favoris et le menu « Partager ».
 */
export function PhotoGallery({ photos, title, listingId, favoritesCount, showActions = true }: { photos: ListingPhoto[]; title: string; listingId?: string; favoritesCount?: number; showActions?: boolean }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const total = photos.length;
  const prev = () => setIndex((i) => (i - 1 + total) % total);
  const next = () => setIndex((i) => (i + 1) % total);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(false);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % total);
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + total) % total);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoom, total]);

  const actions = showActions && listingId ? (
    <div style={{ position: "absolute", right: 12, top: 12, display: "flex", alignItems: "center", gap: 8 }} data-testid="gallery-actions">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,253,249,.94)", borderRadius: 999, padding: "2px 10px 2px 2px", boxShadow: "0 1px 3px rgba(31,41,51,.2)" }}>
        <FavoriteButton listingId={listingId} compact />
        {typeof favoritesCount === "number" && (
          <span className="small" style={{ fontWeight: 600, color: "var(--ink)" }} data-testid="favorites-count" title={`${favoritesCount} personne${favoritesCount > 1 ? "s ont" : " a"} cette annonce en favori`}>
            {favoritesCount}
            <span className="sr-only"> favori{favoritesCount > 1 ? "s" : ""}</span>
          </span>
        )}
      </span>
      <span style={{ background: "rgba(255,253,249,.94)", borderRadius: 999, boxShadow: "0 1px 3px rgba(31,41,51,.2)" }}>
        <ShareMenu title={title} text="Regarde cette annonce sur Trocoin" compact />
      </span>
    </div>
  ) : null;

  if (total === 0) {
    return (
      <div style={{ position: "relative", aspectRatio: "4/3", background: "var(--ivory-warm)", borderRadius: "var(--radius-lg)", display: "grid", placeItems: "center", color: "var(--ink-muted)" }}>
        Aucune photo
        {actions}
      </div>
    );
  }
  const current = mediaUrl(photos[index]?.url);

  return (
    <div>
      <div style={{ position: "relative", aspectRatio: "4/3", background: "var(--ink)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current} srcSet={photos[index]?.thumbUrl ? `${mediaUrl(photos[index].thumbUrl!)} 480w, ${current} 1600w` : undefined} sizes="(max-width: 720px) 100vw, 640px" alt={`${title} — photo ${index + 1} sur ${total}`} fetchPriority="high" decoding="async" style={{ width: "100%", height: "100%", objectFit: "contain", cursor: "zoom-in" }} onClick={() => setZoom(true)} />
        {total > 1 && (
          <>
            <button type="button" aria-label="Photo précédente" onClick={prev} style={navBtn("left")}>‹</button>
            <button type="button" aria-label="Photo suivante" onClick={next} style={navBtn("right")}>›</button>
          </>
        )}
        {actions}
        <button type="button" className="btn btn-sm" onClick={() => setZoom(true)} style={{ position: "absolute", left: 12, bottom: 12, background: "rgba(255,253,249,.94)", color: "var(--ink)", border: 0, boxShadow: "0 1px 3px rgba(31,41,51,.2)" }}>
          <PhotosIcon /> Voir les photos
        </button>
        <span aria-live="polite" style={{ position: "absolute", right: 12, bottom: 12, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: ".78rem", padding: "3px 9px", borderRadius: 999 }}>
          {index + 1} / {total}
        </span>
      </div>
      {total > 1 && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
          {photos.map((p, i) => (
            <button key={p.id} type="button" onClick={() => setIndex(i)} aria-label={`Voir la photo ${i + 1}`} aria-pressed={i === index} style={{ flex: "0 0 76px", height: 60, padding: 0, border: i === index ? "2px solid var(--accent)" : "1px solid var(--line-soft)", borderRadius: 8, overflow: "hidden", background: "var(--ivory-warm)", cursor: "pointer" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(p.thumbUrl || p.url)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </button>
          ))}
        </div>
      )}
      {zoom && (
        <div role="dialog" aria-label="Photos en plein écran" onClick={() => setZoom(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", zIndex: 300, display: "grid", placeItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current} alt={`${title} — photo ${index + 1} sur ${total}`} style={{ maxWidth: "95vw", maxHeight: "88vh", objectFit: "contain" }} onClick={(e) => e.stopPropagation()} />
          {total > 1 && (
            <>
              <button type="button" aria-label="Photo précédente" onClick={(e) => { e.stopPropagation(); prev(); }} style={{ ...navBtn("left"), left: 18 }}>‹</button>
              <button type="button" aria-label="Photo suivante" onClick={(e) => { e.stopPropagation(); next(); }} style={{ ...navBtn("right"), right: 18 }}>›</button>
            </>
          )}
          <span style={{ position: "absolute", bottom: 18, left: "50%", transform: "translateX(-50%)", color: "#fff", fontSize: ".9rem", background: "rgba(0,0,0,.5)", padding: "4px 12px", borderRadius: 999 }}>{index + 1} / {total}</span>
          <button aria-label="Fermer" onClick={() => setZoom(false)} style={{ position: "absolute", top: 16, right: 16, background: "none", border: 0, color: "#fff", fontSize: 28, cursor: "pointer" }}>×</button>
        </div>
      )}
    </div>
  );
}

function PhotosIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 16 5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.5" />
    </svg>
  );
}

function navBtn(side: "left" | "right"): React.CSSProperties {
  return {
    position: "absolute",
    top: "50%",
    [side]: 10,
    transform: "translateY(-50%)",
    width: 40,
    height: 40,
    borderRadius: "50%",
    border: 0,
    background: "rgba(255,253,249,.9)",
    color: "var(--ink)",
    fontSize: 26,
    lineHeight: 1,
    cursor: "pointer",
  };
}
