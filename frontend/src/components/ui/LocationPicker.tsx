"use client";

import { useEffect, useId, useRef, useState } from "react";
import { arrondissementsOf, getBrowserPosition, groupSuggestions, suggestCities, type GeoSuggestion, type GroupedSuggestion } from "@/lib/geo";
import { useRecentLocations } from "@/lib/recent-locations";

/**
 * Sélecteur de localisation calqué sur leboncoin (relevé des 14 et 15 septembre 2026) :
 *  - un seul champ (« Ajouter une localisation » à l'ouverture) ;
 *  - suggestions : « Autour de moi » puis « Toute la France », puis les dernières communes
 *    utilisées (« Récents », 5 au plus), puis les communes (villages et villes, référentiel
 *    adresse.data.gouv.fr) ; Paris, Lyon et Marseille regroupent leurs arrondissements dans un
 *    sous-menu à déplier ;
 *  - une fois un lieu choisi, LE PANNEAU RESTE OUVERT et propose en bas le rayon :
 *    « Dans un rayon de X km », curseur à 9 positions exactement comme leboncoin
 *    (0, 1, 5, 10, 20, 30, 50, 100, 200 km), **5 km sélectionné par défaut**,
 *    bornes « 0 km / 200 km », boutons « Effacer » et « Valider ».
 */
export const RADIUS_STEPS = [0, 1, 5, 10, 20, 30, 50, 100, 200] as const;
export const DEFAULT_RADIUS = 5;
export const ALL_FRANCE = "Toute la France";
export const AROUND_ME = "Autour de moi";

export type LocationValue =
  | { mode: "all" }
  | { mode: "around"; latitude: number; longitude: number; radius: number }
  | { mode: "city"; city: string; postalCode?: string; latitude?: number; longitude?: number; radius: number };

export function locationLabel(v: LocationValue, withRadius = false): string {
  if (v.mode === "all") return ALL_FRANCE;
  const base = v.mode === "around" ? AROUND_ME : `${v.city}${v.postalCode ? ` (${v.postalCode})` : ""}`;
  return withRadius ? `${base} · ${v.radius} km` : base;
}

const itemBtn: React.CSSProperties = { width: "100%", justifyContent: "flex-start", gap: 8 };

export function LocationPicker({
  value,
  onChange,
  id,
  placeholder = "Ajouter une localisation",
}: {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
  id?: string;
  placeholder?: string;
}) {
  const panelId = useId();
  const { recent, remember } = useRecentLocations();
  const [text, setText] = useState(value.mode === "all" ? "" : locationLabel(value, true));
  // « Toute la France » choisi explicitement : affiché dans le champ comme le serait une commune
  // (la valeur reste { mode: "all" } ; sans choix explicite, le champ garde son texte d'invite).
  const [chosenAll, setChosenAll] = useState(false);
  const [items, setItems] = useState<GeoSuggestion[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [arrondissements, setArrondissements] = useState<Record<string, GeoSuggestion[]>>({});
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(value.mode === "all" ? (chosenAll ? ALL_FRANCE : "") : locationLabel(value, true));
  }, [value, chosenAll]);

  /** Ferme le panneau en remettant le libellé du lieu choisi dans le champ (le panneau garde le focus dans le champ pendant les clics). */
  const close = () => {
    setOpen(false);
    setExpanded(null);
    if (value.mode !== "all") setText(locationLabel(value, true));
    else if (chosenAll) setText(ALL_FRANCE);
    (root.current?.querySelector("input") as HTMLInputElement | null)?.blur();
  };

  // Fermeture au clic en dehors (le panneau reste ouvert pendant le réglage du rayon)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onInput = (t: string) => {
    setText(t);
    setGeoError(null);
    setExpanded(null);
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
    setChosenAll(true);
    setText(ALL_FRANCE);
    onChange({ mode: "all" });
    (root.current?.querySelector("input") as HTMLInputElement | null)?.blur();
  };

  const pickAround = async () => {
    setLocating(true);
    setGeoError(null);
    const pos = await getBrowserPosition();
    setLocating(false);
    if (!pos) {
      setGeoError("Géolocalisation refusée ou indisponible : autorisez-la dans votre navigateur ou saisissez une commune.");
      return;
    }
    setItems([]);
    setChosenAll(false);
    onChange({ mode: "around", latitude: pos.latitude, longitude: pos.longitude, radius: value.mode !== "all" ? value.radius : DEFAULT_RADIUS });
    setOpen(true);
  };

  const pickCity = (s: { city: string; postcode?: string; latitude?: number; longitude?: number }) => {
    setItems([]);
    setExpanded(null);
    setChosenAll(false);
    remember({ city: s.city, postalCode: s.postcode, latitude: s.latitude, longitude: s.longitude });
    onChange({ mode: "city", city: s.city, postalCode: s.postcode, latitude: s.latitude, longitude: s.longitude, radius: DEFAULT_RADIUS });
    setOpen(true); // reste ouvert pour proposer le rayon
  };

  /** Déplie (ou replie) les arrondissements d'une grande ville ; la liste est chargée à la première ouverture. */
  const toggleArrondissements = async (city: string) => {
    if (expanded === city) return setExpanded(null);
    setExpanded(city);
    if (!arrondissements[city]) {
      const list = await arrondissementsOf(city);
      setArrondissements((a) => ({ ...a, [city]: list }));
    }
  };

  const clear = () => {
    setText("");
    setItems([]);
    setExpanded(null);
    setChosenAll(false);
    onChange({ mode: "all" });
  };

  const hasPlace = value.mode !== "all";
  /** Un lieu ou « Toute la France » est affiché dans le champ (effaçable, remis après le focus). */
  const hasLabel = hasPlace || chosenAll;
  const currentLabel = () => (hasPlace ? locationLabel(value, true) : ALL_FRANCE);
  const stepIndex = hasPlace ? Math.max(0, RADIUS_STEPS.indexOf(value.radius as (typeof RADIUS_STEPS)[number])) : 2;
  const grouped: GroupedSuggestion[] = groupSuggestions(items);
  const showRecent = !text.trim() && recent.length > 0;

  return (
    <div style={{ position: "relative" }} ref={root} onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          className="input"
          value={text}
          placeholder={placeholder}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => {
            if (hasLabel) setText("");
            setOpen(true);
          }}
          onBlur={() => {
            if (hasLabel && !text.trim()) setText(currentLabel());
          }}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={panelId}
          aria-label="Localisation"
          style={{ paddingRight: hasLabel ? 40 : undefined }}
        />
        {hasLabel && (
          <button type="button" onClick={clear} aria-label="Effacer la localisation" style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, border: 0, background: "transparent", color: "var(--ink-muted)", cursor: "pointer", fontSize: "1.1rem" }}>
            ×
          </button>
        )}
      </div>
      {open && (
        <div role="dialog" id={panelId} aria-label="Menu des localisations" onMouseDown={(e) => e.preventDefault()} style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", marginTop: 4, padding: 6, background: "var(--white)", border: "1px solid var(--line-soft)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-lg)", minWidth: 280 }}>
          <ul aria-label="Suggestions de localisation" style={{ margin: 0, padding: 0, listStyle: "none", maxHeight: 300, overflowY: "auto" }}>
            {!text.trim() && <li className="small muted" style={{ padding: "6px 10px 2px" }}>Suggestions</li>}
            <li>
              <button type="button" onClick={pickAround} aria-pressed={value.mode === "around"} className="btn btn-ghost btn-sm" style={itemBtn}>
                <TargetIcon /> {AROUND_ME}
              </button>
            </li>
            <li>
              <button type="button" onClick={pickAll} aria-pressed={value.mode === "all"} className="btn btn-ghost btn-sm" style={itemBtn}>
                <PinIcon /> {ALL_FRANCE}
              </button>
            </li>
            {showRecent && (
              <>
                <li className="small muted" style={{ padding: "8px 10px 2px", borderTop: "1px solid var(--line-soft)", marginTop: 4 }}>Récents</li>
                {recent.map((r) => (
                  <li key={`recent-${r.city}-${r.postalCode ?? ""}`}>
                    <button type="button" onClick={() => pickCity({ city: r.city, postcode: r.postalCode, latitude: r.latitude, longitude: r.longitude })} className="btn btn-ghost btn-sm" style={itemBtn} data-testid="recent-location">
                      <ClockIcon /> {r.city}{r.postalCode ? ` (${r.postalCode})` : ""}
                    </button>
                  </li>
                ))}
              </>
            )}
            {grouped.map((g) => (
              <li key={g.main.label + g.main.postcode}>
                <div style={{ display: "flex", alignItems: "stretch", gap: 2 }}>
                  <button type="button" onClick={() => pickCity(g.main)} className="btn btn-ghost btn-sm" style={{ ...itemBtn, flex: 1 }}>
                    <PinIcon /> {g.main.label}
                  </button>
                  {g.arrondissementsOf && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-expanded={expanded === g.arrondissementsOf}
                      aria-label={`Arrondissements de ${g.arrondissementsOf}`}
                      title={`Arrondissements de ${g.arrondissementsOf}`}
                      onClick={() => toggleArrondissements(g.arrondissementsOf!)}
                      style={{ minWidth: 44 }}
                    >
                      <ChevronIcon open={expanded === g.arrondissementsOf} />
                    </button>
                  )}
                </div>
                {g.arrondissementsOf && expanded === g.arrondissementsOf && (
                  <ul aria-label={`Arrondissements de ${g.arrondissementsOf}`} style={{ margin: "2px 0 4px", padding: "0 0 0 18px", listStyle: "none", borderLeft: "2px solid var(--line-soft)", marginLeft: 14 }}>
                    {!arrondissements[g.arrondissementsOf] && <li className="small muted" style={{ padding: "4px 10px" }}>Chargement…</li>}
                    {arrondissements[g.arrondissementsOf]?.map((a) => (
                      <li key={a.postcode}>
                        <button type="button" onClick={() => pickCity(a)} className="btn btn-ghost btn-sm" style={itemBtn}>
                          {a.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {locating && <p className="hint" style={{ padding: "4px 10px" }}>Localisation en cours…</p>}
          {geoError && <p className="hint" style={{ padding: "4px 10px", color: "var(--brick)" }}>{geoError}</p>}
          {hasPlace && (
            <div style={{ borderTop: "1px solid var(--line-soft)", marginTop: 6, padding: "10px 10px 6px" }} data-testid="radius-panel">
              <div className="row spread" style={{ marginBottom: 6 }}>
                <strong style={{ fontSize: "0.92rem" }}>{locationLabel(value)}</strong>
                <button type="button" className="btn btn-ghost btn-sm" onClick={clear} aria-label={`Effacer la localisation : ${locationLabel(value)}`}>Effacer</button>
              </div>
              <div className="small" style={{ marginBottom: 4 }}>
                Dans un rayon de <strong>{value.radius} km</strong>
              </div>
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
              <div className="row spread small muted" style={{ marginTop: 2 }}>
                <span>0 km</span>
                <span>200 km</span>
              </div>
              <div role="group" aria-label="Paliers de rayon" style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                {RADIUS_STEPS.map((r) => (
                  <button key={r} type="button" className={`btn btn-sm ${value.radius === r ? "btn-primary" : "btn-outline"}`} style={{ padding: "3px 8px", fontSize: "0.78rem" }} aria-pressed={value.radius === r} onClick={() => onChange({ ...value, radius: r })}>
                    {r} km
                  </button>
                ))}
              </div>
              <div className="row spread" style={{ marginTop: 10 }}>
                <span className="small muted">{value.radius === 0 ? "Uniquement la commune" : "Communes alentour incluses"}</span>
                <button type="button" className="btn btn-primary btn-sm" onClick={close}>Valider</button>
              </div>
            </div>
          )}
        </div>
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

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
