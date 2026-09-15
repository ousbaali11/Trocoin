"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Shipment, TrackingInfo } from "@/lib/types";

const STATE_LABEL: Record<TrackingInfo["state"], string> = {
  etiquette_creee: "Étiquette créée, colis pas encore déposé",
  pris_en_charge: "Colis pris en charge par le transporteur",
  en_transit: "En cours d'acheminement",
  disponible_en_relais: "Disponible en point relais",
  livre: "Livré",
  incident: "Incident signalé par le transporteur",
};
const CARRIER: Record<string, string> = { colissimo: "Colissimo", mondial_relay: "Mondial Relay" };

/** Côté acheteur (et rappel côté vendeur) : état de l'expédition, numéro et lien de suivi, point relais. */
export function ShipmentStatus({ transactionId, manualTracking }: { transactionId: string; manualTracking?: string | null }) {
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [tracking, setTracking] = useState<TrackingInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await api<Shipment>(`/transactions/${transactionId}/shipment`).catch((e) => (e instanceof ApiError && e.status === 404 ? null : null));
      if (cancelled) return;
      setShipment(s && s.status !== "echec" ? s : null);
      if ((s && s.status !== "echec") || manualTracking) {
        const t = await api<TrackingInfo>(`/transactions/${transactionId}/shipment/tracking`).catch(() => null);
        if (!cancelled) setTracking(t);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transactionId, manualTracking]);

  const number = shipment?.trackingNumber || manualTracking;
  if (!number) return null;
  return (
    <div className="panel" style={{ marginTop: 12 }} data-testid="shipment-status">
      <p className="eyebrow" style={{ margin: 0 }}>Suivi de l&apos;envoi</p>
      {shipment && (
        <p style={{ margin: "6px 0" }}>
          {CARRIER[shipment.carrier]} · {shipment.mode === "domicile" ? "livraison à domicile" : "retrait en point relais"}
          {shipment.relayPointId && <span className="muted small"> · point {shipment.relayPointId}</span>}
        </p>
      )}
      <p style={{ margin: "6px 0" }}>
        Numéro de suivi : <strong data-testid="tracking-number">{number}</strong>
        {(tracking?.trackingUrl || shipment?.trackingUrl) && <> · <a href={tracking?.trackingUrl || shipment?.trackingUrl || "#"} target="_blank" rel="noopener">suivre chez le transporteur</a></>}
      </p>
      {tracking && (
        <p style={{ margin: "6px 0" }} data-testid="tracking-state">
          <span className={`pill ${tracking.state === "livre" ? "pill-green" : tracking.state === "incident" ? "pill-brick" : "pill-sage"}`}>{STATE_LABEL[tracking.state]}</span>
        </p>
      )}
      {tracking && tracking.events.length > 0 && (
        <ul className="small muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {tracking.events.slice(-5).map((e, i) => (
            <li key={i}>{e.at ? new Date(e.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) + " · " : ""}{e.label}{e.location ? ` (${e.location})` : ""}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
