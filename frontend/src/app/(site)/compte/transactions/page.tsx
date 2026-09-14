"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DELIVERY_LABELS, formatDate, formatEuros, TX_STATUS_LABELS } from "@/lib/format";
import type { Transaction } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";

const OPEN_STATUSES = ["en_attente", "sequestre", "livree", "litige"];

export default function TransactionsPage() {
  const [items, setItems] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<"all" | "acheteur" | "vendeur">("all");
  const [scope, setScope] = useState<"open" | "done" | "all">("all");
  useEffect(() => {
    api<Transaction[]>("/transactions/mine").then(setItems).catch((e) => { setError((e as Error).message); setItems([]); });
  }, []);
  const visible = (items ?? []).filter((t) => (role === "all" || t.role === role) && (scope === "all" || (scope === "open" ? OPEN_STATUSES.includes(t.status) : !OPEN_STATUSES.includes(t.status))));
  const openCount = (items ?? []).filter((t) => OPEN_STATUSES.includes(t.status)).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Achats et ventes</h1>
          <p className="muted" style={{ margin: 0 }}>Transactions passées par le paiement sécurisé Trocoin.</p>
        </div>
        <div className="row" role="tablist" aria-label="Rôle">
          {(["all", "acheteur", "vendeur"] as const).map((r) => (
            <button key={r} role="tab" aria-selected={role === r} className={`btn btn-sm ${role === r ? "btn-dark" : "btn-outline"}`} onClick={() => setRole(r)}>
              {r === "all" ? "Toutes" : r === "acheteur" ? "Achats" : "Ventes"}
            </button>
          ))}
        </div>
      </div>
      <div className="row" style={{ marginBottom: 14 }} role="tablist" aria-label="État">
        {(["all", "open", "done"] as const).map((s) => (
          <button key={s} role="tab" aria-selected={scope === s} className={`btn btn-sm ${scope === s ? "btn-primary" : "btn-ghost"}`} onClick={() => setScope(s)}>
            {s === "all" ? "Tout" : s === "open" ? `En cours${openCount ? ` (${openCount})` : ""}` : "Terminées"}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {items === null ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : visible.length === 0 ? (
        <EmptyState title={scope === "open" ? "Aucune transaction en cours" : "Aucune transaction"} text="Les achats et ventes réalisés avec le paiement sécurisé apparaîtront ici, avec leur suivi et le code de remise." action={{ href: "/recherche", label: "Explorer les annonces" }} />
      ) : (
        <>
          {/* Grand écran : tableau */}
          <div className="table-wrap panel only-desktop" style={{ padding: 8 }}>
            <table className="table">
              <thead>
                <tr><th>Annonce</th><th>Rôle</th><th>Montant</th><th>Remise</th><th>Statut</th><th>Date</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const st = TX_STATUS_LABELS[t.status];
                  return (
                    <tr key={t.id}>
                      <td><Link href={`/compte/transactions/${t.id}`}><strong>{t.listing?.title ?? "Annonce supprimée"}</strong></Link><br /><span className="small muted">avec {t.other?.displayName}</span></td>
                      <td>{t.role === "acheteur" ? "Achat" : "Vente"}</td>
                      <td>{formatEuros(t.role === "acheteur" ? t.amount + t.buyerFee : t.amount - t.commission)}</td>
                      <td className="small">{DELIVERY_LABELS[t.deliveryMethod]}</td>
                      <td><span className={st.pill}>{st.label}</span></td>
                      <td className="small muted">{formatDate(t.createdAt)}</td>
                      <td><Link href={`/compte/transactions/${t.id}`} className="btn btn-outline btn-sm">Détail</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Mobile : cartes */}
          <div className="stack only-mobile">
            {visible.map((t) => {
              const st = TX_STATUS_LABELS[t.status];
              return (
                <Link key={t.id} href={`/compte/transactions/${t.id}`} className="card card-hover" style={{ display: "block" }}>
                  <div className="row spread" style={{ alignItems: "flex-start" }}>
                    <span className={st.pill}>{st.label}</span>
                    <span className="small muted">{formatDate(t.createdAt)}</span>
                  </div>
                  <strong style={{ display: "block", margin: "8px 0 2px" }}>{t.listing?.title ?? "Annonce supprimée"}</strong>
                  <span className="small muted">{t.role === "acheteur" ? "Achat" : "Vente"} · avec {t.other?.displayName} · {DELIVERY_LABELS[t.deliveryMethod]}</span>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem", fontWeight: 700, color: "var(--accent)", marginTop: 6 }}>{formatEuros(t.role === "acheteur" ? t.amount + t.buyerFee : t.amount - t.commission)}</div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
