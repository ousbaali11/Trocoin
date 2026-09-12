"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DELIVERY_LABELS, formatDate, formatEuros, TX_STATUS_LABELS } from "@/lib/format";
import type { Transaction } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";

export default function TransactionsPage() {
  const [items, setItems] = useState<Transaction[] | null>(null);
  const [role, setRole] = useState<"all" | "acheteur" | "vendeur">("all");
  useEffect(() => {
    api<Transaction[]>("/transactions/mine").then(setItems).catch(() => setItems([]));
  }, []);
  const visible = (items ?? []).filter((t) => role === "all" || t.role === role);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Achats et ventes</h1>
          <p className="muted" style={{ margin: 0 }}>Transactions passées par le paiement sécurisé Trocoin.</p>
        </div>
        <div className="row" role="tablist">
          {(["all", "acheteur", "vendeur"] as const).map((r) => (
            <button key={r} role="tab" aria-selected={role === r} className={`btn btn-sm ${role === r ? "btn-dark" : "btn-outline"}`} onClick={() => setRole(r)}>
              {r === "all" ? "Toutes" : r === "acheteur" ? "Achats" : "Ventes"}
            </button>
          ))}
        </div>
      </div>
      {items === null ? <div className="skeleton" style={{ height: 200 }} /> : visible.length === 0 ? (
        <EmptyState title="Aucune transaction" text="Les achats et ventes réalisés avec le paiement sécurisé apparaîtront ici." action={{ href: "/recherche", label: "Explorer les annonces" }} />
      ) : (
        <div className="table-wrap panel" style={{ padding: 8 }}>
          <table className="table">
            <thead>
              <tr><th>Annonce</th><th>Rôle</th><th>Montant</th><th>Remise</th><th>Statut</th><th>Date</th><th></th></tr>
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
      )}
    </div>
  );
}
