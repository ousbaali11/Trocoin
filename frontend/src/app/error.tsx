"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Frontière d'erreur du site (AUDIT §69) : une API en veille ou en panne affichait la page d'erreur anglaise de Next.js,
 * sans en-tête ni bouton. Ici : message en français, « Réessayer » (relance le rendu) et retour à l'accueil.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page] erreur de rendu :", error.message);
  }, [error]);
  return (
    <div className="container page" style={{ maxWidth: 560, textAlign: "center", paddingTop: 48 }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem" }}>Un petit contretemps</h1>
      <p className="muted">Le serveur met quelques secondes à se réveiller ou ne répond pas pour le moment. Vos données ne sont pas perdues.</p>
      <div className="row" style={{ justifyContent: "center", gap: 12, marginTop: 20 }}>
        <button type="button" className="btn btn-primary" onClick={() => reset()}>Réessayer</button>
        <Link href="/" className="btn btn-outline">Retour à l&apos;accueil</Link>
      </div>
    </div>
  );
}
