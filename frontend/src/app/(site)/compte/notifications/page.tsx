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
            <Link key={n.id} href={n.link || "#"} className="card notif-card" style={{ background: n.readAt ? undefined : "var(--ochre-tint)" }}>
              <span className="pill">{TYPE_LABEL[n.type]}</span>
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: "block" }}>{n.title}</strong>
                <span className="small" style={{ overflowWrap: "anywhere" }}>{n.body}</span>
              </span>
              <time className="small muted" dateTime={n.createdAt}>{formatDateTime(n.createdAt)}</time>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
