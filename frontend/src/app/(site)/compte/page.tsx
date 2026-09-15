"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, LISTING_STATUS_LABELS } from "@/lib/format";
import type { ConversationSummary, ListingCard, Notification, Transaction } from "@/lib/types";
import { Rating } from "@/components/ui/Rating";

interface Stats {
  total: number;
  byStatus: Record<string, number>;
  views: number;
  favorites: number;
}

export default function DashboardPage() {
  const { user, unreadMessages } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [listings, setListings] = useState<ListingCard[]>([]);
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [convCount, setConvCount] = useState(0);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);

  useEffect(() => {
    api<Stats>("/listings/mine/stats").then(setStats).catch(() => null);
    api<ListingCard[]>("/listings/mine").then((l) => setListings(l.slice(0, 4))).catch(() => null);
    api<ConversationSummary[]>("/conversations").then((c) => { setConvCount(c.length); setConvs(c.slice(0, 4)); }).catch(() => null);
    api<Transaction[]>("/transactions/mine").then((t) => setTxs(t.filter((x) => ["sequestre", "livree", "litige"].includes(x.status)))).catch(() => null);
    api<Notification[]>("/notifications").then((n) => setNotifs(n.filter((x) => !x.readAt).slice(0, 4))).catch(() => null);
  }, []);

  if (!user) return null;
  const pendingActions = txs.length + (stats?.byStatus.en_attente ?? 0);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <p className="eyebrow">Tableau de bord</p>
          <h1>Bonjour {user.displayName}</h1>
          <div className="row small muted">
            <Rating value={user.ratingAvg} count={user.ratingCount} />
            <span>· Membre depuis le {formatDate(user.createdAt)}</span>
          </div>
        </div>
        <Link href="/deposer" className="btn btn-primary">Déposer une annonce</Link>
      </div>

      {(pendingActions > 0 || unreadMessages > 0) && (
        <div className="alert alert-info">
          {unreadMessages > 0 && <span><Link href="/compte/messages"><strong>{unreadMessages}</strong> message{unreadMessages > 1 ? "s" : ""} non lu{unreadMessages > 1 ? "s" : ""}</Link>. </span>}
          {txs.length > 0 && <span><Link href="/compte/transactions"><strong>{txs.length}</strong> transaction{txs.length > 1 ? "s" : ""} en cours</Link>. </span>}
          {(stats?.byStatus.en_attente ?? 0) > 0 && <span>{stats?.byStatus.en_attente} annonce(s) en vérification.</span>}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <Stat label="Annonces en ligne" value={stats?.byStatus.en_ligne ?? 0} href="/compte/annonces" />
        <Stat label="Vues cumulées" value={stats?.views ?? 0} />
        <Stat label="Mises en favori" value={stats?.favorites ?? 0} />
        <Stat label="Conversations" value={convCount} href="/compte/messages" />
      </div>

      <section className="panel">
        <div className="row spread" style={{ marginBottom: 12 }}>
          <h2 className="h3" style={{ margin: 0 }}>Mes dernières annonces</h2>
          <Link href="/compte/annonces" className="small">Tout voir</Link>
        </div>
        {listings.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Vous n&apos;avez pas encore d&apos;annonce. <Link href="/deposer">Déposez-en une</Link> en deux minutes.</p>
        ) : (
          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 0 }}>
            {listings.map((l) => (
              <li key={l.id} className="row spread" style={{ padding: "10px 0", borderBottom: "1px solid var(--line-soft)", gap: 8 }}>
                <Link href={`/annonces/${l.id}`} style={{ flex: "1 1 160px", minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</Link>
                <span className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                  <span className={LISTING_STATUS_LABELS[l.status].pill}>{LISTING_STATUS_LABELS[l.status].label}</span>
                  <span className="small muted" style={{ whiteSpace: "nowrap" }}>{l.viewsCount} vues</span>
                  <Link href={`/compte/annonces/${l.id}/modifier`} className="small" style={{ whiteSpace: "nowrap" }}>Modifier</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="dash-cols">
        <section className="panel">
          <div className="row spread" style={{ marginBottom: 12 }}>
            <h2 className="h3" style={{ margin: 0 }}>Messages récents</h2>
            <Link href="/compte/messages" className="small">Boîte de réception</Link>
          </div>
          {convs.length === 0 ? <p className="muted" style={{ margin: 0 }}>Aucune conversation.</p> : (
            <div className="stack">
              {convs.map((c) => (
                <Link key={c.id} href={`/compte/messages/${c.id}`} className="row spread" style={{ padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: "block" }}>{c.other?.displayName}</strong>
                    <span className="small muted">{c.listing?.title}</span>
                  </span>
                  {c.unreadCount > 0 && <span className="pill pill-brick">{c.unreadCount}</span>}
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="row spread" style={{ marginBottom: 12 }}>
            <h2 className="h3" style={{ margin: 0 }}>Notifications</h2>
            <Link href="/compte/notifications" className="small">Tout voir</Link>
          </div>
          {notifs.length === 0 ? <p className="muted" style={{ margin: 0 }}>Rien de nouveau.</p> : (
            <div className="stack">
              {notifs.map((n) => (
                <Link key={n.id} href={n.link || "/compte/notifications"} style={{ padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                  <strong style={{ display: "block", fontSize: ".92rem" }}>{n.title}</strong>
                  <span className="small muted">{n.body}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      <style>{`@media (max-width: 720px){ .dash-cols{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", fontWeight: 700, color: "var(--bottle)" }}>{value.toLocaleString("fr-FR")}</div>
      <div className="small muted">{label}</div>
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none" }}>{inner}</Link> : inner;
}
