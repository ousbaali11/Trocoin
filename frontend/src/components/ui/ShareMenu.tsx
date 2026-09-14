"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/lib/toast-context";

/**
 * Menu « Partager » : lien copié, WhatsApp, e-mail, Facebook, X, et le partage
 * natif du téléphone quand il existe (Web Share API). Les liens sociaux
 * s'ouvrent dans un nouvel onglet ; aucune donnée personnelle n'est transmise,
 * seulement l'URL publique et le titre.
 */
export function ShareMenu({ url, title, text, compact = false, className }: { url?: string; title: string; text?: string; compact?: boolean; className?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [canNative, setCanNative] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const href = () => url || (typeof window !== "undefined" ? window.location.href : "");
  const message = text ? `${text} — ${title}` : title;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href());
      toast("Lien copié dans le presse-papiers.", "success");
    } catch {
      toast("Copie impossible : sélectionnez l'adresse dans la barre du navigateur.", "error");
    }
    setOpen(false);
  };

  const native = async () => {
    try {
      await navigator.share({ title, text: message, url: href() });
    } catch {
      /* partage annulé */
    }
    setOpen(false);
  };

  const enc = (s: string) => encodeURIComponent(s);
  const links = [
    { label: "WhatsApp", href: `https://wa.me/?text=${enc(`${message} ${href()}`)}` },
    { label: "E-mail", href: `mailto:?subject=${enc(title)}&body=${enc(`${message}\n${href()}`)}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(href())}` },
    { label: "X (Twitter)", href: `https://twitter.com/intent/tweet?url=${enc(href())}&text=${enc(message)}` },
  ];

  return (
    <div ref={root} style={{ position: "relative", display: "inline-block" }} className={className}>
      <button type="button" className={`btn btn-ghost ${compact ? "btn-sm" : ""}`} onClick={() => { setCanNative(typeof navigator.share === "function"); setOpen((o) => !o); }} aria-haspopup="menu" aria-expanded={open}>
        <ShareIcon /> Partager
      </button>
      {open && (
        <div role="menu" aria-label="Partager" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30, minWidth: 220, background: "var(--white)", border: "1px solid var(--line-soft)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)", padding: 6, display: "flex", flexDirection: "column" }}>
          {canNative && <MenuItem onClick={native}>Partager… (appli du téléphone)</MenuItem>}
          <MenuItem onClick={copy}>Copier le lien</MenuItem>
          {links.map((l) => (
            <a key={l.label} role="menuitem" href={l.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} style={itemStyle}>
              {l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const itemStyle: React.CSSProperties = { textAlign: "left", padding: "9px 12px", borderRadius: "var(--radius-sm)", background: "none", border: 0, cursor: "pointer", font: "inherit", fontSize: ".92rem", color: "var(--ink)", textDecoration: "none", display: "block" };

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} style={itemStyle} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-tint)")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
      {children}
    </button>
  );
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}
