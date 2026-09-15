"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import { formatDate, formatPrice, LISTING_STATUS_LABELS } from "@/lib/format";
import type { Entitlements, ListingCard, ListingStatus } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";

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
                    {formatPrice(l.price, l.priceType)} · {l.viewsCount} vue{l.viewsCount > 1 ? "s" : ""} · {l.photosCount} photo{l.photosCount > 1 ? "s" : ""}
                    {l.expiresAt && l.status === "en_ligne" && ` · expire le ${formatDate(l.expiresAt)}`}
                    {l.externalRef && ` · réf. ${l.externalRef}`}
                  </div>
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
