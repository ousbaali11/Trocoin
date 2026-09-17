"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, API_URL, getToken, mediaUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfirm } from "@/lib/confirm-context";
import { useToast } from "@/lib/toast-context";
import { formatPrice, timeAgo, truncate } from "@/lib/format";
import type { ConversationSummary } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";

const LONG_PRESS_MS = 600;

/**
 * Boîte de réception. Mode « Sélection » (bouton, ou appui long sur une conversation) :
 * cases à cocher, tout sélectionner / désélectionner, suppression avec confirmation.
 * La suppression ne retire la conversation que pour la personne qui supprime (l'autre
 * participant garde l'échange), voir l'API `POST /conversations/bulk-delete`.
 */
export default function MessagesPage() {
  const { refreshCounters } = useAuth();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [filter, setFilter] = useState<"all" | "acheteur" | "vendeur">("all");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const load = useCallback(() => api<ConversationSummary[]>("/conversations").then(setItems).catch(() => setItems([])), []);
  useEffect(() => {
    load();
  }, [load]);
  // Liste vivante (AUDIT §60) : le serveur réveille la boîte (« inbox ») à chaque message, proposition ou étape de vente ;
  // on relit aussi au retour sur l'onglet et, par sécurité, toutes les 20 s tant que la page est à l'écran
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket = io(API_URL, { transports: ["websocket", "polling"], auth: (cb) => cb({ token: getToken() || "" }) });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { load(); refreshCounters(); }, 300);
    };
    socket.on("inbox", refresh);
    socket.on("connect", refresh);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      refresh();
      if (!socket.connected) socket.connect();
    };
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(() => { if (document.visibilityState === "visible") load(); }, 20_000);
    return () => {
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      socket.close();
    };
  }, [load, refreshCounters]);

  const visible = (items ?? []).filter((c) => filter === "all" || c.role === filter);
  const allSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () => setSelected(new Set(visible.map((c) => c.id)));
  const clearSelection = () => setSelected(new Set());
  const exitSelection = () => {
    setSelecting(false);
    clearSelection();
  };

  /** Appui long (tactile ou souris) : entre en mode sélection avec cette conversation cochée. */
  const pressStart = (id: string) => {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setSelecting(true);
      setSelected((prev) => new Set(prev).add(id));
    }, LONG_PRESS_MS);
  };
  const pressEnd = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const remove = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const n = ids.length;
    const ok = await confirm({
      title: n > 1 ? `Supprimer ${n} conversations ?` : "Supprimer cette conversation ?",
      text: "Elle disparaîtra de votre messagerie. Votre interlocuteur garde son côté de l'échange, et elle réapparaîtra s'il vous écrit à nouveau. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api<{ deleted: number }>("/conversations/bulk-delete", { method: "POST", body: { ids } });
      setItems((prev) => (prev ?? []).filter((c) => !selected.has(c.id)));
      toast(n > 1 ? `${n} conversations supprimées.` : "Conversation supprimée.", "success");
      exitSelection();
      refreshCounters();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Messages</h1>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <div className="row" role="tablist" aria-label="Filtrer les conversations">
            {(["all", "acheteur", "vendeur"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={`btn btn-sm ${filter === f ? "btn-dark" : "btn-outline"}`} onClick={() => setFilter(f)}>
                {f === "all" ? "Toutes" : f === "acheteur" ? "Mes achats" : "Mes ventes"}
              </button>
            ))}
          </div>
          {items && items.length > 0 && (
            <button type="button" className={`btn btn-sm ${selecting ? "btn-primary" : "btn-outline"}`} aria-pressed={selecting} onClick={() => (selecting ? exitSelection() : setSelecting(true))}>
              {selecting ? "Terminer" : "Sélectionner"}
            </button>
          )}
        </div>
      </div>

      {selecting && (
        <div className="panel" role="toolbar" aria-label="Actions sur la sélection" data-testid="selection-bar" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 12, marginBottom: 12 }}>
          <span className="small" style={{ flex: "1 1 160px" }} aria-live="polite">
            {selected.size === 0 ? "Cochez une ou plusieurs conversations." : `${selected.size} sélectionnée${selected.size > 1 ? "s" : ""}`}
          </span>
          <button type="button" className="btn btn-outline btn-sm" onClick={allSelected ? clearSelection : selectAll}>
            {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
          </button>
          {selected.size > 0 && (
            <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={busy}>
              {busy ? "Suppression…" : `Supprimer (${selected.size})`}
            </button>
          )}
        </div>
      )}

      {items === null ? <div className="skeleton" style={{ height: 200 }} /> : visible.length === 0 ? (
        <EmptyState title="Aucune conversation" text="Contactez un vendeur depuis une annonce : l'échange apparaîtra ici." action={{ href: "/recherche", label: "Explorer les annonces" }} />
      ) : (
        <div className="stack">
          {visible.map((c) => {
            const checked = selected.has(c.id);
            const inner = (
              <>
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
                  <div className="small" style={{ color: c.unreadCount > 0 ? "var(--ink)" : "var(--ink-muted)", fontWeight: c.unreadCount > 0 ? 600 : 400 }}>{c.listing?.title ?? "Cette annonce n'existe plus"} · {c.listing ? formatPrice(c.listing.price, c.listing.priceType) : ""}</div>
                  <div className="small" style={{ marginTop: 4, fontWeight: c.unreadCount > 0 ? 700 : 400, color: c.unreadCount > 0 ? "var(--ink)" : "var(--ink-soft)" }}>
                    {c.lastMessage ? `${c.lastMessage.type !== "system" && c.lastMessage.senderId !== c.other?.id ? "Vous : " : ""}${truncate(c.lastMessage.content ?? "", 90)}` : "Aucun message"}
                  </div>
                </div>
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <div className="small" style={{ fontWeight: c.unreadCount > 0 ? 700 : 400, color: c.unreadCount > 0 ? "var(--accent-dark)" : "var(--ink-muted)" }} suppressHydrationWarning>{timeAgo(c.lastMessageAt || c.createdAt)}</div>
                  {c.unreadCount > 0 && <span className="conv-dot" aria-hidden="true" />}
                </div>
              </>
            );
            const label = `${c.unreadCount > 0 ? `${c.unreadCount} non lu${c.unreadCount > 1 ? "s" : ""}, ` : ""}conversation avec ${c.other?.displayName ?? "un membre"}${c.listing ? ` à propos de ${c.listing.title}` : ""}`;
            if (selecting) {
              return (
                <label key={c.id} className={`card conv-card ${c.unreadCount > 0 ? "unread" : ""}`} data-testid="conversation" data-selected={checked} style={{ display: "grid", gridTemplateColumns: "auto 64px 1fr auto", gap: 14, alignItems: "center", cursor: "pointer", outline: checked ? "2px solid var(--accent)" : undefined }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(c.id)} aria-label={`Sélectionner : ${label}`} style={{ width: 22, height: 22 }} />
                  {inner}
                </label>
              );
            }
            return (
              <Link
                key={c.id}
                href={`/compte/messages/${c.id}`}
                className={`card card-hover conv-card ${c.unreadCount > 0 ? "unread" : ""}`}
                aria-label={label}
                data-testid="conversation"
                style={{ display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 14, alignItems: "center" }}
                onPointerDown={() => pressStart(c.id)}
                onPointerUp={pressEnd}
                onPointerLeave={pressEnd}
                onPointerCancel={pressEnd}
                onContextMenu={(e) => {
                  // Appui long sur mobile : pas de menu contextuel, on passe en sélection
                  if (longPressed.current) e.preventDefault();
                }}
                onClick={(e) => {
                  if (longPressed.current) {
                    e.preventDefault();
                    longPressed.current = false;
                  }
                }}
              >
                {inner}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
