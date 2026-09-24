"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { useConfirm } from "@/lib/confirm-context";
import { formatDateTime, formatEuros } from "@/lib/format";

interface RunState {
  status: "idle" | "running" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  done: number;
  accounts: { created: number; existing: number };
  listings: { created: number; existing: number; failed: number; withoutPhoto: number };
  photos: { created: number; failed: number };
  errors: string[];
  lastError: string | null;
}
interface Summary {
  dataset: { accounts: number; listings: number; photosPlanned: number; listingsWithPhotos: number; minPhotoCoverage: number; byFamily: Record<string, number> };
  database: { accounts: number; listings: number; online: number };
  run: RunState;
  credentialsPending: number;
}
interface DemoConversation {
  id: string;
  listing: { id: string; title: string; price?: number | null; status: string } | null;
  buyer: { id: string; displayName: string };
  seller: { id: string; displayName: string };
  lastMessage: { content: string; senderId: string; createdAt: string; auto: boolean; staff: boolean } | null;
  unreadFromBuyer: number;
  needsReply: boolean;
  lastMessageAt?: string;
}
interface DemoMessage { id: string; fromSeller: boolean; type: string; content: string | null; createdAt: string; auto: boolean; staff: boolean }
interface Credential { name: string; email: string; username: string; password: string; phone: string }

const FAMILY_LABELS: Record<string, string> = { vehicules: "Véhicules", mode: "Mode", "maison-jardin": "Maison & Jardin", multimedia: "Électronique", loisirs: "Loisirs", famille: "Famille", immobilier: "Immobilier", emploi: "Emploi", services: "Services", animaux: "Animaux", "materiel-professionnel": "Matériel pro", vacances: "Locations de vacances" };

/** Console — catalogue de démonstration (AUDIT §71) : ensemencement côté serveur et réponses aux visiteurs qui écrivent aux comptes de démonstration. */
export default function AdminDemoCataloguePage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [conversations, setConversations] = useState<DemoConversation[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<Credential[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api<Summary>("/admin/demo-catalogue"), api<DemoConversation[]>("/admin/demo-catalogue/conversations")]);
      setSummary(s);
      setConversations(c);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  // Pendant une exécution, l'état est relu toutes les 5 s
  useEffect(() => {
    if (summary?.run.status !== "running") return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [summary?.run.status, load]);

  const run = async () => {
    if (!(await confirm({ title: "Créer le catalogue de démonstration ?", text: `${summary?.dataset.accounts ?? 0} comptes vendeurs fictifs et ${summary?.dataset.listings ?? 0} annonces (avec ${summary?.dataset.photosPlanned ?? 0} photos libres de droits) vont être créés côté serveur. L'opération dure plusieurs dizaines de minutes et se reprend d'elle-même si elle est interrompue. Les comptes existants sont conservés.`, confirmLabel: "Lancer" }))) return;
    setBusy(true);
    try {
      await api("/admin/demo-catalogue/run", { method: "POST", body: {} });
      toast("Ensemencement lancé. Cette page se met à jour toute seule.", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const takeCredentials = async () => {
    if (!(await confirm({ title: "Récupérer les identifiants ?", text: "Ils ne sont remis qu'une seule fois : après lecture, ils sont effacés de la mémoire du serveur. Enregistrez le fichier tout de suite dans un endroit sûr (jamais dans le dépôt de code).", confirmLabel: "Afficher et télécharger" }))) return;
    try {
      const r = await api<{ items: Credential[] }>("/admin/demo-catalogue/credentials", { method: "POST", body: {} });
      setCredentials(r.items);
      const lines = ["# Comptes de démonstration Trocoin — à conserver hors du dépôt", "", "| Nom | E-mail (identifiant) | Pseudo | Mot de passe | Numéro (fictif) |", "|---|---|---|---|---|", ...r.items.map((c) => `| ${c.name} | ${c.email} | ${c.username} | \`${c.password}\` | ${c.phone} |`), ""];
      const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `comptes-demonstration-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const openConversation = async (id: string) => {
    setOpen(id);
    setReply("");
    try {
      setMessages(await api<DemoMessage[]>(`/admin/demo-catalogue/conversations/${id}`));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const sendReply = async () => {
    if (!open || !reply.trim()) return;
    setBusy(true);
    try {
      await api(`/admin/demo-catalogue/conversations/${open}/reply`, { method: "POST", body: { content: reply.trim() } });
      toast("Réponse envoyée au nom du compte de démonstration, signée « Équipe Trocoin ».", "success");
      setReply("");
      await openConversation(open);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const run_ = summary?.run;
  const pct = run_ && run_.total ? Math.round((run_.done / run_.total) * 100) : 0;
  const waiting = conversations.filter((c) => c.needsReply).length;
  const photosReady = !!summary && summary.dataset.listingsWithPhotos >= summary.dataset.listings * summary.dataset.minPhotoCoverage;

  return (
    <div>
      <div className="a-head">
        <div>
          <h1>Catalogue de démonstration</h1>
          <p className="mono">Annonces de lancement gérées par l&apos;équipe : comptes fictifs marqués « Démo », paiement en ligne désactivé, numéro jamais affiché, réponse automatique puis suivi ici.</p>
        </div>
      </div>

      {summary && (
        <div className="a-grid" style={{ marginBottom: 16 }}>
          <div className="a-stat"><span>Comptes (jeu de données / en base)</span><strong data-testid="demo-accounts">{summary.dataset.accounts} / {summary.database.accounts}</strong></div>
          <div className="a-stat"><span>Annonces (jeu de données / en base / en ligne)</span><strong data-testid="demo-listings">{summary.dataset.listings} / {summary.database.listings} / {summary.database.online}</strong></div>
          <div className="a-stat"><span>Photos prévues (annonces couvertes)</span><strong>{summary.dataset.photosPlanned} ({summary.dataset.listingsWithPhotos})</strong></div>
          <div className="a-stat"><span>Conversations en attente de réponse</span><strong data-testid="demo-waiting">{waiting}</strong></div>
        </div>
      )}

      <section className="a-panel" style={{ marginBottom: 16 }}>
        <h2>Ensemencement</h2>
        {summary && (
          <table className="a-table" style={{ maxWidth: 520, marginBottom: 12 }}>
            <thead><tr><th>Famille</th><th>Annonces prévues</th></tr></thead>
            <tbody>{Object.entries(summary.dataset.byFamily).sort((a, b) => b[1] - a[1]).map(([f, n]) => <tr key={f}><td>{FAMILY_LABELS[f] ?? f}</td><td>{n}</td></tr>)}</tbody>
          </table>
        )}
        {run_ && run_.status !== "idle" && (
          <div className={`a-alert${run_.status === "error" ? " danger" : ""}`} data-testid="demo-run-state">
            <strong>{run_.status === "running" ? `En cours : ${run_.done} / ${run_.total} (${pct} %)` : run_.status === "done" ? "Terminé" : "Interrompu"}</strong>
            {run_.startedAt && <> · lancé le {formatDateTime(run_.startedAt)}{run_.finishedAt ? `, fini le ${formatDateTime(run_.finishedAt)}` : ""}</>}
            <div className="mono" style={{ marginTop: 6 }}>Comptes créés {run_.accounts.created} (existants {run_.accounts.existing}) · annonces créées {run_.listings.created} (existantes {run_.listings.existing}, échecs {run_.listings.failed}, sans photo {run_.listings.withoutPhoto}) · photos {run_.photos.created} (échecs {run_.photos.failed})</div>
            {run_.lastError && <div className="mono" style={{ marginTop: 4 }}>Dernière erreur : {run_.lastError}</div>}
            {run_.errors.length > 1 && <details style={{ marginTop: 6 }}><summary>{run_.errors.length} erreurs</summary><ul className="mono">{run_.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
          </div>
        )}
        {summary && !photosReady && <div className="a-alert danger" data-testid="demo-photos-missing">Les photos du jeu de données ne sont pas encore résolues ({summary.dataset.listingsWithPhotos} annonces sur {summary.dataset.listings}) : rien ne sera créé tant que <code>scripts/demo-catalogue/resolve-photos.js</code> n&apos;a pas été exécuté et déployé (clé Pexels dans <code>private/pexels.key</code>).</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="a-btn primary" disabled={busy || run_?.status === "running" || !photosReady} onClick={run} data-testid="demo-run">{summary && summary.database.listings > 0 ? "Reprendre / compléter le catalogue" : "Créer le catalogue de démonstration"}</button>
          <button type="button" className="a-btn" disabled={!summary?.credentialsPending} onClick={takeCredentials} data-testid="demo-credentials">Récupérer les identifiants des comptes créés{summary?.credentialsPending ? ` (${summary.credentialsPending})` : ""}</button>
        </div>
        {credentials && credentials.length > 0 && (
          <div className="a-alert" style={{ marginTop: 12 }}>
            <strong>Identifiants affichés une seule fois</strong> — le fichier a été téléchargé. Gardez-le hors du dépôt de code.
            <table className="a-table" style={{ marginTop: 8 }}>
              <thead><tr><th>Nom</th><th>E-mail</th><th>Pseudo</th><th>Mot de passe</th></tr></thead>
              <tbody>{credentials.map((c) => <tr key={c.username}><td>{c.name}</td><td className="mono">{c.email}</td><td className="mono">{c.username}</td><td className="mono">{c.password}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="a-panel">
        <h2>Messages reçus par les comptes de démonstration</h2>
        <p className="mono">Chaque premier message reçoit une réponse automatique honnête. Vos réponses partent au nom du compte, signées « Équipe Trocoin ».</p>
        {conversations.length === 0 ? <p>Aucune conversation pour le moment.</p> : (
          <div className="a-two">
            <div>
              <table className="a-table" data-testid="demo-conversations">
                <thead><tr><th>Annonce</th><th>Membre</th><th>Dernier message</th><th></th></tr></thead>
                <tbody>
                  {conversations.map((c) => (
                    <tr key={c.id} style={{ background: c.needsReply ? "var(--a-warn-bg, #fff7e6)" : undefined }}>
                      <td>{c.listing ? c.listing.title : "Annonce supprimée"}{c.listing?.price != null ? <span className="mono"> · {formatEuros(c.listing.price)}</span> : null}<div className="mono">{c.seller.displayName}</div></td>
                      <td>{c.buyer.displayName}</td>
                      <td>{c.lastMessage ? <><span className="mono">{formatDateTime(c.lastMessage.createdAt)}</span> · {c.lastMessage.auto ? "(réponse automatique)" : c.lastMessage.staff ? "(équipe)" : c.lastMessage.content.slice(0, 80)}</> : "—"}{c.needsReply && <span className="a-pill danger" style={{ marginLeft: 6 }}>à répondre</span>}</td>
                      <td><button type="button" className="a-btn" onClick={() => openConversation(c.id)}>Ouvrir</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {open && (
              <div>
                <h3 className="mono">Conversation</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflow: "auto", padding: 8, border: "1px solid var(--a-line)", borderRadius: 8 }} data-testid="demo-thread">
                  {messages.map((m) => (
                    <div key={m.id} style={{ alignSelf: m.fromSeller ? "flex-end" : "flex-start", maxWidth: "85%", padding: "6px 10px", borderRadius: 10, background: m.fromSeller ? "#e6f4ee" : "#f2f2f2" }}>
                      <div className="mono" style={{ fontSize: ".72rem" }}>{m.fromSeller ? (m.auto ? "Réponse automatique" : m.staff ? "Équipe Trocoin" : "Compte démo") : "Membre"} · {formatDateTime(m.createdAt)}</div>
                      <div>{m.type === "text" ? m.content : `[${m.type}]`}</div>
                    </div>
                  ))}
                </div>
                <textarea className="a-textarea" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Votre réponse (elle sera signée « Équipe Trocoin »)" style={{ marginTop: 8, width: "100%" }} data-testid="demo-reply" />
                <button type="button" className="a-btn primary" disabled={busy || !reply.trim()} onClick={sendReply} style={{ marginTop: 6 }} data-testid="demo-reply-send">Répondre</button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
