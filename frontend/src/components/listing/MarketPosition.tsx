"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PriceEstimate as Estimate, PriceType } from "@/lib/types";

/**
 * Position du prix par rapport au marché (équivalent du « Prix équitable » de leboncoin), à partir
 * de la même estimation que celle proposée au dépôt (`/listings/price-estimate` : médiane et
 * quartiles des annonces comparables en ligne). Aucune autre source : sans au moins trois annonces
 * comparables, rien n'est affiché plutôt qu'un chiffre inventé.
 */
export function MarketPosition({ categorySlug, title, price, priceType }: { categorySlug?: string; title: string; price?: number | null; priceType: PriceType }) {
  const [est, setEst] = useState<Estimate | null>(null);
  const applicable = (priceType === "fixe" || priceType === "negociable") && typeof price === "number" && price > 0 && !!categorySlug;

  useEffect(() => {
    if (!applicable || !categorySlug) return;
    const ctrl = new AbortController();
    api<Estimate>(`/listings/price-estimate?category=${encodeURIComponent(categorySlug)}&q=${encodeURIComponent(title.trim())}`, { signal: ctrl.signal, token: null })
      .then((e) => !ctrl.signal.aborted && setEst(e))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [applicable, categorySlug, title]);

  if (!applicable || !est || est.count < 3 || est.median === null || est.low === null || est.high === null) return null;
  const n = price as number;
  const scaleMax = Math.max(est.high * 2, est.median * 1.5, n * 1.1);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`;
  const verdict = n < est.low
    ? { key: "bonne-affaire", label: "Bonne affaire", text: "En dessous de la fourchette des annonces comparables.", tone: "var(--accent-dark)" }
    : n > est.high
      ? { key: "au-dessus", label: "Au-dessus du marché", text: "Au-dessus de la fourchette des annonces comparables.", tone: "#7a5211" }
      : { key: "dans-la-fourchette", label: "Prix dans la fourchette", text: "Dans la fourchette des annonces comparables.", tone: "var(--accent-dark)" };
  const fmt = (v: number) => `${v.toLocaleString("fr-FR")} €`;
  const close = ((est.high - est.low) / scaleMax) * 100 < 16;

  return (
    <div className="panel" style={{ padding: "12px 14px", marginTop: 12, background: "var(--accent-tint)", borderColor: "#c8e5da" }} data-testid="market-position" data-verdict={verdict.key}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="pill pill-green" style={{ color: verdict.tone }}>{verdict.label}</span>
        <span className="small muted">
          Prix constaté {fmt(est.median)} · {est.count} annonce{est.count > 1 ? "s" : ""} {est.basis === "mots" ? "au titre proche" : "dans la catégorie"}
        </span>
      </div>
      <div style={{ position: "relative", height: 34, marginTop: 8 }} aria-hidden="true">
        <div style={{ position: "absolute", left: 0, right: 0, top: 14, height: 6, borderRadius: 3, background: "rgba(31,41,55,0.12)" }} />
        <div style={{ position: "absolute", left: pct(est.low), width: `calc(${pct(est.high)} - ${pct(est.low)})`, top: 14, height: 6, borderRadius: 3, background: "var(--accent)" }} />
        <div style={{ position: "absolute", left: pct(est.median), top: 10, width: 2, height: 14, background: "var(--accent-dark)", transform: "translateX(-1px)" }} />
        <div style={{ position: "absolute", left: pct(n), top: 4, transform: "translateX(-50%)" }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "var(--white)", border: `3px solid ${verdict.tone}`, margin: "0 auto", boxShadow: "0 1px 3px rgba(31,41,51,0.25)" }} />
        </div>
        {close ? (
          // Bornes trop proches pour deux libellés : une seule fourchette centrée
          <span className="small muted" style={{ position: "absolute", left: pct((est.low + est.high) / 2), top: 22, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>{est.low.toLocaleString("fr-FR")} – {fmt(est.high)}</span>
        ) : (
          <>
            <span className="small muted" style={{ position: "absolute", left: pct(est.low), top: 22, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>{fmt(est.low)}</span>
            <span className="small muted" style={{ position: "absolute", left: pct(est.high), top: 22, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>{fmt(est.high)}</span>
          </>
        )}
      </div>
      <p className="small" style={{ margin: "8px 0 0", color: verdict.tone }}>
        {verdict.text} <span className="sr-only">Fourchette : {fmt(est.low)} à {fmt(est.high)}.</span>
      </p>
    </div>
  );
}
