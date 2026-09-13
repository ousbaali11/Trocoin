"use client";

import type { FieldSchema } from "@/lib/types";

/**
 * Checklist « Fiche complète » pendant le dépôt : mêmes règles que l'API
 * (src/listings/listing-completeness.ts). Le badge est attribué automatiquement
 * quand tout est vert ; il indique à l'acheteur qu'il n'aura pas à demander
 * l'année, le kilométrage, la surface… par message.
 */
export const MIN_PHOTOS = 3;
export const MIN_DESCRIPTION = 120;

export function completenessChecks({ photosCount, description, price, priceType, attributes, schema }: {
  photosCount: number;
  description: string;
  price: string;
  priceType: string;
  attributes: Record<string, string | number | boolean | undefined>;
  schema: FieldSchema[];
}): Array<{ label: string; ok: boolean }> {
  const checks: Array<{ label: string; ok: boolean }> = [];
  checks.push({ label: `${MIN_PHOTOS} photos ou plus (${photosCount} pour l'instant)`, ok: photosCount >= MIN_PHOTOS });
  const len = description.trim().length;
  checks.push({ label: `Description d'au moins ${MIN_DESCRIPTION} caractères (${len})`, ok: len >= MIN_DESCRIPTION });
  if (priceType === "fixe" || priceType === "negociable") checks.push({ label: "Prix indiqué", ok: price !== "" && Number(price) >= 0 });
  const counted = schema.filter((f) => f.type !== "boolean");
  if (counted.length) {
    const year = new Date().getFullYear();
    const missing = counted.filter((f) => {
      const v = attributes[f.key];
      if (v === undefined || v === null || String(v).trim() === "") return true;
      if (f.type === "number") {
        const n = Number(v);
        if (!Number.isFinite(n)) return true;
        if (f.min !== undefined && n < f.min) return true;
        if (f.max !== undefined && n > f.max) return true;
        if (/^annee/.test(f.key) && n > year) return true;
      }
      return false;
    });
    checks.push({ label: missing.length ? `Tous les critères renseignés (manque : ${missing.map((f) => f.label).join(", ")})` : "Tous les critères renseignés", ok: missing.length === 0 });
  }
  return checks;
}

export function CompletenessHint(props: Parameters<typeof completenessChecks>[0]) {
  const checks = completenessChecks(props);
  const done = checks.filter((c) => c.ok).length;
  const all = done === checks.length;
  return (
    <div className="panel" style={{ padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span className={`pill ${all ? "pill-green" : ""}`}>{all ? "✓ Fiche complète" : `Fiche complète : ${done}/${checks.length}`}</span>
        <span className="small muted">{all ? "Votre annonce portera le badge « Fiche complète »." : "Complétez ces points pour obtenir le badge et recevoir moins de questions par message."}</span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
        {checks.map((c) => (
          <li key={c.label} style={{ color: c.ok ? "var(--accent-dark, #1d6b4f)" : "var(--ink-soft)" }}>
            {c.ok ? "✓" : "○"} {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
