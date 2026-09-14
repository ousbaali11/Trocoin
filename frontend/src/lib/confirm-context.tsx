"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action destructive : bouton rouge */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Remplace `window.confirm` par une boîte de dialogue cohérente avec le site
 * (même modale que les autres actions, boutons du design system, fermeture
 * par Échap). Usage : `const confirm = useConfirm(); if (await confirm({...}))`.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpts(o);
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal open={opts !== null} onClose={() => close(false)} title={opts?.title ?? ""} width={460}>
        {opts?.text && <p style={{ marginTop: 0 }}>{opts.text}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-outline" onClick={() => close(false)}>
            {opts?.cancelLabel ?? "Annuler"}
          </button>
          <button type="button" className={`btn ${opts?.danger ? "btn-danger" : "btn-primary"}`} onClick={() => close(true)} autoFocus>
            {opts?.confirmLabel ?? "Confirmer"}
          </button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm doit être utilisé dans ConfirmProvider");
  return ctx;
}
