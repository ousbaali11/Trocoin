"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

/**
 * Suppression définitive (compte, annonce) : motif obligatoire (journal d'audit) et confirmation
 * explicite par la saisie du mot SUPPRIMER — un simple clic ne suffit pas, l'action est irréversible.
 */
export function HardDeleteDialog({ open, onClose, title, text, confirmLabel, onConfirm }: { open: boolean; onClose: () => void; title: string; text: string; confirmLabel: string; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = reason.trim().length >= 5 && typed.trim() === "SUPPRIMER";
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="small" style={{ margin: "0 0 10px" }}>{text}</p>
      <div className="field">
        <label htmlFor="hd-reason">Motif (obligatoire, conservé dans le journal d&apos;audit)</label>
        <textarea id="hd-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} style={{ minHeight: 80 }} data-testid="hard-delete-reason" />
      </div>
      <div className="field">
        <label htmlFor="hd-confirm">Tapez <strong>SUPPRIMER</strong> pour confirmer</label>
        <input id="hd-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="hard-delete-confirm" />
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-outline" onClick={onClose} disabled={busy}>Annuler</button>
        <button
          className="btn btn-danger"
          disabled={!ready || busy}
          data-testid="hard-delete-submit"
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(reason.trim());
              setReason("");
              setTyped("");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Suppression…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
