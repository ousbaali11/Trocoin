"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import type { ImportReport, ManagedShop, ShopMember } from "@/lib/types";

export default function BoutiquePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<ShopMember[]>([]);
  const [managed, setManaged] = useState<ManagedShop[]>([]);
  const [phone, setPhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [onBehalfOf, setOnBehalfOf] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const isPro = user?.accountType === "professionnel";

  useEffect(() => {
    if (isPro) api<ShopMember[]>("/users/me/shop/members").then(setMembers).catch(() => null);
    api<ManagedShop[]>("/users/me/shops").then(setManaged).catch(() => null);
  }, [isPro]);

  const invite = async () => {
    setBusy(true);
    try {
      setMembers(await api<ShopMember[]>("/users/me/shop/members", { method: "POST", body: { phoneNumber: phone } }));
      setPhone("");
      toast("Membre ajouté : il peut désormais gérer vos annonces.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const removeMember = async (id: string) => {
    await api(`/users/me/shop/members/${id}`, { method: "DELETE" });
    setMembers((m) => m.filter((x) => x.user?.id !== id));
  };
  const runImport = async () => {
    if (!file) return;
    setBusy(true);
    setReport(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (onBehalfOf) fd.append("onBehalfOf", onBehalfOf);
      const r = await api<ImportReport>("/listings/import", { method: "POST", formData: fd });
      setReport(r);
      toast(`${r.created} annonce(s) créée(s), ${r.updated} mise(s) à jour.`, r.errors.length ? "info" : "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1>Ma boutique</h1>
        <p className="muted" style={{ margin: 0 }}>Gestion à plusieurs et import de catalogue. Les informations publiques de la vitrine se modifient dans <Link href="/compte/parametres">Paramètres</Link>.</p>
      </div>

      {managed.length > 0 && (
        <section className="panel">
          <h3>Boutiques que je gère</h3>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {managed.map((s) => <li key={s.ownerId}>{s.shopName} — <Link href={`/vendeurs/${s.ownerId}`}>voir la vitrine</Link></li>)}
          </ul>
          <p className="small muted" style={{ margin: "8px 0 0" }}>Vous pouvez publier « au nom de » ces boutiques depuis le formulaire de dépôt et gérer leurs annonces dans Mes annonces.</p>
        </section>
      )}

      {isPro ? (
        <>
          <section className="panel">
            <h3>Membres de l&apos;équipe</h3>
            <p className="small muted">Invitez des collaborateurs par leur numéro de mobile (ils doivent déjà avoir un compte Trocoin). Ils pourront créer, modifier et mettre en pause les annonces de la boutique ; vous restez le vendeur affiché et le seul à gérer la vitrine et les paiements.</p>
            <div className="row" style={{ marginBottom: 12 }}>
              <input className="input" style={{ maxWidth: 260 }} placeholder="06 12 34 56 78" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Numéro du collaborateur" />
              <button className="btn btn-primary" disabled={busy || phone.replace(/\D/g, "").length < 10} onClick={invite}>Ajouter</button>
            </div>
            {members.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Aucun membre pour le moment.</p> : (
              <table className="table">
                <thead><tr><th>Membre</th><th>Numéro</th><th>Rôle</th><th></th></tr></thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td>{m.user?.displayName}</td>
                      <td className="muted">{m.user?.phoneMasked}</td>
                      <td>Gestionnaire</td>
                      <td>{m.user && <button className="btn btn-ghost btn-sm" style={{ color: "var(--brick)" }} onClick={() => removeMember(m.user!.id)}>Retirer</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <h3>Import de catalogue (CSV ou XML)</h3>
            <p className="small muted">
              Colonnes reconnues : <code>reference</code>, <code>titre</code>, <code>description</code>, <code>categorie</code> (slug, ex. <code>voitures</code>), <code>prix</code>, <code>type_prix</code>, <code>etat</code>, <code>ville</code>, <code>code_postal</code>, <code>livraison</code> (oui/non), <code>latitude</code>, <code>longitude</code>, et <code>attr_…</code> pour les critères (ex. <code>attr_marque</code>). Une ligne avec une référence déjà importée met l&apos;annonce à jour. 500 lignes maximum ; les photos s&apos;ajoutent ensuite depuis Mes annonces.
            </p>
            <div className="row">
              <input type="file" accept=".csv,.xml,.txt,text/csv,text/xml,application/xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Fichier de catalogue" />
              {managed.length > 0 && (
                <select className="select" style={{ maxWidth: 260 }} value={onBehalfOf} onChange={(e) => setOnBehalfOf(e.target.value)} aria-label="Boutique cible">
                  <option value="">Ma boutique</option>
                  {managed.map((s) => <option key={s.ownerId} value={s.ownerId}>{s.shopName}</option>)}
                </select>
              )}
              <button className="btn btn-primary" disabled={busy || !file} onClick={runImport}>{busy ? "Import…" : "Importer"}</button>
              <a className="btn btn-outline btn-sm" href={`data:text/csv;charset=utf-8,${encodeURIComponent("reference;titre;description;categorie;prix;type_prix;etat;ville;code_postal;livraison;attr_marque;attr_modele\nREF-001;Exemple de titre;Description détaillée de l'article.;telephonie;199;fixe;tres_bon_etat;Lyon;69003;oui;Apple;iPhone 12\n")}`} download="modele-import-trocoin.csv">Télécharger un modèle</a>
            </div>
            {report && (
              <div className="alert alert-info" style={{ marginTop: 14 }}>
                <strong>{report.total} ligne(s)</strong> : {report.created} créée(s), {report.updated} mise(s) à jour{report.pending > 0 && `, ${report.pending} en vérification`}{report.errors.length > 0 && `, ${report.errors.length} en erreur`}.
                {report.errors.length > 0 && (
                  <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                    {report.errors.slice(0, 20).map((e, i) => <li key={i}>Ligne {e.line}{e.reference ? ` (${e.reference})` : ""} : {e.error}</li>)}
                  </ul>
                )}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="panel">
          <p style={{ margin: 0 }}>La gestion d&apos;équipe et l&apos;import de catalogue sont réservés aux comptes professionnels. <Link href="/compte/parametres">Passer en compte professionnel</Link> (gratuit).</p>
        </section>
      )}
    </div>
  );
}
