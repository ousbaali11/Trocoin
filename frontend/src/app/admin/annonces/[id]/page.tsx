"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import { formatDateTime, formatPrice, REPORT_REASON_LABELS } from "@/lib/format";
import type { ListingPhoto, PriceType, Report, Transaction } from "@/lib/types";
import { statusPill } from "@/components/admin/AdminPager";

interface AdminListing {
  id: string;
  userId: string;
  title: string;
  description: string;
  price?: number | null;
  priceType: PriceType;
  status: string;
  moderationReason?: string | null;
  attributes?: Record<string, unknown> | null;
  city?: string | null;
  postalCode?: string | null;
  viewsCount: number;
  createdAt: string;
  publishedAt?: string | null;
  photos: ListingPhoto[];
  reports: Report[];
  owner: { id: string; displayName: string; phoneNumber: string; accountType: string; suspended: boolean } | null;
  transactions: Transaction[];
  category: { name: string; slug: string } | null;
}

export default function AdminListingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [l, setL] = useState<AdminListing | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<AdminListing>(`/admin/listings/${id}`)
        .then((d) => {
          setL(d);
          setTitle(d.title);
          setDescription(d.description);
          setReason(d.moderationReason ?? "");
        })
        .catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      await api(`/admin/listings/${id}`, { method: "PATCH", body });
      toast(ok, "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Retirer cette annonce ?", text: "Suppression définitive, ou simple désactivation si une transaction y est rattachée. Le motif saisi est transmis au vendeur.", confirmLabel: "Retirer l'annonce", danger: true }))) return;
    setBusy(true);
    try {
      await api(`/admin/listings/${id}?reason=${encodeURIComponent(reason || "Retirée par la modération")}`, { method: "DELETE" });
      toast("Annonce retirée.", "success");
      router.push("/admin/annonces");
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  if (error) return <div><Link href="/admin/annonces" className="mono">← Annonces</Link><div className="a-alert danger" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!l) return <div className="skeleton" style={{ height: 300 }} />;
  const s = statusPill(l.status);

  return (
    <div>
      <Link href="/admin/annonces" className="mono">← Annonces</Link>
      <div className="a-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{l.title} <span className={`a-pill ${s.cls}`}>{s.label}</span></h1>
          <p className="mono">{l.id} · {l.category?.name} · {formatPrice(l.price, l.priceType)} · {l.viewsCount} vues · créée {formatDateTime(l.createdAt)}</p>
        </div>
        <Link href={`/annonces/${l.id}`} className="a-btn" target="_blank">Voir sur le site ↗</Link>
      </div>
      {l.moderationReason && <div className="a-alert" style={{ background: "var(--a-warn-soft)", color: "#92400e" }}>Motif enregistré : {l.moderationReason}</div>}

      <div className="a-two">
        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Décision de modération</h2>
          <textarea className="a-textarea" aria-label="Motif de la décision (obligatoire pour un refus, transmis au vendeur)" placeholder="Motif (obligatoire pour un refus, transmis au vendeur)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {l.status !== "en_ligne" && <button className="a-btn ok" disabled={busy} onClick={() => patch({ status: "en_ligne" }, "Annonce publiée.")}>Approuver et publier</button>}
            {l.status !== "refusee" && <button className="a-btn danger" disabled={busy || reason.trim().length < 3} onClick={() => patch({ status: "refusee", moderationReason: reason.trim() }, "Annonce refusée.")}>Refuser</button>}
            {l.status === "en_ligne" && <button className="a-btn" disabled={busy} onClick={() => patch({ status: "desactivee", moderationReason: reason.trim() || "Mise en pause par la modération" }, "Annonce mise en pause.")}>Mettre en pause</button>}
            <button className="a-btn" disabled={busy} onClick={remove} style={{ color: "var(--a-danger)" }}>Supprimer</button>
          </div>
          <h2 className="h3">Vendeur</h2>
          {l.owner ? (
            <dl className="a-kv">
              <dt>Nom</dt><dd><Link href={`/admin/utilisateurs/${l.owner.id}`} style={{ textDecoration: "underline" }}>{l.owner.displayName}</Link> {l.owner.suspended && <span className="a-pill danger">Suspendu</span>}</dd>
              <dt>Téléphone</dt><dd className="mono">{l.owner.phoneNumber}</dd>
              <dt>Type</dt><dd>{statusPill(l.owner.accountType).label}</dd>
            </dl>
          ) : <p className="mono">Inconnu</p>}
        </section>
        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Corriger le contenu</h2>
          <label className="mono">Titre<input className="a-input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="mono" style={{ display: "block", marginTop: 8 }}>Description<textarea className="a-textarea" style={{ minHeight: 160 }} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <button className="a-btn primary" style={{ marginTop: 8 }} disabled={busy} onClick={() => patch({ title, description }, "Contenu corrigé.")}>Enregistrer la correction</button>
          {l.attributes && Object.keys(l.attributes).length > 0 && (
            <>
              <h2 className="h3">Critères</h2>
              <dl className="a-kv">{Object.entries(l.attributes).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
            </>
          )}
        </section>
      </div>

      <section className="a-panel" style={{ marginTop: 16 }}>
        <h2 className="h3" style={{ marginTop: 0 }}>Photos ({l.photos.length})</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {l.photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.id} src={mediaUrl(p.url)} alt="" style={{ width: 140, height: 105, objectFit: "cover", borderRadius: 6, border: "1px solid var(--a-line)" }} />
          ))}
          {l.photos.length === 0 && <span className="mono">Aucune photo.</span>}
        </div>
      </section>

      <div className="a-two" style={{ marginTop: 16 }}>
        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Signalements ({l.reports.length})</h2>
          {l.reports.length === 0 ? <p className="mono">Aucun.</p> : l.reports.map((r) => {
            const rs = statusPill(r.status);
            return (
              <div key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--a-line)", fontSize: ".86rem" }}>
                <span className={`a-pill ${rs.cls}`}>{rs.label}</span> <strong>{REPORT_REASON_LABELS[r.reason] || r.reason}</strong> <span className="mono">{formatDateTime(r.createdAt)}</span>
                {r.details && <div style={{ color: "var(--a-muted)" }}>{r.details}</div>}
              </div>
            );
          })}
        </section>
        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Transactions ({l.transactions.length})</h2>
          {l.transactions.length === 0 ? <p className="mono">Aucune.</p> : l.transactions.map((t) => {
            const ts = statusPill(t.status);
            return (
              <div key={t.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--a-line)", fontSize: ".86rem" }}>
                <span className={`a-pill ${ts.cls}`}>{ts.label}</span> {formatPrice(t.amount)} · <span className="mono">{formatDateTime(t.createdAt)}</span>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
