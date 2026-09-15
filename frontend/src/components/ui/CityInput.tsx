"use client";

import { useEffect, useId, useRef, useState } from "react";
import { arrondissementsOf, groupSuggestions, suggestCities, type GeoSuggestion } from "@/lib/geo";
import { useRecentLocations } from "@/lib/recent-locations";

export interface CityValue {
  city?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

export const ALL_FRANCE_LABEL = "Toute la France";

const itemStyle: React.CSSProperties = { width: "100%", justifyContent: "flex-start" };

/**
 * Saisie de ville avec suggestions officielles (adresse.data.gouv.fr) et repli manuel.
 * Avant toute saisie, les dernières communes utilisées (« Récents », 5 au plus) sont proposées.
 * Paris, Lyon et Marseille regroupent leurs arrondissements dans un sous-menu.
 * `allowAll` (recherche) : « Toute la France » est le choix par défaut, affiché dans le
 * champ et proposé en premier dans la liste ; il correspond à une recherche sans
 * restriction géographique. Sans `allowAll` (dépôt d'annonce), une ville reste requise.
 */
export function CityInput({ value, onChange, placeholder = "Ville ou code postal", id, allowAll = false }: { value: CityValue; onChange: (v: CityValue) => void; placeholder?: string; id?: string; allowAll?: boolean }) {
  const listId = useId();
  const { recent, remember } = useRecentLocations();
  const hasLocation = !!(value.city || value.postalCode);
  const [text, setText] = useState(hasLocation ? `${value.city ?? ""}${value.postalCode ? ` (${value.postalCode})` : ""}`.trim() : allowAll ? ALL_FRANCE_LABEL : "");
  const [items, setItems] = useState<GeoSuggestion[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [arrondissements, setArrondissements] = useState<Record<string, GeoSuggestion[]>>({});
  const [open, setOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!value.city && !value.postalCode) setText(allowAll ? ALL_FRANCE_LABEL : "");
  }, [value.city, value.postalCode, allowAll]);

  const onInput = (t: string) => {
    setText(t);
    setExpanded(null);
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    // Repli : code postal seul saisi manuellement
    if (/^\d{5}$/.test(t.trim())) onChange({ postalCode: t.trim(), city: value.city });
    else if (!t.trim()) onChange({});
    suggestCities(t, ctrl.signal).then((s) => {
      if (!ctrl.signal.aborted) {
        setItems(s);
        setOpen(s.length > 0 || allowAll || (!t.trim() && recent.length > 0));
      }
    });
  };

  const pick = (s: { label: string; city: string; postcode?: string; latitude?: number; longitude?: number }) => {
    setText(s.label);
    setItems([]);
    setExpanded(null);
    setOpen(false);
    remember({ city: s.city, postalCode: s.postcode, latitude: s.latitude, longitude: s.longitude });
    onChange({ city: s.city, postalCode: s.postcode, latitude: s.latitude, longitude: s.longitude });
  };

  const pickAll = () => {
    setText(ALL_FRANCE_LABEL);
    setItems([]);
    setOpen(false);
    onChange({});
  };

  const toggleArrondissements = async (city: string) => {
    if (expanded === city) return setExpanded(null);
    setExpanded(city);
    if (!arrondissements[city]) {
      const list = await arrondissementsOf(city);
      setArrondissements((a) => ({ ...a, [city]: list }));
    }
  };

  const isAll = allowAll && text === ALL_FRANCE_LABEL;
  const showRecent = !text.trim() && recent.length > 0;
  const grouped = groupSuggestions(items);
  const onKey = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

  return (
    <div
      style={{ position: "relative" }}
      onBlur={(e) => {
        // Fermeture quand le focus quitte le composant (champ ET options), pas entre les deux
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOpen(false);
        setExpanded(null);
        if (allowAll && !value.city && !value.postalCode) setText(ALL_FRANCE_LABEL);
      }}
    >
      <input
        id={id}
        className="input"
        value={text}
        placeholder={allowAll ? ALL_FRANCE_LABEL : placeholder}
        onChange={(e) => onInput(e.target.value)}
        onFocus={() => {
          // Le libellé par défaut s'efface pour laisser saisir une ville ; il revient si rien n'est choisi.
          if (isAll) setText("");
          if (items.length > 0 || allowAll || recent.length > 0) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        style={isAll ? { fontWeight: 600 } : undefined}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Communes proposées"
          style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", margin: 0, padding: 6, listStyle: "none", background: "var(--white)", border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-lg)", maxHeight: 300, overflowY: "auto" }}
        >
          {allowAll && (
            <li role="option" tabIndex={0} aria-selected={!hasLocation} onClick={pickAll} onKeyDown={onKey(pickAll)} className="btn btn-ghost btn-sm" style={{ ...itemStyle, fontWeight: 600 }}>
              {ALL_FRANCE_LABEL}
            </li>
          )}
          {showRecent && (
            <>
              <li role="presentation" className="small muted" style={{ padding: "6px 10px 2px" }}>Récents</li>
              {recent.map((r) => {
                const label = `${r.city}${r.postalCode ? ` (${r.postalCode})` : ""}`;
                const choose = () => pick({ label, city: r.city, postcode: r.postalCode, latitude: r.latitude, longitude: r.longitude });
                return (
                  <li key={`recent-${r.city}-${r.postalCode ?? ""}`} role="option" tabIndex={0} aria-selected={false} onClick={choose} onKeyDown={onKey(choose)} className="btn btn-ghost btn-sm" style={itemStyle} data-testid="recent-location">
                    {label}
                  </li>
                );
              })}
            </>
          )}
          {grouped.map((g) => (
            <li key={g.main.label + g.main.postcode} role="presentation">
              <div style={{ display: "flex", alignItems: "stretch", gap: 2 }}>
                <div role="option" tabIndex={0} aria-selected={false} onClick={() => pick(g.main)} onKeyDown={onKey(() => pick(g.main))} className="btn btn-ghost btn-sm" style={{ ...itemStyle, flex: 1 }}>
                  {g.main.label}
                </div>
                {g.arrondissementsOf && (
                  <button type="button" className="btn btn-ghost btn-sm" aria-expanded={expanded === g.arrondissementsOf} aria-label={`Arrondissements de ${g.arrondissementsOf}`} title={`Arrondissements de ${g.arrondissementsOf}`} onClick={() => toggleArrondissements(g.arrondissementsOf!)} style={{ minWidth: 44 }}>
                    {expanded === g.arrondissementsOf ? "▴" : "▾"}
                  </button>
                )}
              </div>
              {g.arrondissementsOf && expanded === g.arrondissementsOf && (
                <ul role="group" aria-label={`Arrondissements de ${g.arrondissementsOf}`} style={{ margin: "2px 0 4px 14px", padding: "0 0 0 10px", listStyle: "none", borderLeft: "2px solid var(--line-soft)" }}>
                  {!arrondissements[g.arrondissementsOf] && <li role="presentation" className="small muted" style={{ padding: "4px 10px" }}>Chargement…</li>}
                  {arrondissements[g.arrondissementsOf]?.map((a) => (
                    <li key={a.postcode} role="option" tabIndex={0} aria-selected={false} onClick={() => pick(a)} onKeyDown={onKey(() => pick(a))} className="btn btn-ghost btn-sm" style={itemStyle}>
                      {a.label}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
