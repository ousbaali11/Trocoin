"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Paged } from "@/lib/types";
import { AdminPager } from "@/components/admin/AdminPager";

interface AuditEntry {
  id: string;
  adminId: string;
  adminName?: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

export default function AdminAuditPage() {
  const [action, setAction] = useState("");
  const [target, setTarget] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AuditEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams({ page: String(page), page_size: "50" });
    if (action) p.set("action", action);
    if (target) p.set("target_id", target);
    setError(null);
    api<Paged<AuditEntry>>(`/admin/audit-log?${p}`).then(setData).catch((e) => setError((e as Error).message));
  }, [action, target, page]);

  return (
    <div>
      <div className="a-head"><div><h1>Journal d&apos;audit</h1><p>Chaque action d&apos;administration (qui, quoi, quand, sur quelle ressource). Lecture seule.</p></div></div>
      <div className="a-filters">
        <select className="a-select" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">Toutes les actions</option><option value="user">Utilisateurs</option><option value="listing">Annonces</option><option value="report">Signalements</option><option value="transaction">Transactions</option>
        </select>
        <input className="a-input" placeholder="Identifiant de la ressource" value={target} onChange={(e) => { setTarget(e.target.value); setPage(1); }} />
      </div>
      {error && <div className="a-alert danger">{error}</div>}
      <div className="a-panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="a-table">
          <thead><tr><th>Date</th><th>Administrateur</th><th>Action</th><th>Ressource</th><th>Détails</th><th>IP</th></tr></thead>
          <tbody>
            {data?.items.map((e) => (
              <tr key={e.id}>
                <td className="mono">{formatDateTime(e.createdAt)}</td>
                <td>{e.adminName || e.adminId}<br /><span className="mono">{e.adminId.slice(0, 8)}</span></td>
                <td><span className="a-pill accent">{e.action}</span></td>
                <td className="mono">{e.targetType} {e.targetId.slice(0, 8)}</td>
                <td className="mono" style={{ maxWidth: 420, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{e.details ? JSON.stringify(e.details) : "—"}</td>
                <td className="mono">{e.ip || "—"}</td>
              </tr>
            ))}
            {!data && !error && <tr><td colSpan={6} className="a-loading">Chargement…</td></tr>}
            {data && data.items.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--a-muted)" }}>Aucune entrée pour ces filtres.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && <AdminPager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </div>
  );
}
