"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CityInput, type CityValue } from "@/components/ui/CityInput";

export function HomeSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [city, setCity] = useState<CityValue>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (city.latitude !== undefined && city.longitude !== undefined) {
      p.set("lat", String(city.latitude));
      p.set("lng", String(city.longitude));
      p.set("radius", "30");
      if (city.city) p.set("city_label", city.city);
    } else if (city.postalCode) p.set("postal_code", city.postalCode);
    router.push(`/recherche?${p.toString()}`);
  };

  return (
    <form
      onSubmit={submit}
      role="search"
      className="home-search"
      style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr auto", gap: 8, background: "var(--white)", padding: 8, borderRadius: "var(--radius)", maxWidth: 820, border: "1px solid var(--line)", boxShadow: "var(--shadow)" }}
    >
      <input className="input" style={{ border: 0 }} placeholder="Que cherchez-vous ?" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Mots-clés" />
      <CityInput value={city} onChange={setCity} placeholder="Où ? (ville, code postal)" />
      <button className="btn btn-primary btn-lg" type="submit">Rechercher</button>
      <style>{`@media (max-width: 640px){ .home-search{ grid-template-columns: 1fr !important; } }`}</style>
    </form>
  );
}
