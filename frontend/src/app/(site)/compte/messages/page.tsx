"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { formatPrice, timeAgo, truncate } from "@/lib/format";
import type { ConversationSummary } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";

export default function MessagesPage() {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [filter, setFilter] = useState<"all" | "acheteur" | "vendeur">("all");
  useEffect(() => {
    api<ConversationSummary[]>("/conversations").then(setItems).catch(() => setItems([]));
  }, []);
  const visible = (items ?? []).filter((c) => filter === "all" || c.role === filter);

  return (
    <div>
      <div className="page-head">
        <h1>Messages</h1>
        <div className="row" role="tablist">
          {(["all", "acheteur", "vendeur"] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={`btn btn-sm ${filter === f ? "btn-dark" : "btn-outline"}`} onClick={() => setFilter(f)}>
              {f === "all" ? "Toutes" : f === "acheteur" ? "Mes achats" : "Mes ventes"}
            </button>
          ))}
        </div>
      </div>
      {items === null ? <div className="skeleton" style={{ height: 200 }} /> : visible.length === 0 ? (
        <EmptyState title="Aucune conversation" text="Contactez un vendeur depuis une annonce : l'échange apparaîtra ici." action={{ href: "/recherche", label: "Explorer les annonces" }} />
      ) : (
        <div className="stack">
          {visible.map((c) => (
            <Link key={c.id} href={`/compte/messages/${c.id}`} className={`card card-hover conv-card ${c.unreadCount > 0 ? "unread" : ""}`} aria-label={`${c.unreadCount > 0 ? `${c.unreadCount} non lu${c.unreadCount > 1 ? "s" : ""}, ` : ""}conversation avec ${c.other?.displayName ?? "un membre"}${c.listing ? ` à propos de ${c.listing.title}` : ""}`} style={{ display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 14, alignItems: "center" }}>
              <div style={{ aspectRatio: "1", background: "var(--ivory-warm)", borderRadius: 6, overflow: "hidden" }}>
                {c.listing?.coverUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl(c.listing.coverUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontWeight: c.unreadCount > 0 ? 700 : 600 }}>{c.other?.displayName ?? "Membre"}</span>
                  <span className="pill">{c.role === "acheteur" ? "Achat" : "Vente"}</span>
                  {c.listing && c.listing.status !== "en_ligne" && <span className="pill pill-dark">{c.listing.status === "vendue" ? "Vendue" : "Annonce retirée"}</span>}
                </div>
                <div className="small" style={{ color: c.unreadCount > 0 ? "var(--ink)" : "var(--ink-muted)", fontWeight: c.unreadCount > 0 ? 600 : 400 }}>{c.listing?.title} · {c.listing ? formatPrice(c.listing.price, c.listing.priceType) : ""}</div>
                <div className="small" style={{ marginTop: 4, fontWeight: c.unreadCount > 0 ? 700 : 400, color: c.unreadCount > 0 ? "var(--ink)" : "var(--ink-soft)" }}>
                  {c.lastMessage ? `${c.lastMessage.senderId !== c.other?.id ? "Vous : " : ""}${truncate(c.lastMessage.content ?? "", 90)}` : "Aucun message"}
                </div>
              </div>
              <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <div className="small" style={{ fontWeight: c.unreadCount > 0 ? 700 : 400, color: c.unreadCount > 0 ? "var(--accent-dark)" : "var(--ink-muted)" }} suppressHydrationWarning>{timeAgo(c.lastMessageAt || c.createdAt)}</div>
                {c.unreadCount > 0 && <span className="conv-dot" aria-hidden="true" />}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
