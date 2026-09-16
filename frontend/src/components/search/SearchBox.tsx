"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { suggestCities, type GeoSuggestion } from "@/lib/geo";
import { usePresence } from "@/lib/use-presence";

interface Suggestion {
  type: "titre" | "categorie" | "commune" | "recente";
  label: string;
  slug?: string;
  city?: GeoSuggestion;
}

const RECENT_KEY = "trocoin_recent_searches";
const MAX_RECENT = 6;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((s) => typeof s === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}
export function rememberSearch(q: string) {
  const clean = q.trim();
  if (clean.length < 2) return;
  try {
    const next = [clean, ...readRecent().filter((s) => s.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* navigation privée */
  }
}

const TYPE_LABEL: Record<Suggestion["type"], string> = { titre: "Annonce", categorie: "Catégorie", commune: "Commune", recente: "Récent" };

/**
 * Barre de recherche avec suggestions pendant la frappe : annonces, catégories, communes
 * (adresse.data.gouv.fr) et vos recherches récentes (conservées dans ce navigateur seulement).
 * Correction orthographique simple. Menu animé (docs/design-system.md §7).
 */
export function SearchBox({ compact = false, initial = "", onNavigate }: { compact?: boolean; initial?: string; onNavigate?: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [correction, setCorrection] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presence = usePresence(open);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setItems(recent.map((r) => ({ type: "recente" as const, label: r })));
      setCorrection(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      Promise.all([
        api<{ suggestions: Suggestion[]; correction: string | null }>(`/listings/suggest?q=${encodeURIComponent(text)}`, { signal: ctrl.signal, token: null }).catch(() => ({ suggestions: [], correction: null })),
        text.length >= 3 ? suggestCities(text, ctrl.signal) : Promise.resolve([] as GeoSuggestion[]),
      ]).then(([r, cities]) => {
        if (ctrl.signal.aborted) return;
        const recents = recent.filter((s) => s.toLowerCase().startsWith(text.toLowerCase()) && s.toLowerCase() !== text.toLowerCase()).slice(0, 2).map((label) => ({ type: "recente" as const, label }));
        const communes = cities.filter((c) => !c.arrondissement).slice(0, 2).map((c) => ({ type: "commune" as const, label: c.label, city: c }));
        const merged = [...recents, ...r.suggestions, ...communes];
        setItems(merged);
        setCorrection(r.correction);
        setOpen(merged.length > 0 || !!r.correction);
        setActive(-1);
      });
    }, 180);
  }, [q, recent]);

  const go = (target: string) => {
    setOpen(false);
    onNavigate?.();
    router.push(target);
  };
  const submit = (text = q) => {
    const clean = text.trim();
    if (clean) {
      rememberSearch(clean);
      setRecent(readRecent());
    }
    go(clean ? `/recherche?q=${encodeURIComponent(clean)}` : "/recherche");
  };
  const pick = (s: Suggestion) => {
    if (s.type === "categorie" && s.slug) return go(`/recherche?category=${s.slug}`);
    if (s.type === "commune" && s.city) return go(`/recherche?city=${encodeURIComponent(s.city.city)}${s.city.postcode ? `&postal_code=${s.city.postcode}` : ""}`);
    return submit(s.label);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
    if (e.key === "Escape") setOpen(false);
  };

  const showRecentHeading = q.trim().length < 2 && items.length > 0;

  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ position: "relative" }}>
      {/* Compact (en-tête) : pilule de 40 px exactement, comme les boutons voisins (AUDIT §48) */}
      <div style={{ display: "flex", border: "1px solid var(--ink-soft)", borderRadius: "var(--radius-pill)", overflow: "hidden", background: "var(--white)", height: compact ? 40 : undefined }}>
        <input
          className="input"
          style={{ border: 0, minHeight: compact ? 0 : 48, height: compact ? 38 : undefined, padding: compact ? "0 12px 0 18px" : undefined, borderRadius: 0, flex: 1, minWidth: 0, width: "100%", fontSize: compact ? "0.95rem" : undefined, paddingLeft: 18 }}
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
        <button type="submit" className="btn btn-primary" style={{ borderRadius: 0, minHeight: "auto", padding: compact ? "0 14px" : "0 18px" }} aria-label="Lancer la recherche">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          {!compact && <span>Rechercher</span>}
        </button>
      </div>
      {presence.mounted && (
        <ul role="listbox" className={presence.leaving ? "menu-leave" : "menu-enter"} aria-label="Suggestions de recherche" style={{ position: "absolute", zIndex: 60, left: 0, right: 0, top: "calc(100% + 6px)", margin: 0, padding: 6, listStyle: "none", background: "var(--white)", border: "1px solid var(--line)", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)", textAlign: "left", transformOrigin: "top" }}>
          {showRecentHeading && <li className="small muted" style={{ padding: "6px 10px 2px" }} aria-hidden="true">Vos recherches récentes</li>}
          {correction && (
            <li style={{ padding: "8px 10px", fontSize: ".88rem", color: "var(--ink-muted)" }}>
              Essayez avec « <button type="button" className="btn btn-ghost btn-sm" style={{ padding: "0 4px", minHeight: "auto" }} onMouseDown={() => submit(correction)}>{correction}</button> »
            </li>
          )}
          {items.map((s, i) => (
            <li key={s.type + s.label} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={() => pick(s)} className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "space-between", background: i === active ? "var(--accent-tint)" : undefined, color: "var(--ink)", borderRadius: "var(--radius-sm)" }} data-testid={`suggestion-${s.type}`}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {s.type === "recente" ? <ClockIcon /> : s.type === "commune" ? <PinIcon /> : s.type === "categorie" ? <TagIcon /> : <SearchIcon />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                </span>
                <span className="small muted">{TYPE_LABEL[s.type]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12V4h8l9 9-8 8z" />
      <circle cx="7.5" cy="8.5" r="1.5" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
