"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

/**
 * Enveloppe les pages réservées aux utilisateurs connectés : si aucun compte
 * n'est chargé, redirige vers la connexion en mémorisant la page visée.
 * `admin` restreint en plus au rôle administrateur (l'API vérifie de son côté).
 */
export function RequireAuth({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const next = window.location.pathname + window.location.search;
      router.replace(`/connexion?next=${encodeURIComponent(next)}`);
    } else if (admin && user.accountType !== "admin") {
      router.replace("/");
    }
  }, [loading, user, admin, router]);

  if (loading || !user || (admin && user.accountType !== "admin")) {
    return (
      <div className="container page">
        <div className="skeleton" style={{ height: 32, width: 240, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 180 }} />
      </div>
    );
  }
  return <>{children}</>;
}
