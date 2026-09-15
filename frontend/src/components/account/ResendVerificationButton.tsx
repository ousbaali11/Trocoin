"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast-context";

/** Bouton « Renvoyer l'e-mail de confirmation » : désactivé 60 s après un envoi (même règle que le serveur). */
export function ResendVerificationButton({ size }: { size?: "sm" }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    setBusy(true);
    try {
      const res = await api<{ ok: true; email: string }>("/auth/email/resend", { method: "POST" });
      toast(`E-mail envoyé à ${res.email}. Ouvrez le lien qu'il contient pour confirmer votre adresse.`, "success");
      setCooldown(60);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Envoi impossible pour le moment.", "error");
      if (err instanceof ApiError && err.status === 400 && /Patientez/.test(err.message)) setCooldown(60);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={`btn btn-outline${size === "sm" ? " btn-sm" : ""}`} onClick={resend} disabled={busy || cooldown > 0}>
      {busy ? "Envoi…" : cooldown > 0 ? `Renvoyer dans ${cooldown} s` : "Renvoyer l'e-mail de confirmation"}
    </button>
  );
}
