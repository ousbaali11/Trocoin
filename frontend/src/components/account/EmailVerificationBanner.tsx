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
    <div className="alert alert-info" role="status" data-testid="email-verification-banner" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", marginBottom: 20 }}>
      <span style={{ flex: "1 1 260px" }}>
        <strong>Confirmez votre adresse e-mail.</strong> Un lien vous a été envoyé à {user.email}. Pensez à vérifier vos courriers indésirables.
      </span>
      {onSettings ? <Link href="#identifiants" className="btn btn-outline btn-sm">Voir mes identifiants</Link> : <ResendVerificationButton size="sm" />}
    </div>
  );
}
