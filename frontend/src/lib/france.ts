/** Noms des régions par identifiant d'URL (filtre `region=` de la recherche, fil d'Ariane des fiches). Même liste que l'API (src/common/geo/france-admin.ts). */
export const REGION_NAMES: Record<string, string> = {
  "auvergne-rhone-alpes": "Auvergne-Rhône-Alpes",
  "bourgogne-franche-comte": "Bourgogne-Franche-Comté",
  bretagne: "Bretagne",
  "centre-val-de-loire": "Centre-Val de Loire",
  corse: "Corse",
  "grand-est": "Grand Est",
  "hauts-de-france": "Hauts-de-France",
  "ile-de-france": "Île-de-France",
  normandie: "Normandie",
  "nouvelle-aquitaine": "Nouvelle-Aquitaine",
  occitanie: "Occitanie",
  "pays-de-la-loire": "Pays de la Loire",
  "provence-alpes-cote-d-azur": "Provence-Alpes-Côte d'Azur",
  guadeloupe: "Guadeloupe",
  martinique: "Martinique",
  guyane: "Guyane",
  "la-reunion": "La Réunion",
  mayotte: "Mayotte",
};

export function regionName(slug?: string | null): string | undefined {
  return slug ? REGION_NAMES[slug] : undefined;
}
