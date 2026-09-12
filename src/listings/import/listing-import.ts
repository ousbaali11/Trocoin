/**
 * Parseurs d'import de catalogue pour les comptes professionnels.
 * - CSV (RFC 4180 : guillemets, virgules ou points-virgules, retours à la ligne dans les champs)
 * - XML plat : <annonces><annonce><titre>…</titre>…</annonce></annonces>
 * Aucune dépendance externe. Les colonnes acceptées (insensibles à la casse,
 * accents ignorés) :
 *   reference | titre/title | description | categorie/category (slug) | prix/price |
 *   type_prix | etat/condition | ville/city | code_postal/postal_code |
 *   livraison/delivery (oui/non) | latitude | longitude | attr_<clé> (champs dynamiques)
 */
export interface ImportRow {
  line: number;
  externalRef?: string;
  title?: string;
  description?: string;
  categorySlug?: string;
  price?: number;
  priceType?: string;
  condition?: string;
  city?: string;
  postalCode?: string;
  deliveryAvailable?: boolean;
  latitude?: number;
  longitude?: number;
  attributes: Record<string, string>;
}

const COLUMN_ALIASES: Record<string, keyof ImportRow> = {
  reference: 'externalRef', ref: 'externalRef', id: 'externalRef', sku: 'externalRef',
  titre: 'title', title: 'title',
  description: 'description',
  categorie: 'categorySlug', category: 'categorySlug', category_slug: 'categorySlug',
  prix: 'price', price: 'price',
  type_prix: 'priceType', price_type: 'priceType',
  etat: 'condition', condition: 'condition',
  ville: 'city', city: 'city',
  code_postal: 'postalCode', postal_code: 'postalCode', cp: 'postalCode',
  livraison: 'deliveryAvailable', delivery: 'deliveryAvailable',
  latitude: 'latitude', lat: 'latitude',
  longitude: 'longitude', lng: 'longitude', lon: 'longitude',
};

function normalizeHeader(h: string): string {
  return h.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

function toBool(v: string): boolean {
  return /^(1|oui|yes|true|vrai|o|y)$/i.test(v.trim());
}

function buildRow(line: number, pairs: Array<[string, string]>): ImportRow {
  const row: ImportRow = { line, attributes: {} };
  for (const [rawKey, rawValue] of pairs) {
    const key = normalizeHeader(rawKey);
    const value = (rawValue ?? '').trim();
    if (value === '') continue;
    if (key.startsWith('attr_')) {
      row.attributes[key.slice(5)] = value;
      continue;
    }
    const field = COLUMN_ALIASES[key];
    if (!field) continue;
    switch (field) {
      case 'price': case 'latitude': case 'longitude': {
        const n = Number(value.replace(',', '.').replace(/[^\d.\-]/g, ''));
        if (Number.isFinite(n)) (row as any)[field] = n;
        break;
      }
      case 'deliveryAvailable':
        row.deliveryAvailable = toBool(value);
        break;
      default:
        (row as any)[field] = value;
    }
  }
  return row;
}

/** Parseur CSV tolérant (séparateur auto : , ; ou tabulation). */
export function parseCsv(text: string): ImportRow[] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = [',', ';', '\t'].map((s) => ({ s, n: firstLine.split(s).length })).sort((a, b) => b.n - a.n)[0].s;

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) { record.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.some((f) => f.trim() !== '')) records.push(record);
      record = [];
    } else field += c;
  }
  record.push(field);
  if (record.some((f) => f.trim() !== '')) records.push(record);

  if (records.length < 2) return [];
  const headers = records[0];
  return records.slice(1).map((r, idx) => buildRow(idx + 2, headers.map((h, i) => [h, r[i] ?? ''] as [string, string])));
}

/** Parseur XML minimal : un élément par annonce, sous-éléments = colonnes. */
export function parseXml(text: string): ImportRow[] {
  const items = [...text.matchAll(/<(annonce|listing|item|ad)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  return items.map((m, idx) => {
    const body = m[2];
    const pairs: Array<[string, string]> = [];
    for (const f of body.matchAll(/<([a-zA-Z0-9_:-]+)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      const value = f[2]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .trim();
      pairs.push([f[1].replace(/^.*:/, ''), value]);
    }
    return buildRow(idx + 1, pairs);
  });
}

export function detectFormat(filename: string, content: string): 'csv' | 'xml' | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xml') || /^\s*<\?xml|^\s*<annonces|^\s*<listings/i.test(content)) return 'xml';
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) return 'csv';
  return null;
}
