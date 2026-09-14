"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDateTime, formatEuros } from "@/lib/format";

interface Stats {
  users: { total: number; pro: number; suspended: number; newToday: number };
  listings: { active: number; pending: number; newToday: number };
  transactions: { today: number; month: number; disputes: number; gmvMonth: number; revenueMonth: number };
  reports: { open: number };
  generatedAt: string;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Stats>("/admin/stats").then(setStats).catch((e) => setError(e.message));
  }, []);
  if (error) return <div className="a-alert danger">{error}</div>;
  if (!stats) return <div className="skeleton" style={{ height: 200 }} />;

  const todo = stats.listings.pending + stats.reports.open + stats.transactions.disputes;
  return (
    <div>
      <div className="a-head">
        <div>
          <h1>Tableau de bord</h1>
          <p>Chiffres calculés à {formatDateTime(stats.generatedAt)}.</p>
        </div>
      </div>

      {todo > 0 ? (
        <div className="a-alert">
          <strong>{todo} action{todo > 1 ? "s" : ""} en attente :</strong>{" "}
          {stats.listings.pending > 0 && <Link href="/admin/annonces?flagged=true">{stats.listings.pending} annonce(s) à vérifier</Link>}
          {stats.listings.pending > 0 && stats.reports.open > 0 && " · "}
          {stats.reports.open > 0 && <Link href="/admin/signalements">{stats.reports.open} signalement(s)</Link>}
          {(stats.listings.pending > 0 || stats.reports.open > 0) && stats.transactions.disputes > 0 && " · "}
          {stats.transactions.disputes > 0 && <Link href="/admin/litiges">{stats.transactions.disputes} litige(s)</Link>}
        </div>
      ) : (
        <div className="a-alert" style={{ background: "var(--a-ok-soft)", color: "#166534" }}>Aucune action en attente. Tout est à jour.</div>
      )}

      <h2 className="h3" style={{ margin: "20px 0 10px" }}>Utilisateurs</h2>
      <div className="a-grid">
        <Stat v={stats.users.total} l="Comptes actifs" />
        <Stat v={stats.users.pro} l="Professionnels" />
        <Stat v={stats.users.newToday} l="Inscrits aujourd'hui" />
        <Stat v={stats.users.suspended} l="Suspendus" />
      </div>
      <h2 className="h3" style={{ margin: "20px 0 10px" }}>Annonces</h2>
      <div className="a-grid">
        <Stat v={stats.listings.active} l="En ligne" />
        <Stat v={stats.listings.newToday} l="Déposées aujourd'hui" />
        <Stat v={stats.listings.pending} l="En attente de vérification" />
        <Stat v={stats.reports.open} l="Signalements ouverts" />
      </div>
      <h2 className="h3" style={{ margin: "20px 0 10px" }}>Transactions</h2>
      <div className="a-grid">
        <Stat v={stats.transactions.today} l="Aujourd'hui" />
        <Stat v={stats.transactions.month} l="Ce mois" />
        <Stat v={formatEuros(stats.transactions.gmvMonth)} l="Volume confirmé ce mois" />
        <Stat v={formatEuros(stats.transactions.revenueMonth)} l="Revenus plateforme ce mois" />
        <Stat v={stats.transactions.disputes} l="Litiges en cours" />
      </div>
    </div>
  );
}

function Stat({ v, l }: { v: number | string; l: string }) {
  return (
    <div className="a-stat">
      <div className="v">{typeof v === "number" ? v.toLocaleString("fr-FR") : v}</div>
      <div className="l">{l}</div>
    </div>
  );
}
