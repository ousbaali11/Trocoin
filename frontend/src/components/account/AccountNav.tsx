"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import styles from "./AccountNav.module.css";

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
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Mobile : le lien actif est ramené dans la zone visible du bandeau
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <nav aria-label="Mon compte" className={`card ${styles.nav}`} data-full-bleed>
      <div className={styles.who}>
        <strong style={{ display: "block" }}>{user?.displayName}</strong>
        <span className="small muted">{user?.accountType === "professionnel" ? "Compte professionnel" : user?.accountType === "admin" ? "Administrateur" : "Compte particulier"}</span>
      </div>
      {items
        .filter((it) => !it.pro || user?.accountType === "professionnel")
        .map((it) => {
          const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
          const count = it.counter === "messages" ? unreadMessages : it.counter === "notifications" ? unreadNotifications : 0;
          return (
            <Link key={it.href} href={it.href} ref={active ? activeRef : undefined} aria-current={active ? "page" : undefined} className={`${styles.link} ${active ? styles.active : ""}`}>
              {it.label}
              {count > 0 && <span className="pill pill-brick">{count}</span>}
            </Link>
          );
        })}
      <Link href="/deposer" className={`btn btn-primary btn-block ${styles.deposit}`}>Déposer une annonce</Link>
    </nav>
  );
}
