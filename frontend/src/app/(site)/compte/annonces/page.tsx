"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import { formatDate, formatPrice, LISTING_STATUS_LABELS } from "@/lib/format";
import type { Entitlements, ListingCard, ListingStats, ListingStatus } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Statistiques d'une annonce (propriétaire seul) : vues, favoris, messages, clics « Voir le numéro »,
 * icône + nombre, dans l'ordre des grands sites d'annonces.
 */
function ListingStatsRow({ stats }: { stats: ListingStats }) {
  const items: Array<{ key: keyof ListingStats; label: string; icon: React.ReactNode }> = [
    { key: "views", label: "vue", icon: <EyeIcon /> },
    { key: "favorites", label: "favori", icon: <HeartIcon /> },
    { key: "messages", label: "message", icon: <BubbleIcon /> },
    { key: "phoneClicks", label: "appel", icon: <PhoneIcon /> },
  ];
  const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;
  return (
    <ul className="small" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexWrap: "wrap", gap: "4px 16px", color: "var(--ink-soft)" }} data-testid="listing-stats" aria-label="Statistiques de l'annonce">
      {items.map((it) => (
        <li key={it.key} style={{ display: "inline-flex", alignItems: "center", gap: 5 }} title={it.key === "phoneClicks" ? plural(stats[it.key], "clic") + " sur « Voir le numéro »" : it.key === "messages" ? plural(stats[it.key], "conversation") + " sur cette annonce" : plural(stats[it.key], it.label)} data-testid={`stat-${it.key}`}>
          {it.icon}
          <strong style={{ color: "var(--ink)" }}>{stats[it.key]}</strong>
          <span className="sr-only">{` ${it.label}${stats[it.key] > 1 ? "s" : ""}`}</span>
        </li>
      ))}
    </ul>
  );
}
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
function EyeIcon() {
  return <svg {...iconProps}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function HeartIcon() {
  return <svg {...iconProps}><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.3 4.5 6.8 4.5c2 0 3.4 1.1 4.2 2.3.8-1.2 2.2-2.3 4.2-2.3 3.5 0 5.4 3.5 4.1 6.8C19.5 15.9 12 20.5 12 20.5z" /></svg>;
}
function BubbleIcon() {
  return <svg {...iconProps}><path d="M4 5h16v11H9l-5 4z" /></svg>;
}
function PhoneIcon() {
  return <svg {...iconProps}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>;
}

const TABS: Array<{ key: string; label: string; statuses: ListingStatus[] }> = [
  { key: "all", label: "Toutes", statuses: [] },
  { key: "online", label: "En ligne", statuses: ["en_ligne"] },
  { key: "pending", label: "En vérification", statuses: ["en_attente"] },
  { key: "draft", label: "Brouillons", statuses: ["brouillon"] },
  { key: "paused", label: "En pause / expirées", statuses: ["desactivee", "expiree"] },
  { key: "done", label: "Vendues / refusées", statuses: ["vendue", "refusee"] },
];

/**
 * Mes annonces : simple pour un particulier (une annonce, ses actions), puissant pour un pro :
 * dès deux annonces, filtres par statut avec compteurs et mode « Sélectionner » pour mettre en
 * pause, remettre en ligne ou renouveler plusieurs annonces d'un coup (API POST /listings/bulk).
 */
export default function MesAnnoncesPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [listings, setListings] = useState<ListingCard[] | null>(null);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [tab, setTab] = useState("all");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<ListingCard[]>("/listings/mine").then(setListings).catch((e) => toast(e.message, "error")), [toast]);
  useEffect(() => {
    load();
    api<Entitlements>("/users/me/entitlements").then(setEnt).catch(() => null);
  }, [load]);
  // Statistiques à jour au retour sur l'onglet (vues, favoris, messages, clics « Voir le numéro »)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const setStatus = (id: string, status: ListingStatus, ok: string) => act(() => api(`/listings/${id}`, { method: "PATCH", body: { status } }), ok);
  const renew = (id: string) => act(() => api(`/listings/${id}/renew`, { method: "POST" }), "Annonce renouvelée pour 60 jours.");
  const duplicate = (id: string) => act(() => api(`/listings/${id}/duplicate`, { method: "POST" }), "Brouillon créé à partir de l'annonce.");
  const promote = (id: string, type: "boost" | "urgent") =>
    act(() => api(`/listings/${id}/promote`, { method: "POST", body: { type } }), type === "boost" ? "Annonce remontée en tête des résultats pour 7 jours." : "Macaron « Urgent » activé pour 7 jours.");
  const remove = async (id: string) => {
    if (!(await confirm({ title: "Supprimer cette annonce ?", text: "L'annonce, ses photos et ses statistiques seront définitivement supprimées.", confirmLabel: "Supprimer", danger: true }))) return;
    act(() => api(`/listings/${id}`, { method: "DELETE" }), "Annonce supprimée.");
  };
  const markSold = async (id: string) => {
    if (!(await confirm({ title: "Marquer comme vendue ?", text: "L'annonce sera retirée des résultats. Vous pourrez la remettre en ligne depuis l'onglet « Vendues / refusées ».", confirmLabel: "Marquer vendue" }))) return;
    setStatus(id, "vendue", "Annonce marquée comme vendue.");
  };

  const current = TABS.find((t) => t.key === tab)!;
  const visible = (listings ?? []).filter((l) => current.statuses.length === 0 || current.statuses.includes(l.status));
  const free = ent ? !ent.monetizationEnabled : true;
  const many = (listings ?? []).length > 1;

  // ----- Actions groupées -----
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = visible.length > 0 && visible.every((l) => selected.has(l.id));
  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const selectedItems = (listings ?? []).filter((l) => selected.has(l.id));
  const canPause = selectedItems.filter((l) => l.status === "en_ligne").length;
  const canRepublish = selectedItems.filter((l) => ["desactivee", "expiree", "brouillon", "vendue"].includes(l.status)).length;
  const bulk = async (action: "pause" | "republish" | "renew", label: string) => {
    const ids = selectedItems
      .filter((l) => (action === "pause" ? l.status === "en_ligne" : ["desactivee", "expiree", "brouillon", "vendue"].includes(l.status)))
      .map((l) => l.id);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await api<{ done: number; failed: Array<{ id: string; reason: string }> }>("/listings/bulk", { method: "POST", body: { ids, action } });
      toast(`${res.done} annonce${res.done > 1 ? "s" : ""} ${label}${res.failed.length ? ` · ${res.failed.length} impossible${res.failed.length > 1 ? "s" : ""}` : ""}.`, res.failed.length ? "info" : "success");
      exitSelection();
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Mes annonces</h1>
        <Link href="/deposer" className="btn btn-primary">Déposer une annonce</Link>
      </div>
      {ent && (
        <div className="alert alert-info">
          {free
            ? "Pendant le lancement, tout est gratuit et illimité : annonces, remontée en tête de liste et macaron « Urgent »."
            : ent.plan
              ? `Formule ${ent.plan.name} : ${ent.listingsLimit === null ? "annonces illimitées" : `${ent.listingsLimit} annonces en ligne`}, ${ent.boostsLimit === null ? "mises en avant illimitées" : `${ent.boostsLimit} mises en avant / mois`}.`
              : `Compte sans formule : ${ent.listingsLimit} annonces / 30 jours, mise en avant ${ent.boostPrice.toFixed(2)} €, urgent ${ent.urgentPrice.toFixed(2)} €.`}
          {!free && <> <Link href="/compte/formule">Voir les formules</Link>.</>}
        </div>
      )}
      {many && (
        <div className="row spread" style={{ marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <div className="row" role="tablist" aria-label="Filtrer par statut" style={{ flexWrap: "wrap" }}>
            {TABS.map((t) => {
              const n = (listings ?? []).filter((l) => t.statuses.length === 0 || t.statuses.includes(l.status)).length;
              return (
                <button key={t.key} role="tab" aria-selected={tab === t.key} className={`btn btn-sm ${tab === t.key ? "btn-dark" : "btn-outline"}`} onClick={() => { setTab(t.key); setSelected(new Set()); }}>
                  {t.label} ({n})
                </button>
              );
            })}
          </div>
          <button type="button" className={`btn btn-sm ${selecting ? "btn-dark" : "btn-outline"}`} aria-pressed={selecting} onClick={() => (selecting ? exitSelection() : setSelecting(true))} data-testid="bulk-toggle">
            {selecting ? "Terminer" : "Sélectionner"}
          </button>
        </div>
      )}
      {selecting && (
        <div className="panel" role="toolbar" aria-label="Actions groupées" data-testid="bulk-bar" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 12, marginBottom: 12 }}>
          <span className="small" style={{ flex: "1 1 160px" }} aria-live="polite">
            {selected.size === 0 ? "Cochez une ou plusieurs annonces." : `${selected.size} sélectionnée${selected.size > 1 ? "s" : ""}`}
          </span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelected(allSelected ? new Set() : new Set(visible.map((l) => l.id)))}>
            {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
          </button>
          {canPause > 0 && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => bulk("pause", "mise(s) en pause")}>Mettre en pause ({canPause})</button>}
          {canRepublish > 0 && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => bulk("republish", "remise(s) en ligne")}>Remettre en ligne ({canRepublish})</button>}
          {selectedItems.some((l) => l.status === "en_ligne") && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => bulk("renew", "renouvelée(s) pour 60 jours")}>Renouveler ({selectedItems.filter((l) => l.status === "en_ligne").length})</button>}
        </div>
      )}

      {listings === null ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucune annonce ici" text="Vos annonces apparaîtront dans cette liste avec leurs statistiques." action={{ href: "/deposer", label: "Déposer une annonce" }} />
      ) : (
        <div className="stack">
          {visible.map((l) => {
            const st = LISTING_STATUS_LABELS[l.status];
            const checked = selected.has(l.id);
            return (
              <div key={l.id} className="card" data-testid="my-listing" data-selected={selecting ? checked : undefined} style={{ display: "grid", gridTemplateColumns: selecting ? "auto 96px 1fr" : "96px 1fr", gap: 14, alignItems: "start", outline: checked ? "2px solid var(--accent)" : undefined }}>
                {selecting && <input type="checkbox" checked={checked} onChange={() => toggle(l.id)} aria-label={`Sélectionner : ${l.title}`} style={{ width: 22, height: 22, marginTop: 24 }} />}
                <Link href={`/annonces/${l.id}`} aria-label={`Voir l'annonce ${l.title}`} style={{ aspectRatio: "4/3", background: "var(--ivory-warm)", borderRadius: 6, overflow: "hidden" }}>
                  {l.coverUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl(l.coverUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                </Link>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className={st.pill}>{st.label}</span>
                    {l.isBoosted && <span className="pill pill-ochre">À la une</span>}
                    {l.isUrgent && <span className="pill pill-brick">Urgent</span>}
                    {l.shopOwnerId && <span className="pill pill-green">Boutique</span>}
                    <span className="small muted">{l.categoryName}</span>
                  </div>
                  <Link href={`/annonces/${l.id}`} style={{ fontWeight: 600, display: "block", margin: "4px 0" }}>{l.title}</Link>
                  <div className="small muted">
                    {formatPrice(l.price, l.priceType)} · {l.photosCount} photo{l.photosCount > 1 ? "s" : ""}
                    {l.expiresAt && l.status === "en_ligne" && ` · expire le ${formatDate(l.expiresAt)}`}
                    {l.externalRef && ` · réf. ${l.externalRef}`}
                  </div>
                  {l.stats && l.status !== "brouillon" && <ListingStatsRow stats={l.stats} />}
                  {l.moderationReason && <div className="small" style={{ color: "var(--brick)", marginTop: 4 }}>{l.moderationReason}</div>}
                  {!selecting && (
                    <div className="row" style={{ marginTop: 10 }}>
                      {l.status !== "refusee" && <Link href={`/compte/annonces/${l.id}/modifier`} className="btn btn-outline btn-sm">Modifier</Link>}
                      {l.status === "brouillon" && <button className="btn btn-dark btn-sm" onClick={() => setStatus(l.id, "en_ligne", "Annonce publiée.")}>Publier</button>}
                      {l.status === "en_ligne" && (
                        <>
                          {!l.isBoosted && <button className="btn btn-ghost btn-sm" onClick={() => promote(l.id, "boost")} title="Remonter en tête des résultats pendant 7 jours">⬆ Mettre en avant{free ? " (gratuit)" : ""}</button>}
                          {!l.isUrgent && <button className="btn btn-ghost btn-sm" onClick={() => promote(l.id, "urgent")} title="Afficher le macaron Urgent pendant 7 jours">⚡ Urgent{free ? " (gratuit)" : ""}</button>}
                          <button className="btn btn-ghost btn-sm" onClick={() => markSold(l.id)}>Vendue</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setStatus(l.id, "desactivee", "Annonce mise en pause.")}>Mettre en pause</button>
                        </>
                      )}
                      {(l.status === "desactivee" || l.status === "expiree") && <button className="btn btn-dark btn-sm" onClick={() => renew(l.id)}>Remettre en ligne</button>}
                      {l.status === "vendue" && <button className="btn btn-ghost btn-sm" onClick={() => setStatus(l.id, "en_ligne", "Annonce remise en ligne.")}>Remettre en ligne</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => duplicate(l.id)}>Dupliquer</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--brick)" }} onClick={() => remove(l.id)}>Supprimer</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
