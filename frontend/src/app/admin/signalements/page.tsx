"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { formatDateTime, REPORT_REASON_LABELS } from "@/lib/format";
import type { Paged, Report } from "@/lib/types";
import { AdminPager, statusPill } from "@/components/admin/AdminPager";

export default function AdminReportsPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState("ouvert");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Report> | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page), page_size: "25" });
    if (status) p.set("status", status);
    return api<Paged<Report>>(`/admin/reports?${p}`).then(setData).catch(() => null);
  }, [status, page]);
  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (r: Report, decision: "traite" | "rejete") => {
    setBusy(r.id);
    try {
      await api(`/admin/reports/${r.id}`, { method: "PATCH", body: { status: decision, note: notes[r.id]?.trim() || undefined, action: decision === "traite" ? actions[r.id] || "aucune" : undefined } });
      toast(decision === "traite" ? "Signalement traité." : "Signalement rejeté.", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="a-head"><div><h1>Signalements</h1><p>File de modération. Traiter = infraction constatée (avec action éventuelle) ; rejeter = rien à signaler.</p></div></div>
      <div className="a-filters">
        <select className="a-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="ouvert">Ouverts</option><option value="traite">Traités</option><option value="rejete">Rejetés</option><option value="">Tous</option>
        </select>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {data?.items.map((r) => {
          const s = statusPill(r.status);
          return (
            <div key={r.id} className="a-panel">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <span className={`a-pill ${s.cls}`}>{s.label}</span> <strong>{REPORT_REASON_LABELS[r.reason] || r.reason}</strong>
                  <span className="mono"> · {formatDateTime(r.createdAt)} · par {r.reporter?.displayName}</span>
                  {r.details && <p style={{ margin: "6px 0 0", fontSize: ".9rem" }}>{r.details}</p>}
                  <div style={{ marginTop: 6, fontSize: ".86rem" }}>
                    {r.listing && <>Annonce : <Link href={`/admin/annonces/${r.listing.id}`} style={{ textDecoration: "underline" }}>{r.listing.title}</Link> <span className={`a-pill ${statusPill(r.listing.status).cls}`}>{statusPill(r.listing.status).label}</span> · </>}
                    {r.reportedUser && <>Utilisateur visé : <Link href={`/admin/utilisateurs/${r.reportedUser.id}`} style={{ textDecoration: "underline" }}>{r.reportedUser.displayName}</Link> {r.reportedUser.suspended && <span className="a-pill danger">Suspendu</span>}</>}
                    {r.conversationId && <> · conversation <span className="mono">{r.conversationId.slice(0, 8)}</span></>}
                  </div>
                  {r.resolutionNote && <p className="mono" style={{ margin: "6px 0 0" }}>Décision : {r.resolutionNote}</p>}
                </div>
                {r.status === "ouvert" && (
                  <div style={{ minWidth: 300, display: "grid", gap: 6 }}>
                    <select className="a-select" value={actions[r.id] || "aucune"} onChange={(e) => setActions({ ...actions, [r.id]: e.target.value })}>
                      <option value="aucune">Aucune action associée</option>
                      {r.listingId && <option value="retirer_annonce">Retirer l&apos;annonce</option>}
                      {r.reportedUserId && <option value="suspendre_utilisateur">Suspendre l&apos;utilisateur</option>}
                      {r.listingId && r.reportedUserId && <option value="retirer_et_suspendre">Retirer l&apos;annonce ET suspendre</option>}
                    </select>
                    <input className="a-input" placeholder="Note (transmise aux parties)" value={notes[r.id] || ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="a-btn danger" disabled={busy === r.id} onClick={() => resolve(r, "traite")}>Traiter</button>
                      <button className="a-btn" disabled={busy === r.id} onClick={() => resolve(r, "rejete")}>Rejeter</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {data && data.items.length === 0 && <div className="a-panel mono">Aucun signalement.</div>}
      </div>
      {data && <AdminPager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </div>
  );
}
