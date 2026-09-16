"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { REPORT_REASON_LABELS } from "@/lib/format";
import { Modal } from "@/components/ui/Modal";

/**
 * « Signaler l'annonce » : même boîte de dialogue depuis le bloc d'actions (colonne de droite) et
 * depuis le bas de la fiche, pour rester accessible une fois la page déroulée.
 */
export function ReportListingButton({ listingId, variant = "ghost", label = "Signaler" }: { listingId: string; variant?: "ghost" | "link"; label?: string }) {
  const { user, requireAuth } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("arnaque");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!requireAuth(`/annonces/${listingId}`)) return;
    setBusy(true);
    try {
      await api("/reports", { method: "POST", body: { listingId, reason, details: details.trim() || undefined } });
      toast("Merci, votre signalement a été transmis à notre équipe.", "success");
      setOpen(false);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const openDialog = () => (user ? setOpen(true) : requireAuth(`/annonces/${listingId}`));

  return (
    <>
      {variant === "link" ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={openDialog} style={{ color: "var(--brick)", paddingLeft: 0 }} data-testid="report-link">
          <FlagIcon /> {label}
        </button>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={openDialog} style={{ color: "var(--brick)" }}>
          {label}
        </button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Signaler cette annonce">
        <div className="field">
          <label htmlFor="reason">Motif</label>
          <select id="reason" className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(REPORT_REASON_LABELS).filter(([k]) => k !== "harcelement").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="details">Précisions (facultatif)</label>
          <textarea id="details" className="textarea" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} style={{ minHeight: 90 }} />
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={() => setOpen(false)}>Annuler</button>
          <button className="btn btn-danger" onClick={submit} disabled={busy}>Envoyer le signalement</button>
        </div>
      </Modal>
    </>
  );
}

function FlagIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4h12l-2 4 2 4H5" />
    </svg>
  );
}
