"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PriceEstimate as PriceEstimateType } from "@/lib/types";

/**
 * « Prix moyen constaté » : médiane et fourchette des annonces en ligne de la
 * même catégorie (en priorité celles au titre proche). Affiché pendant la
 * saisie du prix ; leboncoin ne le propose pas aux particuliers.
 */
export function PriceEstimate({ categorySlug, title, price, enabled }: { categorySlug: string; title: string; price: string; enabled: boolean }) {
  const [est, setEst] = useState<PriceEstimateType | null>(null);

  useEffect(() => {
    if (!enabled || !categorySlug || title.trim().length < 3) {
      setEst(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<PriceEstimateType>(`/listings/price-estimate?category=${encodeURIComponent(categorySlug)}&q=${encodeURIComponent(title.trim())}`, { token: null, signal: ctrl.signal })
        .then((e) => setEst(e))
        .catch(() => setEst(null));
    }, 500);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [categorySlug, title, enabled]);

  if (!enabled || !est || est.median === null) return null;

  const n = Number(price);
  let verdict: { text: string; tone: string } | null = null;
  if (price !== "" && Number.isFinite(n) && n > 0 && est.median) {
    if (n > est.median * 1.5) verdict = { text: "Votre prix est nettement au-dessus des annonces comparables : la vente risque d'être plus lente.", tone: "var(--brick, #b4532a)" };
    else if (n < est.median * 0.5) verdict = { text: "Votre prix est bien en dessous du marché : vérifiez que ce n'est pas une erreur de saisie.", tone: "var(--ochre, #9a6b1c)" };
    else verdict = { text: "Votre prix est dans la fourchette des annonces comparables.", tone: "var(--accent-dark, #1d6b4f)" };
  }

  return (
    <div className="panel" style={{ padding: "12px 14px", marginBottom: 16, background: "var(--accent-tint)", borderColor: "#c8e5da" }} aria-live="polite">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ margin: 0 }}>Prix moyen constaté</span>
        <strong style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem" }}>{est.median.toLocaleString("fr-FR")} €</strong>
        <span className="small muted">
          fourchette {est.low?.toLocaleString("fr-FR")} – {est.high?.toLocaleString("fr-FR")} € · {est.count} annonce{est.count > 1 ? "s" : ""} {est.basis === "mots" ? "au titre proche" : "dans la catégorie"}
        </span>
      </div>
      {verdict && <p className="small" style={{ margin: "6px 0 0", color: verdict.tone }}>{verdict.text}</p>}
    </div>
  );
}
