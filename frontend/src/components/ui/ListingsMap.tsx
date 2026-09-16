"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect } from "react";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import type { ListingCard } from "@/lib/types";

const icon = L.divIcon({
  className: "",
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#1f3b2e;border:3px solid #fffdf9;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 11);
    else map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 13 });
  }, [map, points]);
  return null;
}

/**
 * Carte des résultats (positions approximatives : arrondies à ~1 km par l'API).
 * Fond de carte OpenStreetMap (attribution obligatoire).
 */
export function ListingsMap({ listings, center, radiusKm, height = 520 }: { listings: ListingCard[]; center?: [number, number]; radiusKm?: number; height?: number }) {
  const located = listings.filter((l) => typeof l.latitude === "number" && typeof l.longitude === "number");
  const points = located.map((l) => [l.latitude as number, l.longitude as number] as [number, number]);
  const fallback: [number, number] = center || (points[0] ?? [46.6, 2.4]);
  return (
    <MapContainer center={fallback} zoom={center ? 10 : 6} style={{ height, width: "100%" }} scrollWheelZoom>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {center && radiusKm && <Circle center={center} radius={radiusKm * 1000} pathOptions={{ color: "#d8a23b", fillOpacity: 0.06 }} />}
      {located.map((l) => (
        <Marker key={l.id} position={[l.latitude as number, l.longitude as number]} icon={icon}>
          <Popup>
            <strong style={{ display: "block", marginBottom: 4 }}>{l.title}</strong>
            <span>{formatPrice(l.price, l.priceType)}</span>
            <br />
            <Link href={`/annonces/${l.id}`}>Voir l&apos;annonce</Link>
          </Popup>
        </Marker>
      ))}
      {!center && <FitBounds points={points} />}
    </MapContainer>
  );
}

/**
 * Carte de localisation approximative d'une seule annonce (cercle, pas de point exact).
 * Zoom 13 : les rues de la commune sont lisibles (zoom 11 auparavant : la ville n'était qu'un point).
 * Le cercle garde son rayon réel de 1,5 km (cohérent avec l'arrondi des coordonnées publiques) ; à
 * ce zoom il occupe près de quatre fois plus de pixels qu'avant, avec un trait épais et un fond visible.
 */
export const APPROX_MAP_ZOOM = 13;
export const APPROX_RADIUS_M = 1500;
export function ApproxMap({ latitude, longitude, height = 320 }: { latitude: number; longitude: number; height?: number }) {
  return (
    <MapContainer center={[latitude, longitude]} zoom={APPROX_MAP_ZOOM} style={{ height, width: "100%" }} scrollWheelZoom={false} dragging={false} zoomControl={false} attributionControl>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Circle center={[latitude, longitude]} radius={APPROX_RADIUS_M} pathOptions={{ color: "#1f3b2e", weight: 3, fillColor: "#1f3b2e", fillOpacity: 0.18 }} />
    </MapContainer>
  );
}
