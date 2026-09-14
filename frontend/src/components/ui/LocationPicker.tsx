"use client";

import { useEffect, useRef, useState } from "react";
import { getBrowserPosition, suggestCities, type GeoSuggestion } from "@/lib/geo";

/**
 * Sélecteur de localisation calqué sur leboncoin (relevé du 14 septembre 2026) :
 *  - un seul champ « Ajouter une localisation » ;
 *  - suggestions dans l'ordre : « Autour de moi » (géolocalisation du navigateur),
 *    « Toute la France » (aucune restriction, libellé texte simple), puis les
 *    communes (villages et villes, référentiel adresse.data.gouv.fr) ;
 *  - une fois un lieu choisi, un rayon avec les paliers exacts de leboncoin :
 *    0, 1, 5, 10, 20, 30, 50, 100, 200 km (5 km par défaut).
 */
export const RADIUS_STEPS = [0, 1, 5, 10, 20, 30, 50, 100, 200] as const;
export const DEFAULT_RADIUS = 5;
export const ALL_FRANCE = "Toute la France";
export const AROUND_ME = "Autour de moi";

export type LocationValue =
  | { mode: "all" }
  | { mode: "around"; latitude: number; longitude: number; radius: number }
  | { mode: "city"; city: string; postalCode?: string; latitude?: number; longitude?: number; radius: number };

export function locationLabel(v: LocationValue): string {
  if (v.mode === "all") return ALL_FRANCE;
  if (v.mode === "around") return AROUND_ME;
  return `${v.city}${v.postalCode ? ` (${v.postalCode})` : ""}`;
}

export function LocationPicker({ value, onChange, id, compact = false }: { value: LocationValue; onChange: (v: LocationValue) => void; id?: string; compact?: boolean }) {
  const [text, setText] = useState(value.mode === "all" ? "" : locationLabel(value));
  const [items, setItems] = useState<GeoSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setText(value.mode === "all" ? "" : locationLabel(value));
  }, [value]);

  const onInput = (t: string) => {
    setText(t);
    setGeoError(null);
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    if (!t.trim()) {
      setItems([]);
      setOpen(true);
      return;
    }
    suggestCities(t, ctrl.signal).then((s) => {
      if (!ctrl.signal.aborted) {
        setItems(s);
        setOpen(true);
      }
    });
  };

  const pickAll = () => {
    setItems([]);
    setOpen(false);
    onChange({ mode: "all" });
  };

  const pickAround = async () => {
    setOpen(false);
    setLocating(true);
    setGeoError(null);
    const pos = await getBrowserPosition();
    setLocating(false);
    if (!pos) {
      setGeoError("Géolocalisation refusée ou indisponible : autorisez-la dans votre navigateur ou saisissez une commune.");
      return;
    }
    onChange({ mode: "around", latitude: pos.latitude, longitude: pos.longitude, radius: value.mode !== "all" ? value.radius : DEFAULT_RADIUS });
  };

  const pickCity = (s: GeoSuggestion) => {
    setItems([]);
    setOpen(false);
    onChange({ mode: "city", city: s.city, postalCode: s.postcode, latitude: s.latitude, longitude: s.longitude, radius: value.mode !== "all" ? value.radius : DEFAULT_RADIUS });
  };

  const clear = () => {
    setText("");
    onChange({ mode: "all" });
  };

  const stepIndex = value.mode === "all" ? 2 : Math.max(0, RADIUS_STEPS.indexOf(value.radius as (typeof RADIUS_STEPS)[number]));

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          className="input"
          value={text}
          placeholder="Ajouter une localisation"
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label="Localisation"
          style={{ paddingRight: value.mode === "all" ? undefined : 40 }}
        />
        {value.mode !== "all" && (
          <button type="button" onClick={clear} aria-label="Effacer la localisation" style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, border: 0, background: "transparent", color: "var(--ink-muted)", cursor: "pointer", fontSize: "1.1rem" }}>
            ×
          </button>
        )}
      </div>
      {open && (
        <ul role="listbox" aria-label="Menu des localisations" style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", margin: 0, padding: 6, listStyle: "none", background: "var(--white)", border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-lg)", maxHeight: 320, overflowY: "auto" }}>
          {!text.trim() && <li className="small muted" style={{ padding: "6px 10px 2px" }}>Suggestions</li>}
          <li role="option" aria-selected={value.mode === "around"}>
            <button type="button" onMouseDown={pickAround} className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start", gap: 8 }}>
              <TargetIcon /> {AROUND_ME}
            </button>
          </li>
          <li role="option" aria-selected={value.mode === "all"}>
            <button type="button" onMouseDown={pickAll} className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start", gap: 8 }}>
              <PinIcon /> {ALL_FRANCE}
            </button>
          </li>
          {items.map((s) => (
            <li key={s.label + s.postcode} role="option" aria-selected={false}>
              <button type="button" onMouseDown={() => pickCity(s)} className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start", gap: 8 }}>
                <PinIcon /> {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {locating && <span className="hint">Localisation en cours…</span>}
      {geoError && <span className="hint" style={{ color: "var(--brick)" }}>{geoError}</span>}
      {value.mode !== "all" && !compact && (
        <label className="hint" style={{ display: "block", marginTop: 6 }}>
          Dans un rayon de <strong>{value.radius} km</strong>
          <input
            type="range"
            min={0}
            max={RADIUS_STEPS.length - 1}
            step={1}
            value={stepIndex}
            onChange={(e) => onChange({ ...value, radius: RADIUS_STEPS[Number(e.target.value)] })}
            style={{ width: "100%", display: "block" }}
            aria-label={`Élargir la zone de recherche autour de ${locationLabel(value)}`}
            aria-valuetext={`${value.radius} km`}
          />
          <span className="row spread small muted"><span>0 km</span><span>200 km</span></span>
        </label>
      )}
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}
