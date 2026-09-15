/**
 * Autocomplétion d'adresse via l'API publique adresse.data.gouv.fr
 * (appelée depuis le navigateur, aucune clé requise). En cas d'échec réseau,
 * l'utilisateur peut saisir ville + code postal manuellement : le serveur
 * positionne alors l'annonce au centre du département.
 */
export interface GeoSuggestion {
  label: string;
  city: string;
  postcode: string;
  latitude: number;
  longitude: number;
  /** Arrondissement d'une grande ville (Paris, Lyon, Marseille) : regroupé sous la commune dans les listes. */
  arrondissement?: { city: string; rank: number };
}

/** Villes dont les arrondissements sont regroupés dans un sous-menu (comme sur leboncoin). */
export const VILLES_A_ARRONDISSEMENTS = ["Paris", "Lyon", "Marseille"] as const;

interface Feature {
  properties: { label: string; name?: string; city: string; postcode: string };
  geometry: { coordinates: [number, number] };
}

/**
 * L'API renvoie les arrondissements comme des communes à part entière
 * (`city: "Paris 11e Arrondissement"`, `postcode: "75011"`). On les rattache à leur ville.
 */
function parseArrondissement(name: string | undefined): { city: string; rank: number } | null {
  const m = /^(Paris|Lyon|Marseille)\s+(\d{1,2})(?:er|e|ème)\s+arrondissement$/i.exec((name || "").trim());
  if (!m) return null;
  const city = VILLES_A_ARRONDISSEMENTS.find((c) => c.toLowerCase() === m[1].toLowerCase()) ?? m[1];
  return { city, rank: Number(m[2]) };
}

function toSuggestion(f: Feature): GeoSuggestion {
  const { city, postcode, name } = f.properties;
  const base = { postcode, latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0] };
  const arr = parseArrondissement(name) ?? parseArrondissement(city);
  if (arr) {
    return { ...base, city: arr.city, label: `${arr.city} ${arr.rank}${arr.rank === 1 ? "er" : "e"} (${postcode})`, arrondissement: arr };
  }
  // Paris, Lyon, Marseille : la commune elle-même est libellée « (toute la ville) » pour la
  // distinguer de ses arrondissements, proposés dans un sous-menu.
  const big = (VILLES_A_ARRONDISSEMENTS as readonly string[]).includes(city);
  return { ...base, city, label: big ? `${city} (toute la ville)` : `${city} (${postcode})` };
}

async function search(query: string, limit: number, signal?: AbortSignal): Promise<GeoSuggestion[]> {
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&type=municipality&limit=${limit}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { features: Feature[] };
    return data.features.map(toSuggestion);
  } catch {
    return [];
  }
}

export async function suggestCities(query: string, signal?: AbortSignal): Promise<GeoSuggestion[]> {
  if (query.trim().length < 2) return [];
  return search(query, 6, signal);
}

/**
 * Regroupe les suggestions pour l'affichage : chaque grande ville n'apparaît qu'une fois
 * (« toute la ville »), ses arrondissements sont rangés dessous (dépliés à la demande).
 */
export interface GroupedSuggestion {
  main: GeoSuggestion;
  /** Présent pour Paris, Lyon, Marseille : sous-menu à déplier. */
  arrondissementsOf?: string;
}

export function groupSuggestions(items: GeoSuggestion[]): GroupedSuggestion[] {
  const out: GroupedSuggestion[] = [];
  const seenBig = new Set<string>();
  for (const s of items) {
    const big = (VILLES_A_ARRONDISSEMENTS as readonly string[]).includes(s.city);
    if (!big) {
      out.push({ main: s });
      continue;
    }
    if (seenBig.has(s.city)) continue;
    seenBig.add(s.city);
    // Entrée « toute la ville » : celle de l'API si présente, sinon reconstruite depuis l'arrondissement (mêmes coordonnées approximatives)
    const whole = items.find((x) => x.city === s.city && !x.arrondissement);
    const main: GeoSuggestion = whole ?? { city: s.city, postcode: s.postcode, latitude: s.latitude, longitude: s.longitude, label: `${s.city} (toute la ville)` };
    out.push({ main, arrondissementsOf: s.city });
  }
  return out;
}

/** Tous les arrondissements d'une grande ville, triés par numéro (chargés à l'ouverture du sous-menu). */
export async function arrondissementsOf(city: string, signal?: AbortSignal): Promise<GeoSuggestion[]> {
  const all = await search(`${city} arrondissement`, 30, signal);
  return all
    .filter((s) => s.city === city && s.arrondissement)
    .sort((a, b) => a.arrondissement!.rank - b.arrondissement!.rank);
}

export function getBrowserPosition(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 6000, maximumAge: 300_000 },
    );
  });
}
