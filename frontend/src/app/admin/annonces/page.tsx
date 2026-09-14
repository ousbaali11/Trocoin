"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import type { CategoryNode, ListingCard, Paged } from "@/lib/types";
import { AdminPager, statusPill } from "@/components/admin/AdminPager";

function AdminListingsInner() {
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(params.get("flagged") === "true" ? "en_attente" : "");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [data, setData] = useState<Paged<ListingCard> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CategoryNode[]>("/categories/tree").then(setTree).catch(() => null);
  }, []);
  useEffect(() => {
    const p = new URLSearchParams({ page: String(page), page_size: "25" });
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    if (category) p.set("category", category);
    setError(null);
    api<Paged<ListingCard>>(`/admin/listings?${p}`).then(setData).catch((e) => setError((e as Error).message));
  }, [q, status, category, page]);

  return (
    <div>
      <div className="a-head"><div><h1>Annonces</h1><p>Toutes les annonces, tous statuts. Les annonces « à vérifier » ont été bloquées par la pré-modération automatique.</p></div></div>
      <div className="a-filters">
        <input className="a-input" placeholder="Titre, description ou identifiant" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="a-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Tous statuts</option>
          {["en_attente", "en_ligne", "brouillon", "vendue", "refusee", "expiree", "desactivee"].map((s) => <option key={s} value={s}>{statusPill(s).label}</option>)}
        </select>
        <select className="a-select" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          <option value="">Toutes catégories</option>
          {tree.map((r) => <optgroup key={r.slug} label={r.name}><option value={r.slug}>Tout {r.name}</option>{r.children.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</optgroup>)}
        </select>
      </div>
      {error && <div className="a-alert danger">{error}</div>}
      <div className="a-panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="a-table">
          <thead><tr><th></th><th>Annonce</th><th>Vendeur</th><th>Prix</th><th>Statut</th><th>Créée</th><th></th></tr></thead>
          <tbody>
            {data?.items.map((l) => {
              const s = statusPill(l.status);
              const st = statusPill(l.seller?.accountType || "");
              return (
                <tr key={l.id}>
                  <td style={{ width: 56 }}>{l.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl(l.coverUrl)} alt="" style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 4 }} />
                  ) : <span className="mono">—</span>}</td>
                  <td><strong>{l.title}</strong><br /><span className="mono">{l.categoryName} · {l.city || "—"} · {l.id.slice(0, 8)}</span>{l.moderationReason && <div style={{ color: "var(--a-warn)", fontSize: ".8rem" }}>{l.moderationReason}</div>}</td>
                  <td>{l.seller?.displayName}<br /><span className={`a-pill ${st.cls}`}>{st.label}</span></td>
                  <td>{formatPrice(l.price, l.priceType)}</td>
                  <td><span className={`a-pill ${s.cls}`}>{s.label}</span></td>
                  <td>{formatDate(l.createdAt)}</td>
                  <td><Link href={`/admin/annonces/${l.id}`} className="a-btn">Ouvrir</Link></td>
                </tr>
              );
            })}
            {!data && !error && <tr><td colSpan={7} className="a-loading">Chargement…</td></tr>}
            {data && data.items.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--a-muted)" }}>Aucune annonce ne correspond à ces filtres.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && <AdminPager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </div>
  );
}

export default function AdminListingsPage() {
  return <Suspense><AdminListingsInner /></Suspense>;
}
