"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { HardDeleteDialog } from "@/components/admin/HardDeleteDialog";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import { formatDate, formatDateTime, formatEuros, REPORT_REASON_LABELS } from "@/lib/format";
import type { ListingCard, Report, Review, Transaction } from "@/lib/types";
import { statusPill } from "@/components/admin/AdminPager";

interface AdminUserDetail {
  siretVerified?: boolean;
  siretVerifiedAt?: string | null;
  id: string;
  phoneNumber: string;
  displayName: string;
  accountType: "particulier" | "professionnel" | "admin";
  city?: string;
  postalCode?: string;
  shopName?: string;
  shopDescription?: string;
  siret?: string;
  ratingAvg: number;
  ratingCount: number;
  identityVerified: boolean;
  stripeConnected: boolean;
  stripeOnboardingComplete: boolean;
  suspended: boolean;
  suspensionReason?: string;
  deleted: boolean;
  createdAt: string;
  listings: ListingCard[];
  reportsAgainst: Report[];
  reportsByCount: number;
  transactions: Transaction[];
  reviews: Review[];
}

export default function AdminUserPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [u, setU] = useState<AdminUserDetail | null>(null);
  const [form, setForm] = useState({ displayName: "", city: "", postalCode: "", accountType: "particulier", identityVerified: false, shopName: "", siret: "" });
  const [reason, setReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<AdminUserDetail>(`/admin/users/${id}`)
        .then((d) => {
          setU(d);
          setForm({ displayName: d.displayName, city: d.city ?? "", postalCode: d.postalCode ?? "", accountType: d.accountType, identityVerified: d.identityVerified, shopName: d.shopName ?? "", siret: d.siret ?? "" });
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
      await api(`/admin/users/${id}`, { method: "PATCH", body });
      toast(ok, "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div><Link href="/admin/utilisateurs" className="mono">← Utilisateurs</Link><div className="a-alert danger" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!u) return <div className="skeleton" style={{ height: 300 }} />;
  const t = statusPill(u.accountType);

  return (
    <div>
      <Link href="/admin/utilisateurs" className="mono">← Utilisateurs</Link>
      <div className="a-head" style={{ marginTop: 8 }}>
        <div>
          <h1>{u.displayName} <span className={`a-pill ${t.cls}`}>{t.label}</span> {u.deleted && <span className="a-pill">Supprimé</span>} {u.suspended && <span className="a-pill danger">Suspendu</span>}</h1>
          <p className="mono">{u.id} · {u.phoneNumber} · inscrit le {formatDate(u.createdAt)}</p>
          {u.siret && <p className="small">SIRET {u.siret} · {u.siretVerified ? <span className="a-pill ok">vérifié au registre des entreprises{u.siretVerifiedAt ? ` le ${formatDate(u.siretVerifiedAt)}` : ""}</span> : <span className="a-pill danger">non vérifié au registre (registre indisponible à l'inscription ou compte antérieur)</span>}</p>}
        </div>
        <Link href={`/vendeurs/${u.id}`} className="a-btn" target="_blank">Profil public ↗</Link>
      </div>
      {u.suspended && <div className="a-alert danger">Compte suspendu — motif : {u.suspensionReason}</div>}

      <div className="a-two">
        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Suspension</h2>
          {u.suspended ? (
            <button className="a-btn ok" disabled={busy || u.deleted} onClick={() => patch({ suspended: false }, "Compte réactivé.")}>Réactiver le compte</button>
          ) : (
            <>
              <textarea className="a-textarea" aria-label="Motif de suspension (transmis à l'utilisateur)" placeholder="Motif de suspension (transmis à l'utilisateur)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="a-btn danger" style={{ marginTop: 8 }} disabled={busy || u.deleted || reason.trim().length < 3} onClick={async () => (await confirm({ title: "Suspendre ce compte ?", text: "Ses annonces seront mises en pause et le motif lui sera transmis.", confirmLabel: "Suspendre", danger: true })) && patch({ suspended: true, suspensionReason: reason.trim() }, "Compte suspendu.")}>Suspendre le compte</button>
            </>
          )}
          <h2 className="h3">Mot de passe</h2>
          {temp ? (
            <div className="a-alert">
              Mot de passe temporaire (affiché une seule fois) : <code className="mono" style={{ fontSize: "1.05rem", userSelect: "all" }}>{temp}</code>
              <br /><span className="small">Transmettez-le par un canal sûr ; l&apos;utilisateur devra le changer. Ses sessions ont été déconnectées.</span>
            </div>
          ) : (
            <button className="a-btn" disabled={busy || u.deleted} onClick={async () => {
              if (!(await confirm({ title: "Réinitialiser le mot de passe ?", text: "Un mot de passe temporaire sera généré et toutes les sessions de cet utilisateur seront déconnectées.", confirmLabel: "Générer" }))) return;
              setBusy(true);
              try {
                const r = await api<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`, { method: "POST" });
                setTemp(r.temporaryPassword);
                toast("Mot de passe temporaire généré.", "success");
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}>Réinitialiser le mot de passe</button>
          )}
          <h2 className="h3">Vérifications</h2>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: ".88rem" }}>
            <input type="checkbox" checked={form.identityVerified} disabled={busy || u.deleted} onChange={(e) => patch({ identityVerified: e.target.checked }, "Badge identité mis à jour.")} /> Identité vérifiée (badge public)
          </label>
          <dl className="a-kv" style={{ marginTop: 12 }}>
            <dt>Compte de versement</dt><dd>{u.stripeOnboardingComplete ? "Actif" : u.stripeConnected ? "Commencé" : "Non configuré"}</dd>
            <dt>Note</dt><dd>{u.ratingCount > 0 ? `${u.ratingAvg}/5 sur ${u.ratingCount} avis` : "Aucun avis"}</dd>
            <dt>Signalements émis</dt><dd>{u.reportsByCount}</dd>
            <dt>Signalements reçus</dt><dd>{u.reportsAgainst.length}</dd>
          </dl>
          <h2 className="h3" style={{ color: "var(--a-danger)" }}>Suppression définitive</h2>
          <p className="small" style={{ margin: "0 0 8px", color: "var(--a-muted)" }}>
            Irréversible : les ventes non expédiées sont annulées et remboursées, les annonces retirées, les données personnelles effacées (le numéro redevient utilisable). Refusée tant qu&apos;une vente expédiée (ou remise en attente de confirmation) ou un litige est en cours : suspendez le compte en attendant. Différent de la suspension, qui est réversible. Motif obligatoire, action journalisée.
          </p>
          <button className="a-btn danger" disabled={busy || u.deleted || u.accountType === "admin"} onClick={() => setDeleteOpen(true)} data-testid="delete-user">Supprimer définitivement ce compte</button>
          {u.accountType === "admin" && !u.deleted && <p className="small" style={{ margin: "6px 0 0", color: "var(--a-muted)" }}>Rétrogradez d&apos;abord ce compte administrateur.</p>}
          <HardDeleteDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            title="Supprimer définitivement ce compte ?"
            text={`${u.displayName} (${u.phoneNumber}) : ses ventes non expédiées seront annulées et remboursées, ses annonces retirées et ses données personnelles effacées. Une vente déjà expédiée (ou remise en attente de confirmation) ou un litige en cours bloque la suppression jusqu'à sa résolution. Cette action ne peut pas être annulée.`}
            confirmLabel="Supprimer le compte"
            onConfirm={async (reason) => {
              try {
                const r = await api<{ refundedTransactions: string[] }>(`/admin/users/${u.id}`, { method: "DELETE", body: { reason, confirm: "SUPPRIMER" } });
                toast(`Compte supprimé${r.refundedTransactions.length ? ` (${r.refundedTransactions.length} transaction(s) remboursée(s))` : ""}.`, "success");
                setDeleteOpen(false);
                router.push("/admin/utilisateurs");
              } catch (e) {
                toast((e as Error).message, "error");
              }
            }}
          />
        </section>

        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Modifier le compte</h2>
          <div style={{ display: "grid", gap: 8 }}>
            <label className="mono">Pseudo<input className="a-input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
            <label className="mono">Type de compte
              <select className="a-select" value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })}>
                <option value="particulier">Particulier</option><option value="professionnel">Professionnel</option><option value="admin">Administrateur</option>
              </select>
            </label>
            <label className="mono">Ville<input className="a-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
            <label className="mono">Code postal<input className="a-input" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} /></label>
            <label className="mono">Boutique<input className="a-input" value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} /></label>
            <label className="mono">SIRET<input className="a-input" value={form.siret} onChange={(e) => setForm({ ...form, siret: e.target.value })} /></label>
          </div>
          <button className="a-btn primary" style={{ marginTop: 10 }} disabled={busy || u.deleted} onClick={() => patch({ displayName: form.displayName, accountType: form.accountType, city: form.city || undefined, postalCode: form.postalCode || undefined, shopName: form.shopName || undefined, siret: form.siret || undefined }, "Compte mis à jour.")}>Enregistrer</button>
          {form.accountType === "admin" && u.accountType !== "admin" && <div className="a-alert danger" style={{ marginTop: 10 }}>Attention : vous vous apprêtez à donner tous les droits d&apos;administration à ce compte.</div>}
        </section>
      </div>

      <section className="a-panel" style={{ marginTop: 16 }}>
        <h2 className="h3" style={{ marginTop: 0 }}>Annonces ({u.listings.length})</h2>
        <table className="a-table">
          <thead><tr><th>Titre</th><th>Statut</th><th>Prix</th><th>Vues</th><th>Créée</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {u.listings.map((l) => {
              const s = statusPill(l.status);
              return (
                <tr key={l.id}><td>{l.title}</td><td><span className={`a-pill ${s.cls}`}>{s.label}</span></td><td>{l.price != null ? formatEuros(l.price) : l.priceType}</td><td>{l.viewsCount}</td><td>{formatDate(l.createdAt)}</td><td><Link href={`/admin/annonces/${l.id}`} className="a-btn">Ouvrir</Link></td></tr>
              );
            })}
            {u.listings.length === 0 && <tr><td colSpan={6} style={{ color: "var(--a-muted)" }}>Aucune annonce.</td></tr>}
          </tbody>
        </table>
      </section>

      <div className="a-two" style={{ marginTop: 16 }}>
        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Signalements reçus</h2>
          {u.reportsAgainst.length === 0 ? <p className="mono">Aucun.</p> : u.reportsAgainst.map((r) => {
            const s = statusPill(r.status);
            return (
              <div key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--a-line)", fontSize: ".86rem" }}>
                <span className={`a-pill ${s.cls}`}>{s.label}</span> <strong>{REPORT_REASON_LABELS[r.reason] || r.reason}</strong> <span className="mono">{formatDateTime(r.createdAt)}</span>
                {r.details && <div style={{ color: "var(--a-muted)" }}>{r.details}</div>}
              </div>
            );
          })}
        </section>
        <section className="a-panel">
          <h2 className="h3" style={{ marginTop: 0 }}>Transactions ({u.transactions.length})</h2>
          {u.transactions.length === 0 ? <p className="mono">Aucune.</p> : u.transactions.map((tx) => {
            const s = statusPill(tx.status);
            return (
              <div key={tx.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--a-line)", fontSize: ".86rem" }}>
                <span className={`a-pill ${s.cls}`}>{s.label}</span> {formatEuros(tx.amount)} · {tx.buyerId === u.id ? "achat" : "vente"} · <span className="mono">{formatDateTime(tx.createdAt)}</span>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
