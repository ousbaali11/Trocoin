"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PriceEstimate as Estimate } from "@/lib/types";

/**
 * Estimation de prix pendant la saisie (docs/design-system.md §5, brief « fonctionnalités
 * intelligentes ») : jauge fourchette basse — médiane — haute des annonces comparables, avec le
 * curseur du prix tapé qui se déplace en direct, et un verdict en une phrase.
 */
export function PriceEstimate({ categorySlug, title, price, enabled }: { categorySlug: string; title: string; price: string; enabled: boolean }) {
  const [est, setEst] = useState<Estimate | null>(null);

  useEffect(() => {
    if (!enabled || !categorySlug || title.trim().length < 3) {
      setEst(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<Estimate>(`/listings/price-estimate?category=${encodeURIComponent(categorySlug)}&q=${encodeURIComponent(title.trim())}`, { signal: ctrl.signal, token: null })
        .then((e) => !ctrl.signal.aborted && setEst(e))
        .catch(() => undefined);
    }, 500);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [categorySlug, title, enabled]);

  if (!enabled || !est || est.median === null || est.low === null || est.high === null) return null;

  const n = Number(price);
  const hasPrice = price !== "" && Number.isFinite(n) && n > 0;
  // Échelle de la jauge : de 0 à 2 × haute, bornes réelles placées dessus
  const scaleMax = Math.max(est.high * 2, est.median * 1.5, hasPrice ? n * 1.1 : 0);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`;
  let verdict: { text: string; tone: string; key: string } | null = null;
  if (hasPrice) {
    if (n > est.median * 1.5) verdict = { key: "haut", text: "Nettement au-dessus des annonces comparables : la vente risque d'être plus lente.", tone: "var(--brick)" };
    else if (n < est.median * 0.5) verdict = { key: "bas", text: "Bien en dessous du marché : vérifiez que ce n'est pas une erreur de saisie.", tone: "#7a5211" };
    else if (n > est.high) verdict = { key: "un-peu-haut", text: "Un peu au-dessus de la fourchette habituelle.", tone: "#7a5211" };
    else if (n < est.low) verdict = { key: "un-peu-bas", text: "Un peu en dessous de la fourchette : vous devriez vendre vite.", tone: "var(--accent-dark)" };
    else verdict = { key: "ok", text: "Dans la fourchette des annonces comparables.", tone: "var(--accent-dark)" };
  }

  return (
    <div className="panel" style={{ padding: "12px 14px", marginBottom: 16, background: "var(--accent-tint)", borderColor: "#c8e5da" }} aria-live="polite" data-testid="price-estimate">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ margin: 0 }}>Prix constaté</span>
        <strong style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem" }}>{est.median.toLocaleString("fr-FR")} €</strong>
        <span className="small muted">
          {est.count} annonce{est.count > 1 ? "s" : ""} {est.basis === "mots" ? "au titre proche" : "dans la catégorie"}
        </span>
      </div>
      {/* Jauge : fourchette en vert, médiane marquée, curseur du prix saisi */}
      <div style={{ position: "relative", height: 34, marginTop: 10 }} aria-hidden="true">
        <div style={{ position: "absolute", left: 0, right: 0, top: 14, height: 6, borderRadius: 3, background: "rgba(31,41,55,0.12)" }} />
        <div style={{ position: "absolute", left: pct(est.low), width: `calc(${pct(est.high)} - ${pct(est.low)})`, top: 14, height: 6, borderRadius: 3, background: "var(--accent)" }} />
        <div style={{ position: "absolute", left: pct(est.median), top: 10, width: 2, height: 14, background: "var(--accent-dark)", transform: "translateX(-1px)" }} />
        {hasPrice && (
          <div style={{ position: "absolute", left: pct(n), top: 4, transform: "translateX(-50%)", transition: "left 0.2s ease-out" }} data-testid="price-marker">
            <div style={{ width: 14, height: 14, borderRadius: "50%", background: "var(--white)", border: `3px solid ${verdict?.tone ?? "var(--ink)"}`, margin: "0 auto", boxShadow: "0 1px 3px rgba(31,41,51,0.25)" }} />
          </div>
        )}
        <span className="small muted" style={{ position: "absolute", left: pct(est.low), top: 22, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>{est.low.toLocaleString("fr-FR")} €</span>
        <span className="small muted" style={{ position: "absolute", left: pct(est.high), top: 22, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>{est.high.toLocaleString("fr-FR")} €</span>
      </div>
      <p className="small" style={{ margin: "8px 0 0", color: verdict?.tone ?? "var(--ink-muted)" }} data-testid="price-verdict" data-verdict={verdict?.key ?? "aucun"}>
        {verdict ? verdict.text : `Fourchette habituelle : ${est.low.toLocaleString("fr-FR")} – ${est.high.toLocaleString("fr-FR")} €. Tapez un prix pour le situer.`}
      </p>
    </div>
  );
}
