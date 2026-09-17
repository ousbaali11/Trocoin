"use client";

/**
 * Échec de chargement d'un bloc (AUDIT §60) : un message et un bouton « Réessayer », à la place d'un squelette
 * qui pulsait indéfiniment quand la requête échouait (réseau coupé, API en réveil) — l'utilisateur ne savait
 * pas qu'il fallait recharger.
 */
export function LoadError({ message, onRetry, admin = false }: { message?: string; onRetry: () => void; admin?: boolean }) {
  return (
    <div className={admin ? "a-alert danger" : "alert alert-error"} role="alert" data-testid="load-error" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
      <span>{message || "Le chargement a échoué. Vérifiez votre connexion."}</span>
      <button type="button" className={admin ? "a-btn" : "btn btn-outline btn-sm"} onClick={onRetry}>Réessayer</button>
    </div>
  );
}
