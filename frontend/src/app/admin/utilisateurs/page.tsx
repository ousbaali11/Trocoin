"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Paged } from "@/lib/types";
import { AdminPager, statusPill } from "@/components/admin/AdminPager";

interface AdminUser {
  id: string;
  phoneNumber: string;
  displayName: string;
  accountType: string;
  city?: string;
  shopName?: string;
  siret?: string;
  ratingAvg: number;
  ratingCount: number;
  identityVerified: boolean;
  suspended: boolean;
  deleted: boolean;
  createdAt: string;
}

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AdminUser> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams({ page: String(page), page_size: "25" });
    if (q) p.set("q", q);
    if (type) p.set("account_type", type);
    if (status) p.set("status", status);
    setError(null);
    api<Paged<AdminUser>>(`/admin/users?${p}`).then(setData).catch((e) => setError((e as Error).message));
  }, [q, type, status, page]);

  return (
    <div>
      <div className="a-head">
        <div><h1>Utilisateurs</h1><p>Recherche par téléphone, pseudo, SIRET, boutique ou identifiant.</p></div>
      </div>
      <div className="a-filters">
        <input className="a-input" placeholder="Rechercher…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="a-select" aria-label="Type de compte" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">Tous types</option><option value="particulier">Particuliers</option><option value="professionnel">Professionnels</option><option value="admin">Administrateurs</option>
        </select>
        <select className="a-select" aria-label="État du compte" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Tous statuts</option><option value="actif">Actifs</option><option value="suspendu">Suspendus</option>
        </select>
      </div>
      {error && <div className="a-alert danger">{error}</div>}
      <div className="a-panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="a-table">
          <thead><tr><th>Utilisateur</th><th>Téléphone</th><th>Type</th><th>Ville</th><th>Note</th><th>État</th><th>Inscrit le</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data?.items.map((u) => {
              const t = statusPill(u.accountType);
              return (
                <tr key={u.id}>
                  <td><strong>{u.displayName}</strong>{u.shopName && <><br /><span className="mono">{u.shopName}</span></>}<br /><span className="mono">{u.id}</span></td>
                  <td className="mono">{u.phoneNumber}</td>
                  <td><span className={`a-pill ${t.cls}`}>{t.label}</span>{u.identityVerified && <> <span className="a-pill ok">ID</span></>}</td>
                  <td>{u.city || "—"}</td>
                  <td>{u.ratingCount > 0 ? `${u.ratingAvg}/5 (${u.ratingCount})` : "—"}</td>
                  <td>{u.deleted ? <span className="a-pill">Supprimé</span> : u.suspended ? <span className="a-pill danger">Suspendu</span> : <span className="a-pill ok">Actif</span>}</td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td><Link href={`/admin/utilisateurs/${u.id}`} className="a-btn">Ouvrir</Link></td>
                </tr>
              );
            })}
            {!data && !error && <tr><td colSpan={8} className="a-loading">Chargement…</td></tr>}
            {data && data.items.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--a-muted)" }}>Aucun utilisateur ne correspond à ces filtres.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && <AdminPager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </div>
  );
}
