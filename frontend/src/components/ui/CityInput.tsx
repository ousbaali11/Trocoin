"use client";

import { useEffect, useRef, useState } from "react";
import { suggestCities, type GeoSuggestion } from "@/lib/geo";

export interface CityValue {
  city?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

/** Saisie de ville avec suggestions officielles (adresse.data.gouv.fr) et repli manuel. */
export function CityInput({ value, onChange, placeholder = "Ville ou code postal", id }: { value: CityValue; onChange: (v: CityValue) => void; placeholder?: string; id?: string }) {
  const [text, setText] = useState(value.city ? `${value.city}${value.postalCode ? ` (${value.postalCode})` : ""}` : "");
  const [items, setItems] = useState<GeoSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!value.city && !value.postalCode) setText("");
  }, [value.city, value.postalCode]);

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
        setOpen(s.length > 0);
      }
    });
  };

  const pick = (s: GeoSuggestion) => {
    setText(s.label);
    setItems([]);
    setOpen(false);
    onChange({ city: s.city, postalCode: s.postcode, latitude: s.latitude, longitude: s.longitude });
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        className="input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => onInput(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (
        <ul
          role="listbox"
          style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", margin: 0, padding: 6, listStyle: "none", background: "var(--white)", border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-lg)" }}
        >
          {items.map((s) => (
            <li key={s.label + s.postcode} role="option" aria-selected={false}>
              <button type="button" onMouseDown={() => pick(s)} className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start" }}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
