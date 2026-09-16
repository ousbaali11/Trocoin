"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Stats {
  reports: { open: number };
  transactions: { disputes: number; escrowDueSoon: number };
  listings: { pending: number };
}

type Counter = "pending" | "reports" | "disputes" | "escrow";
interface NavItem { href: string; label: string; exact?: boolean; counter?: Counter }

/**
 * Navigation de la console (audit admin, étape 3) : entrées regroupées par domaine —
 * vue d'ensemble, comptes, annonces, transactions et litiges, configuration, journal.
 * Les compteurs signalent le travail en attente (annonces à vérifier, signalements, litiges, séquestres à échéance).
 */
const GROUPS: Array<{ title: string; items: NavItem[] }> = [
  { title: "Vue d'ensemble", items: [{ href: "/admin", label: "Tableau de bord", exact: true }] },
  { title: "Comptes", items: [{ href: "/admin/utilisateurs", label: "Utilisateurs" }] },
  {
    title: "Annonces",
    items: [
      { href: "/admin/annonces", label: "Annonces", counter: "pending" },
      { href: "/admin/signalements", label: "Signalements", counter: "reports" },
    ],
  },
  {
    title: "Transactions",
    items: [{ href: "/admin/litiges", label: "Transactions et litiges", counter: "disputes" }],
  },
  {
    title: "Configuration",
    items: [
      { href: "/admin/reglages", label: "Monétisation et formules" },
      { href: "/admin/pages", label: "Pages légales (CMS)" },
    ],
  },
  { title: "Traçabilité", items: [{ href: "/admin/journal", label: "Journal d'audit" }] },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    api<Stats>("/admin/stats").then(setStats).catch(() => null);
  }, [pathname]);

  const counter = (k?: Counter) =>
    (k === "pending" ? stats?.listings.pending : k === "reports" ? stats?.reports.open : k === "disputes" ? (stats?.transactions.disputes ?? 0) + (stats?.transactions.escrowDueSoon ?? 0) : 0) || 0;

  return (
    <div className="admin">
      <aside className="admin-side" aria-label="Navigation de la console">
        <div className="admin-brand">Trocoin <span>ADMIN</span></div>
        {GROUPS.map((g) => (
          <div key={g.title} className="admin-nav-group">
            <div className="admin-nav-title">{g.title}</div>
            {g.items.map((n) => {
              const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
              const c = counter(n.counter);
              return (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}>
                  {n.label}
                  {c > 0 && <span className="a-pill danger" title={n.counter === "disputes" ? "Litiges en cours et séquestres à échéance" : undefined}>{c}</span>}
                </Link>
              );
            })}
          </div>
        ))}
        <Link href="/" style={{ marginTop: 8 }}>← Retour au site public</Link>
        <div className="foot">
          Connecté : <strong style={{ color: "#fff" }}>{user?.displayName}</strong>
          <br />
          <span className="mono" style={{ color: "#94a3b8" }}>{user?.id.slice(0, 8)}</span>
          <br />
          <button className="a-btn" style={{ marginTop: 8 }} onClick={logout}>Se déconnecter</button>
        </div>
      </aside>
      <div className="admin-body">
        <header className="admin-topbar">CONSOLE D&apos;ADMINISTRATION — toutes les actions sont journalisées et traçables</header>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
