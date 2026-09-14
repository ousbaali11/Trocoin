"use client";

import { useEffect, useId, useRef, useState } from "react";
import { suggestCities, type GeoSuggestion } from "@/lib/geo";

export interface CityValue {
  city?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

export const ALL_FRANCE_LABEL = "Toute la France";

/**
 * Saisie de ville avec suggestions officielles (adresse.data.gouv.fr) et repli manuel.
 * `allowAll` (recherche) : « Toute la France » est le choix par défaut, affiché dans le
 * champ et proposé en premier dans la liste ; il correspond à une recherche sans
 * restriction géographique. Sans `allowAll` (dépôt d'annonce), une ville reste requise.
 */
export function CityInput({ value, onChange, placeholder = "Ville ou code postal", id, allowAll = false }: { value: CityValue; onChange: (v: CityValue) => void; placeholder?: string; id?: string; allowAll?: boolean }) {
  const listId = useId();
  const hasLocation = !!(value.city || value.postalCode);
  const [text, setText] = useState(hasLocation ? `${value.city ?? ""}${value.postalCode ? ` (${value.postalCode})` : ""}`.trim() : allowAll ? ALL_FRANCE_LABEL : "");
  const [items, setItems] = useState<GeoSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!value.city && !value.postalCode) setText(allowAll ? ALL_FRANCE_LABEL : "");
  }, [value.city, value.postalCode, allowAll]);

  const onInput = (t: string) => {
    setText(t);
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    // Repli : code postal seul saisi manuellement
    if (/^\d{5}$/.test(t.trim())) onChange({ postalCode: t.trim(), city: value.city });
    else if (!t.trim()) onChange({});
    suggestCities(t, ctrl.signal).then((s) => {
      if (!ctrl.signal.aborted) {
        setItems(s);
        setOpen(s.length > 0 || allowAll);
      }
    });
  };

  const pick = (s: GeoSuggestion) => {
    setText(s.label);
    setItems([]);
    setOpen(false);
    onChange({ city: s.city, postalCode: s.postcode, latitude: s.latitude, longitude: s.longitude });
  };

  const pickAll = () => {
    setText(ALL_FRANCE_LABEL);
    setItems([]);
    setOpen(false);
    onChange({});
  };

  const isAll = allowAll && text === ALL_FRANCE_LABEL;

  return (
    <div
      style={{ position: "relative" }}
      onBlur={(e) => {
        // Fermeture quand le focus quitte le composant (champ ET options), pas entre les deux
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOpen(false);
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
          if (items.length > 0 || allowAll) setOpen(true);
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
          style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", margin: 0, padding: 6, listStyle: "none", background: "var(--white)", border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-lg)" }}
        >
          {allowAll && (
            <li role="option" tabIndex={0} aria-selected={!hasLocation} onClick={pickAll} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickAll(); } }} className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start", fontWeight: 600 }}>
              {ALL_FRANCE_LABEL}
            </li>
          )}
          {items.map((s) => (
            <li key={s.label + s.postcode} role="option" tabIndex={0} aria-selected={false} onClick={() => pick(s)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(s); } }} className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start" }}>
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
