"use client";

import type { FieldSchema } from "@/lib/types";

/**
 * Checklist « Fiche complète » pendant le dépôt : mêmes règles que l'API
 * (src/listings/listing-completeness.ts). Le badge est attribué automatiquement
 * quand tout est vert ; il indique à l'acheteur qu'il n'aura pas à demander
 * l'année, le kilométrage, la surface… par message. Chaque point manquant vient avec
 * une action concrète (docs/design-system.md, brief « fonctionnalités intelligentes »).
 */
export const MIN_PHOTOS = 3;
export const MIN_DESCRIPTION = 120;

export type CompletenessAction = "photos" | "description" | "prix" | "criteres";

export interface CompletenessCheck {
  label: string;
  ok: boolean;
  action: CompletenessAction;
  /** Verbe d'action affiché quand le point manque. */
  todo: string;
}

export function completenessChecks({ photosCount, description, price, priceType, attributes, schema }: {
  photosCount: number;
  description: string;
  price: string;
  priceType: string;
  attributes: Record<string, string | number | boolean | undefined>;
  schema: FieldSchema[];
}): CompletenessCheck[] {
  const checks: CompletenessCheck[] = [];
  const missingPhotos = Math.max(0, MIN_PHOTOS - photosCount);
  checks.push({
    label: `${MIN_PHOTOS} photos ou plus (${photosCount} pour l'instant)`,
    ok: photosCount >= MIN_PHOTOS,
    action: "photos",
    todo: missingPhotos === 1 ? "Ajoutez une photo de plus" : `Ajoutez ${missingPhotos} photos de plus`,
  });
  const len = description.trim().length;
  checks.push({
    label: `Description d'au moins ${MIN_DESCRIPTION} caractères (${len})`,
    ok: len >= MIN_DESCRIPTION,
    action: "description",
    todo: `Complétez la description (${Math.max(0, MIN_DESCRIPTION - len)} caractères de plus)`,
  });
  if (priceType === "fixe" || priceType === "negociable") checks.push({ label: "Prix indiqué", ok: price !== "" && Number(price) >= 0, action: "prix", todo: "Indiquez un prix" });
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
    checks.push({
      label: missing.length ? `Tous les critères renseignés (manque : ${missing.map((f) => f.label).join(", ")})` : "Tous les critères renseignés",
      ok: missing.length === 0,
      action: "criteres",
      todo: missing.length === 1 ? `Précisez : ${missing[0].label.toLowerCase()}` : `Précisez ${missing.length} critères (${missing.slice(0, 2).map((f) => f.label.toLowerCase()).join(", ")}…)`,
    });
  }
  return checks;
}

export function CompletenessHint({ onAction, hideActions, ...props }: Parameters<typeof completenessChecks>[0] & { onAction?: (action: CompletenessAction) => void; /** Points affichés sans lien « Faire → » (l'action est déjà sous les yeux, ex. la tuile d'ajout de photos). */ hideActions?: CompletenessAction[] }) {
  const checks = completenessChecks(props);
  const done = checks.filter((c) => c.ok).length;
  const all = done === checks.length;
  const pct = Math.round((done / checks.length) * 100);
  return (
    <div className="panel" style={{ padding: "12px 14px", marginBottom: 16 }} data-testid="completeness">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Fiche complète" style={{ width: 44, height: 44, borderRadius: "50%", background: `conic-gradient(var(--accent) ${pct}%, var(--ivory-warm) 0)`, display: "grid", placeItems: "center", flexShrink: 0 }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--white)", display: "grid", placeItems: "center", fontSize: "0.72rem", fontWeight: 700 }}>{pct}%</span>
        </div>
        <div style={{ flex: "1 1 200px" }}>
          <span className={`pill ${all ? "pill-green" : ""}`}>{all ? "✓ Fiche complète" : `Fiche complète : ${done}/${checks.length}`}</span>
          <div className="small muted" style={{ marginTop: 4 }}>{all ? "Votre annonce portera le badge « Fiche complète »." : "Une fiche complète reçoit plus de contacts et moins de questions."}</div>
        </div>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }} className="small">
        {checks.map((c) => (
          <li key={c.action} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0", color: c.ok ? "var(--accent-dark)" : "var(--ink-soft)" }}>
            <span>{c.ok ? "✓" : "○"} {c.ok ? c.label : c.todo}</span>
            {!c.ok && onAction && !hideActions?.includes(c.action) && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 30, padding: "2px 10px" }} onClick={() => onAction(c.action)} data-testid={`completeness-${c.action}`}>
                Faire →
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
