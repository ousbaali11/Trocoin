"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast-context";

/**
 * Bouton « Renvoyer l'e-mail de confirmation » : désactivé 60 s après un envoi (même règle que le
 * serveur). Le résultat du dernier clic reste affiché sous le bouton (heure d'envoi ou raison du
 * refus) : le message furtif en bas d'écran disparaît en quelques secondes et pouvait passer inaperçu.
 */
export function ResendVerificationButton({ size }: { size?: "sm" }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    setBusy(true);
    try {
      const res = await api<{ ok: true; email: string }>("/auth/email/resend", { method: "POST" });
      const at = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      setStatus({ kind: "ok", text: `E-mail envoyé à ${res.email} à ${at}. Ouvrez le lien qu'il contient ; s'il n'arrive pas dans les minutes qui suivent, regardez vos courriers indésirables.` });
      toast(`E-mail envoyé à ${res.email}. Ouvrez le lien qu'il contient pour confirmer votre adresse.`, "success");
      setCooldown(60);
    } catch (err) {
      let message = err instanceof ApiError ? err.message : "Envoi impossible pour le moment.";
      if (err instanceof ApiError && err.status === 429) message = "Trop de demandes : au plus 3 e-mails de confirmation par heure. Vérifiez votre boîte et vos courriers indésirables, puis réessayez plus tard.";
      setStatus({ kind: "error", text: message });
      toast(message, "error");
      if (err instanceof ApiError && err.status === 400 && /Patientez/.test(err.message)) setCooldown(60);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={`btn btn-outline${size === "sm" ? " btn-sm" : ""}`} onClick={resend} disabled={busy || cooldown > 0}>
        {busy ? "Envoi…" : cooldown > 0 ? `Renvoyer dans ${cooldown} s` : "Renvoyer l'e-mail de confirmation"}
      </button>
      {status && (
        <p className={`small ${status.kind === "error" ? "form-error" : ""}`} style={{ margin: "8px 0 0", color: status.kind === "error" ? "var(--brick)" : "var(--accent-dark)" }} role="status" data-testid="resend-status">
          {status.text}
        </p>
      )}
    </>
  );
}
