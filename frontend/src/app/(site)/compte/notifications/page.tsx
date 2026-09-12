"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
import type { Notification } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";

const TYPE_LABEL: Record<Notification["type"], string> = {
  message: "Message",
  transaction: "Transaction",
  alerte_recherche: "Alerte",
  moderation: "Modération",
  systeme: "Trocoin",
};

export default function NotificationsPage() {
  const { refreshCounters } = useAuth();
  const [items, setItems] = useState<Notification[] | null>(null);
  useEffect(() => {
    api<Notification[]>("/notifications").then(async (n) => {
      setItems(n);
      if (n.some((x) => !x.readAt)) {
        await api("/notifications/read-all", { method: "POST" });
        refreshCounters();
      }
    }).catch(() => setItems([]));
  }, [refreshCounters]);

  return (
    <div>
      <h1>Notifications</h1>
      {items === null ? <div className="skeleton" style={{ height: 200 }} /> : items.length === 0 ? (
        <EmptyState title="Aucune notification" text="Messages, transactions, alertes de recherche et décisions de modération apparaîtront ici." />
      ) : (
        <div className="stack">
          {items.map((n) => (
            <Link key={n.id} href={n.link || "#"} className="card" style={{ display: "flex", gap: 14, alignItems: "flex-start", background: n.readAt ? undefined : "var(--ochre-tint)" }}>
              <span className="pill" style={{ flexShrink: 0 }}>{TYPE_LABEL[n.type]}</span>
              <span style={{ flex: 1 }}>
                <strong style={{ display: "block" }}>{n.title}</strong>
                <span className="small">{n.body}</span>
              </span>
              <span className="small muted" style={{ flexShrink: 0 }}>{formatDateTime(n.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
