"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ResendVerificationButton } from "./ResendVerificationButton";

/**
 * Rappel affiché dans l'espace compte tant que l'adresse e-mail n'est pas confirmée.
 * Le compte reste utilisable : le rappel n'empêche rien (voir AUDIT.md §18).
 */
export function EmailVerificationBanner() {
  const { user } = useAuth();
  const pathname = usePathname();
  if (!user || !user.email || user.emailVerified) return null;
  const onSettings = pathname?.startsWith("/compte/parametres");
  return (
    <div className="alert alert-info email-banner" role="status" data-testid="email-verification-banner" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", marginBottom: 20, minWidth: 0 }}>
      <span style={{ flex: "1 1 240px", minWidth: 0, overflowWrap: "anywhere" }}>
        <strong>Confirmez votre adresse e-mail.</strong> <span className="email-banner-detail">Un lien vous a été envoyé à {user.email}. Pensez à vérifier vos courriers indésirables.</span>
      </span>
      {onSettings ? <Link href="#identifiants" className="btn btn-outline btn-sm">Voir mes identifiants</Link> : <ResendVerificationButton size="sm" />}
    </div>
  );
}
