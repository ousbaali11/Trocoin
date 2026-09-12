"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const items = [
  { href: "/compte", label: "Tableau de bord", exact: true },
  { href: "/compte/annonces", label: "Mes annonces" },
  { href: "/compte/messages", label: "Messages", counter: "messages" },
  { href: "/compte/notifications", label: "Notifications", counter: "notifications" },
  { href: "/compte/favoris", label: "Favoris" },
  { href: "/compte/recherches", label: "Mes recherches" },
  { href: "/compte/historique", label: "Annonces consultées" },
  { href: "/compte/transactions", label: "Achats et ventes" },
  { href: "/compte/avis", label: "Avis" },
  { href: "/compte/boutique", label: "Ma boutique", pro: true },
  { href: "/compte/formule", label: "Formule" },
  { href: "/compte/paiements", label: "Paiements" },
  { href: "/compte/parametres", label: "Paramètres" },
];

export function AccountNav() {
  const pathname = usePathname();
  const { user, unreadMessages, unreadNotifications } = useAuth();
  return (
    <nav aria-label="Mon compte" className="card" style={{ padding: 10, position: "sticky", top: "calc(var(--header-h) + 16px)" }}>
      <div style={{ padding: "8px 12px 12px", borderBottom: "1px solid var(--line-soft)", marginBottom: 6 }}>
        <strong style={{ display: "block" }}>{user?.displayName}</strong>
        <span className="small muted">{user?.accountType === "professionnel" ? "Compte professionnel" : user?.accountType === "admin" ? "Administrateur" : "Compte particulier"}</span>
      </div>
      {items
        .filter((it) => !it.pro || user?.accountType === "professionnel")
        .map((it) => {
          const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
          const count = it.counter === "messages" ? unreadMessages : it.counter === "notifications" ? unreadNotifications : 0;
          return (
            <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", borderRadius: 6, fontWeight: active ? 700 : 500, background: active ? "var(--accent-tint)" : undefined, color: active ? "var(--accent-dark)" : undefined, fontSize: ".93rem", minHeight: 38 }}>
              {it.label}
              {count > 0 && <span className="pill pill-brick">{count}</span>}
            </Link>
          );
        })}
      <Link href="/deposer" className="btn btn-primary btn-block" style={{ marginTop: 10 }}>Déposer une annonce</Link>
    </nav>
  );
}
