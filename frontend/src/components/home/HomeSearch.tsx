"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocationPicker, RADIUS_STEPS, type LocationValue } from "@/components/ui/LocationPicker";
import styles from "./HomeSearch.module.css";

/**
 * Bloc de recherche de l'accueil : mots-clés + localisation (« Toute la France »
 * par défaut) + raccourcis. L'action de recherche occupe l'espace, pas un slogan.
 */
export function HomeSearch({ total }: { total: number }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState<LocationValue>({ mode: "all" });

  const buildParams = () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (loc.mode === "around") {
      p.set("lat", String(loc.latitude));
      p.set("lng", String(loc.longitude));
      p.set("radius", String(loc.radius));
      p.set("city_label", "Autour de moi");
      p.set("sort", "distance");
    } else if (loc.mode === "city") {
      if (loc.radius > 0 && loc.latitude !== undefined && loc.longitude !== undefined) {
        p.set("lat", String(loc.latitude));
        p.set("lng", String(loc.longitude));
        p.set("radius", String(loc.radius));
        p.set("city_label", loc.city);
      } else {
        // 0 km : uniquement la commune choisie
        p.set("city", loc.city);
        if (loc.postalCode) p.set("postal_code", loc.postalCode);
      }
    }
    return p;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/recherche?${buildParams().toString()}`);
  };

  const quick = (extra: Record<string, string>) => {
    const p = buildParams();
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/recherche?${p.toString()}`;
  };

  return (
    <div className={styles.wrap}>
      <form onSubmit={submit} role="search" className={styles.form} aria-label="Rechercher une annonce">
        <div className={styles.field}>
          <label htmlFor="home-q" className={styles.label}>Quoi ?</label>
          <input id="home-q" className={`input ${styles.input}`} placeholder="Vélo, canapé, appartement, Clio…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </div>
        <div className={`${styles.field} ${styles.where}`}>
          <label htmlFor="home-city" className={styles.label}>Où ?</label>
          <LocationPicker id="home-city" value={loc} onChange={setLoc} compact />
        </div>
        <button className={`btn btn-primary ${styles.submit}`} type="submit">
          <SearchIcon /> Rechercher
        </button>
      </form>
      <div className={styles.quick} aria-label="Raccourcis">
        <span className={styles.quickLabel}>{total > 0 ? `${total.toLocaleString("fr-FR")} annonces en ligne` : "Raccourcis"}</span>
        {loc.mode !== "all" && (
          <select className="select" aria-label="Rayon de recherche" value={loc.radius} onChange={(e) => setLoc({ ...loc, radius: Number(e.target.value) })} style={{ width: "auto", padding: "5px 30px 5px 10px", fontSize: "0.84rem" }}>
            {RADIUS_STEPS.map((r) => <option key={r} value={r}>{r === 0 ? "Uniquement la commune" : `Dans un rayon de ${r} km`}</option>)}
          </select>
        )}
        <Link href={quick({ price_type: "gratuit" })} className={`${styles.chip} ${styles.chipGift}`}>🎁 Dons uniquement</Link>
        <Link href={quick({ price_type: "echange" })} className={styles.chip}>🔁 Échanges</Link>
        <Link href={quick({ since_days: "1" })} className={styles.chip}>Publiées aujourd&apos;hui</Link>
        <Link href={quick({ delivery: "true" })} className={styles.chip}>Livraison possible</Link>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
