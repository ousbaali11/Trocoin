"use client";

import { useEffect, useState } from "react";
import { mediaUrl } from "@/lib/api";
import type { ListingPhoto } from "@/lib/types";

export function PhotoGallery({ photos, title }: { photos: ListingPhoto[]; title: string }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const total = photos.length;

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

  if (total === 0) {
    return (
      <div style={{ aspectRatio: "4/3", background: "var(--ivory-warm)", borderRadius: "var(--radius-lg)", display: "grid", placeItems: "center", color: "var(--ink-muted)" }}>
        Aucune photo
      </div>
    );
  }
  const current = mediaUrl(photos[index]?.url);

  return (
    <div>
      <div style={{ position: "relative", aspectRatio: "4/3", background: "var(--ink)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current} alt={`${title} — photo ${index + 1} sur ${total}`} style={{ width: "100%", height: "100%", objectFit: "contain", cursor: "zoom-in" }} onClick={() => setZoom(true)} />
        {total > 1 && (
          <>
            <button aria-label="Photo précédente" onClick={() => setIndex((i) => (i - 1 + total) % total)} style={navBtn("left")}>‹</button>
            <button aria-label="Photo suivante" onClick={() => setIndex((i) => (i + 1) % total)} style={navBtn("right")}>›</button>
          </>
        )}
        <span style={{ position: "absolute", right: 12, bottom: 12, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: ".78rem", padding: "3px 9px", borderRadius: 999 }}>
          {index + 1} / {total}
        </span>
      </div>
      {total > 1 && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
          {photos.map((p, i) => (
            <button key={p.id} onClick={() => setIndex(i)} aria-label={`Voir la photo ${i + 1}`} aria-current={i === index} style={{ flex: "0 0 76px", height: 60, padding: 0, border: i === index ? "2px solid var(--ochre)" : "2px solid transparent", borderRadius: 8, overflow: "hidden", cursor: "pointer", background: "var(--ivory-warm)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(p.url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </button>
          ))}
        </div>
      )}
      {zoom && (
        <div role="dialog" aria-label="Photo en plein écran" onClick={() => setZoom(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", zIndex: 300, display: "grid", placeItems: "center", cursor: "zoom-out" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current} alt="" style={{ maxWidth: "95vw", maxHeight: "92vh", objectFit: "contain" }} />
          <button aria-label="Fermer" onClick={() => setZoom(false)} style={{ position: "absolute", top: 16, right: 16, background: "none", border: 0, color: "#fff", fontSize: 28, cursor: "pointer" }}>✕</button>
        </div>
      )}
    </div>
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
