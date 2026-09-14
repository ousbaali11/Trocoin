"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import type { Review } from "@/lib/types";
import { Rating } from "@/components/ui/Rating";

export default function AvisPage() {
  const { user } = useAuth();
  const [received, setReceived] = useState<Review[] | null>(null);
  const [given, setGiven] = useState<Review[] | null>(null);
  const [tab, setTab] = useState<"received" | "given">("received");
  useEffect(() => {
    api<Review[]>("/users/me/reviews-received").then(setReceived).catch(() => setReceived([]));
    api<Review[]>("/users/me/reviews-given").then(setGiven).catch(() => setGiven([]));
  }, []);
  if (received === null || given === null) return <div><h1>Avis</h1><div className="skeleton" style={{ height: 160 }} /></div>;
  const list = tab === "received" ? received : given;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Avis</h1>
          {user && <Rating value={user.ratingAvg} count={user.ratingCount} size={16} />}
        </div>
        <div className="row" role="tablist">
          <button role="tab" aria-selected={tab === "received"} className={`btn btn-sm ${tab === "received" ? "btn-dark" : "btn-outline"}`} onClick={() => setTab("received")}>Reçus ({received.length})</button>
          <button role="tab" aria-selected={tab === "given"} className={`btn btn-sm ${tab === "given" ? "btn-dark" : "btn-outline"}`} onClick={() => setTab("given")}>Donnés ({given.length})</button>
        </div>
      </div>
      {list.length === 0 ? (
        <div className="panel"><p className="muted" style={{ margin: 0 }}>Aucun avis pour le moment. Les avis se laissent après une transaction sécurisée terminée, depuis <Link href="/compte/transactions">Achats et ventes</Link>.</p></div>
      ) : (
        <div className="stack">
          {list.map((r) => {
            const who = tab === "received" ? r.reviewer : r.reviewed;
            return (
              <div key={r.id} className="card">
                <div className="row spread">
                  <strong>{tab === "received" ? "De" : "Pour"} {who?.displayName ?? "Membre"}</strong>
                  <span className="small muted">{formatDate(r.createdAt)}</span>
                </div>
                <Rating value={r.rating} />
                {r.comment && <p style={{ margin: "8px 0 0" }}>{r.comment}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
