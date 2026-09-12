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
}

export async function suggestCities(query: string, signal?: AbortSignal): Promise<GeoSuggestion[]> {
  if (query.trim().length < 2) return [];
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&type=municipality&limit=6`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { features: Array<{ properties: { label: string; city: string; postcode: string }; geometry: { coordinates: [number, number] } }> };
    return data.features.map((f) => ({
      label: `${f.properties.city} (${f.properties.postcode})`,
      city: f.properties.city,
      postcode: f.properties.postcode,
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
    }));
  } catch {
    return [];
  }
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
