"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Stats {
  reports: { open: number };
  transactions: { disputes: number };
  listings: { pending: number };
}

const NAV = [
  { href: "/admin", label: "Tableau de bord", exact: true },
  { href: "/admin/annonces", label: "Annonces", counter: "pending" },
  { href: "/admin/signalements", label: "Signalements", counter: "reports" },
  { href: "/admin/litiges", label: "Transactions et litiges", counter: "disputes" },
  { href: "/admin/utilisateurs", label: "Utilisateurs" },
  { href: "/admin/reglages", label: "Monétisation et formules" },
  { href: "/admin/pages", label: "Pages légales (CMS)" },
  { href: "/admin/journal", label: "Journal d'audit" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    api<Stats>("/admin/stats").then(setStats).catch(() => null);
  }, [pathname]);

  const counter = (k?: string) =>
    (k === "pending" ? stats?.listings.pending : k === "reports" ? stats?.reports.open : k === "disputes" ? stats?.transactions.disputes : 0) || 0;

  return (
    <div className="admin">
      <aside className="admin-side">
        <div className="admin-brand">Trocoin <span>ADMIN</span></div>
        {NAV.map((n) => {
          const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
          const c = counter(n.counter);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}>
              {n.label}
              {c > 0 && <span className="a-pill danger">{c}</span>}
            </Link>
          );
        })}
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
        <div className="admin-topbar">CONSOLE D&apos;ADMINISTRATION — toutes les actions sont journalisées et traçables</div>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
