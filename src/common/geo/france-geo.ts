/**
 * Géographie France (approximative) sans dépendance réseau.
 *
 * - centroïde de chaque département (clé = 2 premiers chiffres du code
 *   postal, ou 3 pour l'outre-mer et la Corse 2A/2B) : sert de position
 *   "floue" quand le client ne fournit pas de coordonnées précises. C'est
 *   volontairement imprécis (rayon de confidentialité du cahier des charges).
 * - distance de Haversine pour le filtre "rayon" et le tri par distance.
 *
 * Pour une localisation précise, le front interroge l'API publique
 * api-adresse.data.gouv.fr et envoie latitude/longitude ; le serveur borne
 * ces coordonnées à la France métropolitaine + DROM.
 */
export const DEPARTMENT_CENTROIDS: Record<string, [number, number]> = {
  '01': [46.10, 5.35], '02': [49.56, 3.56], '03': [46.39, 3.19], '04': [44.09, 6.24], '05': [44.66, 6.26],
  '06': [43.94, 7.12], '07': [44.75, 4.42], '08': [49.62, 4.63], '09': [42.92, 1.50], '10': [48.30, 4.16],
  '11': [43.10, 2.41], '12': [44.28, 2.68], '13': [43.54, 5.09], '14': [49.10, -0.36], '15': [45.05, 2.67],
  '16': [45.72, 0.20], '17': [45.78, -0.67], '18': [47.06, 2.49], '19': [45.36, 1.88], '2A': [41.86, 8.99],
  '2B': [42.39, 9.21], '20': [42.15, 9.10], '21': [47.42, 4.77], '22': [48.44, -2.86], '23': [46.09, 2.02],
  '24': [45.10, 0.74], '25': [47.16, 6.36], '26': [44.68, 5.17], '27': [49.11, 0.99], '28': [48.39, 1.37],
  '29': [48.26, -4.06], '30': [43.99, 4.18], '31': [43.36, 1.17], '32': [43.65, 0.45], '33': [44.82, -0.58],
  '34': [43.58, 3.37], '35': [48.15, -1.64], '36': [46.78, 1.58], '37': [47.26, 0.69], '38': [45.26, 5.58],
  '39': [46.73, 5.70], '40': [43.97, -0.78], '41': [47.60, 1.43], '42': [45.73, 4.17], '43': [45.13, 3.81],
  '44': [47.36, -1.68], '45': [47.91, 2.34], '46': [44.62, 1.60], '47': [44.37, 0.46], '48': [44.52, 3.50],
  '49': [47.39, -0.56], '50': [49.08, -1.32], '51': [48.95, 4.24], '52': [48.11, 5.23], '53': [48.15, -0.66],
  '54': [48.79, 6.16], '55': [49.01, 5.38], '56': [47.85, -2.81], '57': [49.04, 6.66], '58': [47.12, 3.52],
  '59': [50.45, 3.22], '60': [49.41, 2.42], '61': [48.62, 0.13], '62': [50.46, 2.29], '63': [45.73, 3.14],
  '64': [43.25, -0.76], '65': [43.05, 0.16], '66': [42.60, 2.52], '67': [48.67, 7.55], '68': [47.86, 7.28],
  '69': [45.87, 4.64], '70': [47.64, 6.09], '71': [46.65, 4.54], '72': [47.99, 0.22], '73': [45.48, 6.44],
  '74': [46.03, 6.43], '75': [48.86, 2.35], '76': [49.66, 1.03], '77': [48.63, 2.93], '78': [48.81, 1.84],
  '79': [46.56, -0.32], '80': [49.96, 2.28], '81': [43.79, 2.16], '82': [44.09, 1.28], '83': [43.46, 6.22],
  '84': [44.00, 5.19], '85': [46.67, -1.30], '86': [46.56, 0.46], '87': [45.90, 1.24], '88': [48.20, 6.38],
  '89': [47.84, 3.56], '90': [47.63, 6.92], '91': [48.52, 2.24], '92': [48.85, 2.24], '93': [48.92, 2.48],
  '94': [48.78, 2.47], '95': [49.08, 2.13],
  '971': [16.19, -61.59], '972': [14.64, -61.02], '973': [3.93, -53.13], '974': [-21.13, 55.53], '976': [-12.83, 45.17],
};

export function approximateFromPostalCode(postalCode?: string | null): { latitude: number; longitude: number } | null {
  if (!postalCode) return null;
  const cp = postalCode.trim();
  if (!/^\d{5}$/.test(cp)) return null;
  let key = cp.slice(0, 2);
  if (key === '97' || key === '98') key = cp.slice(0, 3);
  if (key === '20') key = Number(cp) < 20200 ? '2A' : '2B';
  const c = DEPARTMENT_CENTROIDS[key];
  return c ? { latitude: c[0], longitude: c[1] } : null;
}

/** Bornes larges France (métropole + DROM). */
export function isWithinFrance(lat: number, lng: number): boolean {
  const metro = lat >= 41 && lat <= 51.5 && lng >= -5.5 && lng <= 10;
  const antilles = lat >= 14 && lat <= 18.5 && lng >= -63.5 && lng <= -60;
  const guyane = lat >= 2 && lat <= 6 && lng >= -55 && lng <= -51;
  const reunionMayotte = lat >= -22 && lat <= -12 && lng >= 44.5 && lng <= 56;
  return metro || antilles || guyane || reunionMayotte;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Boîte englobante (degrés) pour pré-filtrer en SQL avant le calcul exact. */
export function boundingBox(lat: number, lng: number, radiusKm: number) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.1));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}
