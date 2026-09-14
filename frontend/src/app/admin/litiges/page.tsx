"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import { DELIVERY_LABELS, formatDateTime, formatEuros } from "@/lib/format";
import type { Paged } from "@/lib/types";
import { AdminPager, statusPill } from "@/components/admin/AdminPager";

interface AdminTx {
  id: string;
  amount: number;
  commission: number;
  buyerFee: number;
  status: string;
  deliveryMethod: "main_propre" | "colissimo" | "mondial_relay";
  deliveryTrackingNumber?: string | null;
  disputeReason?: string | null;
  disputeOpenedBy?: string | null;
  resolutionNote?: string | null;
  createdAt: string;
  shippedAt?: string | null;
  buyer: { id: string; displayName: string } | null;
  seller: { id: string; displayName: string } | null;
  listing: { id: string; title: string } | null;
}

export default function AdminDisputesPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState("litige");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AdminTx> | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page), page_size: "25" });
    if (status) p.set("status", status);
    setError(null);
    return api<Paged<AdminTx>>(`/admin/transactions?${p}`).then(setData).catch((e) => setError((e as Error).message));
  }, [status, page]);
  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (t: AdminTx, decision: "rembourser" | "liberer") => {
    const note = notes[t.id]?.trim() || "";
    if (note.length < 5) return toast("Une note d'au moins 5 caractères est requise.", "error");
    if (!(await confirm({ title: decision === "rembourser" ? "Rembourser intégralement l'acheteur ?" : "Libérer les fonds au vendeur ?", text: "La décision et votre note seront transmises aux deux parties. Elle est définitive.", confirmLabel: decision === "rembourser" ? "Rembourser" : "Libérer les fonds", danger: decision === "rembourser" }))) return;
    setBusy(t.id);
    try {
      await api(`/admin/transactions/${t.id}/resolve`, { method: "POST", body: { decision, note } });
      toast("Litige tranché.", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="a-head"><div><h1>Transactions et litiges</h1><p>Vue globale du paiement sécurisé. Un litige se tranche par remboursement de l&apos;acheteur ou libération des fonds au vendeur.</p></div></div>
      <div className="a-filters">
        <select className="a-select" aria-label="État des transactions" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="litige">Litiges en cours</option><option value="sequestre">Séquestre</option><option value="livree">Expédiées</option><option value="confirme">Terminées</option><option value="rembourse">Remboursées</option><option value="annulee">Annulées</option><option value="">Toutes</option>
        </select>
      </div>
      {error && <div className="a-alert danger">{error}</div>}
      {!data && !error && <div className="a-panel a-loading">Chargement…</div>}
      <div style={{ display: "grid", gap: 12 }}>
        {data?.items.map((t) => {
          const s = statusPill(t.status);
          return (
            <div key={t.id} className="a-panel">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: ".9rem" }}>
                  <span className={`a-pill ${s.cls}`}>{s.label}</span> <strong>{t.listing ? <Link href={`/admin/annonces/${t.listing.id}`} style={{ textDecoration: "underline" }}>{t.listing.title}</Link> : "Annonce supprimée"}</strong>
                  <span className="mono"> · {t.id.slice(0, 8)} · {formatDateTime(t.createdAt)}</span>
                  <dl className="a-kv" style={{ marginTop: 8 }}>
                    <dt>Montant</dt><dd>{formatEuros(t.amount)} (frais acheteur {formatEuros(t.buyerFee)}, commission {formatEuros(t.commission)})</dd>
                    <dt>Acheteur</dt><dd>{t.buyer ? <Link href={`/admin/utilisateurs/${t.buyer.id}`} style={{ textDecoration: "underline" }}>{t.buyer.displayName}</Link> : "—"}</dd>
                    <dt>Vendeur</dt><dd>{t.seller ? <Link href={`/admin/utilisateurs/${t.seller.id}`} style={{ textDecoration: "underline" }}>{t.seller.displayName}</Link> : "—"}</dd>
                    <dt>Remise</dt><dd>{DELIVERY_LABELS[t.deliveryMethod]}{t.deliveryTrackingNumber && ` · suivi ${t.deliveryTrackingNumber}`}{t.shippedAt && ` · expédiée ${formatDateTime(t.shippedAt)}`}</dd>
                    {t.disputeReason && <><dt>Litige</dt><dd>« {t.disputeReason} » — ouvert par {t.disputeOpenedBy === t.buyer?.id ? "l'acheteur" : "le vendeur"}</dd></>}
                    {t.resolutionNote && <><dt>Décision</dt><dd>{t.resolutionNote}</dd></>}
                  </dl>
                </div>
                {t.status === "litige" && (
                  <div style={{ minWidth: 300, display: "grid", gap: 6 }}>
                    <textarea className="a-textarea" aria-label="Note de décision (transmise aux deux parties)" placeholder="Note de décision (transmise aux deux parties)" value={notes[t.id] || ""} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="a-btn danger" disabled={busy === t.id} onClick={() => resolve(t, "rembourser")}>Rembourser l&apos;acheteur</button>
                      <button className="a-btn ok" disabled={busy === t.id} onClick={() => resolve(t, "liberer")}>Libérer au vendeur</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {data && data.items.length === 0 && <div className="a-panel mono">{status === "litige" ? "Aucun litige en cours." : "Aucune transaction dans cet état."}</div>}
      </div>
      {data && <AdminPager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </div>
  );
}
