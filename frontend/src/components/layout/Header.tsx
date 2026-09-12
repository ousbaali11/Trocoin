"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { CategoryNode } from "@/lib/types";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { SearchBox } from "@/components/search/SearchBox";
import { Logo } from "./Logo";
import styles from "./Header.module.css";

/**
 * Barre de navigation publique (brief phase 2 §3) — ordre et libellés exacts :
 * Mes recherches · Favoris · Messages · Se connecter (ou menu compte) · Déposer une annonce.
 * Les pages personnelles déclenchent la connexion si besoin (retour à l'action ensuite).
 */
export function Header() {
  const { user, loading, unreadMessages, unreadNotifications, logout, requireAuth } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const catsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    setMobileOpen(false);
    setCatsOpen(false);
  }, [pathname]);

  useEffect(() => {
    api<CategoryNode[]>("/categories/tree", { revalidate: 3600 }).then(setTree).catch(() => setTree([]));
  }, []);

  useEffect(() => {
    if (!user) return setSavedCount(0);
    api<unknown[]>("/users/me/saved-searches").then((s) => setSavedCount(s.length)).catch(() => null);
  }, [user, pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (catsRef.current && !catsRef.current.contains(e.target as Node)) setCatsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  /** Lien personnel : connecté → page ; sinon → connexion avec retour. */
  const personal = (href: string) => (e: React.MouseEvent) => {
    if (!user) {
      e.preventDefault();
      requireAuth(href);
    }
  };

  const personalLinks = (
    <>
      <Link href="/compte/recherches" onClick={personal("/compte/recherches")} className={styles.navLink}>
        <BellIcon /> <span>Mes recherches</span>
        {savedCount > 0 && <span className={styles.badgeSoft}>{savedCount}</span>}
      </Link>
      <Link href="/compte/favoris" onClick={personal("/compte/favoris")} className={styles.navLink}>
        <HeartIcon /> <span>Favoris</span>
      </Link>
      <Link href="/compte/messages" onClick={personal("/compte/messages")} className={styles.navLink}>
        <MailIcon /> <span>Messages</span>
        {unreadMessages > 0 && <span className={styles.badge}>{unreadMessages > 99 ? "99+" : unreadMessages}</span>}
      </Link>
    </>
  );

  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.logo} aria-label="Trocoin, accueil">
          <Logo dark />
        </Link>

        <div className={styles.cats} ref={catsRef}>
          <button className={styles.catsBtn} onClick={() => setCatsOpen((o) => !o)} aria-expanded={catsOpen} aria-haspopup="true">
            <MenuIcon /> Catégories
          </button>
          {catsOpen && (
            <div className={styles.mega} role="menu">
              {tree.map((root) => (
                <div key={root.slug} className={styles.megaCol}>
                  <Link href={`/recherche?category=${root.slug}`} className={styles.megaRoot} role="menuitem">
                    <CategoryIcon name={root.icon} size={18} /> {root.name}
                  </Link>
                  {root.children.map((c) => (
                    <Link key={c.slug} href={`/recherche?category=${c.slug}`} className={styles.megaChild} role="menuitem">
                      {c.name}
                    </Link>
                  ))}
                  {root.children.length === 0 && <Link href={`/recherche?category=${root.slug}`} className={styles.megaChild}>Toutes les annonces</Link>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.search}>
          <SearchBox compact />
        </div>

        <nav className={styles.nav} aria-label="Navigation principale">
          {personalLinks}
          {!loading && !user && (
            <Link href={`/connexion?next=${encodeURIComponent(pathname === "/connexion" ? "/compte" : pathname)}`} className={`btn btn-outline ${styles.loginBtn}`}>
              Se connecter
            </Link>
          )}
          {user && (
            <div className={styles.userMenu} ref={menuRef}>
              <button className={styles.userBtn} onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-haspopup="menu">
                <span className={styles.avatar}>{user.displayName.slice(0, 1).toUpperCase()}</span>
                <span className={styles.userName}>{user.displayName}</span>
                {unreadNotifications > 0 && <span className={styles.badge}>{unreadNotifications}</span>}
              </button>
              {menuOpen && (
                <div className={styles.dropdown} role="menu">
                  <Link href="/compte" role="menuitem">Mon tableau de bord</Link>
                  <Link href="/compte/annonces" role="menuitem">Mes annonces</Link>
                  <Link href="/compte/notifications" role="menuitem">
                    Notifications {unreadNotifications > 0 && <span className={styles.badgeInline}>{unreadNotifications}</span>}
                  </Link>
                  <Link href="/compte/transactions" role="menuitem">Achats et ventes</Link>
                  <Link href="/compte/historique" role="menuitem">Annonces consultées</Link>
                  <Link href="/compte/parametres" role="menuitem">Paramètres</Link>
                  {user.accountType === "admin" && (
                    <Link href="/admin" role="menuitem" className={styles.adminLink}>Console d&apos;administration</Link>
                  )}
                  <button onClick={logout} role="menuitem">Se déconnecter</button>
                </div>
              )}
            </div>
          )}
          <Link href="/deposer" className={`btn btn-primary ${styles.deposit}`}>
            <PlusIcon /> Déposer une annonce
          </Link>
          <button className={styles.burger} onClick={() => setMobileOpen((o) => !o)} aria-label="Menu" aria-expanded={mobileOpen}>
            <span />
            <span />
            <span />
          </button>
        </nav>
      </div>

      {mobileOpen && (
        <div className={styles.mobileMenu}>
          <SearchBox onNavigate={() => setMobileOpen(false)} />
          <Link href="/deposer" className="btn btn-primary btn-block">Déposer une annonce</Link>
          <div className={styles.mobileLinks}>{personalLinks}</div>
          <details>
            <summary>Catégories</summary>
            <div className={styles.mobileCats}>
              {tree.map((root) => (
                <div key={root.slug}>
                  <Link href={`/recherche?category=${root.slug}`}><strong>{root.name}</strong></Link>
                  {root.children.map((c) => <Link key={c.slug} href={`/recherche?category=${c.slug}`}>{c.name}</Link>)}
                </div>
              ))}
            </div>
          </details>
          {user ? (
            <>
              <Link href="/compte">Mon tableau de bord</Link>
              <Link href="/compte/annonces">Mes annonces</Link>
              <Link href="/compte/parametres">Paramètres</Link>
              {user.accountType === "admin" && <Link href="/admin">Console d&apos;administration</Link>}
              <button className="btn btn-outline" onClick={logout}>Se déconnecter</button>
            </>
          ) : (
            <Link href="/connexion" className="btn btn-outline btn-block">Se connecter</Link>
          )}
        </div>
      )}
    </header>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0" />
    </svg>
  );
}
function HeartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.3 4.5 6.8 4.5c2 0 3.4 1.1 4.2 2.3.8-1.2 2.2-2.3 4.2-2.3 3.5 0 5.4 3.5 4.1 6.8C19.5 15.9 12 20.5 12 20.5z" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}
