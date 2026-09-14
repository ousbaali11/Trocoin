"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

interface Suggestion {
  type: "titre" | "categorie";
  label: string;
  slug?: string;
}

/** Barre de recherche avec suggestions (titres d'annonces + catégories) et correction simple. */
export function SearchBox({ compact = false, initial = "", onNavigate }: { compact?: boolean; initial?: string; onNavigate?: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [correction, setCorrection] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([]);
      setCorrection(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      api<{ suggestions: Suggestion[]; correction: string | null }>(`/listings/suggest?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal, token: null })
        .then((r) => {
          if (ctrl.signal.aborted) return;
          setItems(r.suggestions);
          setCorrection(r.correction);
          setOpen(r.suggestions.length > 0 || !!r.correction);
          setActive(-1);
        })
        .catch(() => null);
    }, 180);
  }, [q]);

  const go = (target: string) => {
    setOpen(false);
    onNavigate?.();
    router.push(target);
  };
  const submit = (text = q) => go(text.trim() ? `/recherche?q=${encodeURIComponent(text.trim())}` : "/recherche");
  const pick = (s: Suggestion) => (s.type === "categorie" && s.slug ? go(`/recherche?category=${s.slug}`) : submit(s.label));

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
    if (e.key === "Escape") setOpen(false);
  };

  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ position: "relative" }}>
      <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--white)" }}>
        <input
          className="input"
          style={{ border: 0, minHeight: compact ? 36 : 48, borderRadius: 0, flex: 1, minWidth: 0, width: "100%", fontSize: compact ? "0.92rem" : undefined }}
          type="search"
          placeholder={compact ? "Rechercher" : "Que recherchez-vous ? (canapé, vélo, appartement…)"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => (items.length > 0 || correction) && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
          aria-label="Rechercher une annonce"
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" style={{ borderRadius: 0, minHeight: "auto", padding: compact ? "0 12px" : "0 16px" }} aria-label="Lancer la recherche">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          {!compact && <span>Rechercher</span>}
        </button>
      </div>
      {open && (
        <ul role="listbox" style={{ position: "absolute", zIndex: 60, left: 0, right: 0, top: "calc(100% + 4px)", margin: 0, padding: 6, listStyle: "none", background: "var(--white)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-lg)", textAlign: "left" }}>
          {correction && (
            <li style={{ padding: "8px 10px", fontSize: ".88rem", color: "var(--ink-muted)" }}>
              Essayez avec « <button type="button" className="btn btn-ghost btn-sm" style={{ padding: "0 4px", minHeight: "auto" }} onMouseDown={() => submit(correction)}>{correction}</button> »
            </li>
          )}
          {items.map((s, i) => (
            <li key={s.type + s.label} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={() => pick(s)} className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "space-between", background: i === active ? "var(--accent-tint)" : undefined, color: "var(--ink)" }}>
                <span>{s.label}</span>
                <span className="small muted">{s.type === "categorie" ? "Catégorie" : "Annonce"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
