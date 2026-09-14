"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import type { NotificationPrefs, SellerSummary } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { PasswordInput } from "@/components/ui/PasswordInput";

const NOTIF_ROWS: Array<{ key: keyof NotificationPrefs; label: string; help: string; sms: boolean }> = [
  { key: "message", label: "Messages", help: "Nouveau message, proposition de prix", sms: false },
  { key: "transaction", label: "Achats et ventes", help: "Paiement, expédition, remise, litige", sms: true },
  { key: "alerte_recherche", label: "Alertes de recherche", help: "Nouvelles annonces pour vos recherches sauvegardées", sms: false },
  { key: "moderation", label: "Modération", help: "Décision sur une annonce ou un signalement", sms: true },
  { key: "systeme", label: "Informations Trocoin", help: "Nouveautés, changements importants du service", sms: false },
];

export default function ParametresPage() {
  const { user, refresh, logout } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ displayName: "", city: "", postalCode: "" });
  const [shop, setShop] = useState({ shopName: "", shopDescription: "", shopAddress: "", shopHours: "", shopWebsite: "" });
  const [pro, setPro] = useState({ siret: "", shopName: "" });
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [globals, setGlobals] = useState({ notifyPush: true, notifySms: false });
  const [blocks, setBlocks] = useState<SellerSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setForm({ displayName: user.displayName, city: user.city ?? "", postalCode: user.postalCode ?? "" });
    setShop({ shopName: user.shopName ?? "", shopDescription: user.shopDescription ?? "", shopAddress: user.shopAddress ?? "", shopHours: user.shopHours ?? "", shopWebsite: user.shopWebsite ?? "" });
    setGlobals({ notifyPush: user.notifyPush, notifySms: user.notifySms });
    if (user.notificationPrefs) setPrefs(user.notificationPrefs);
    api<SellerSummary[]>("/users/me/blocks").then(setBlocks).catch(() => null);
  }, [user]);

  const save = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === "" ? undefined : v]));
      await api("/users/me", { method: "PATCH", body: clean });
      await refresh();
      toast(ok, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (path: string, file: File, ok: string) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api(path, { method: "POST", formData: fd });
      await refresh();
      toast(ok, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const setPref = async (type: keyof NotificationPrefs, channel: "push" | "sms" | "email", value: boolean) => {
    if (!prefs) return;
    const next = { ...prefs, [type]: { ...prefs[type], [channel]: value } };
    setPrefs(next);
    // Activer un canal réactive l'interrupteur global correspondant s'il était coupé
    const body: Record<string, unknown> = { notificationPrefs: next };
    if (channel === "push" && value && !globals.notifyPush) body.notifyPush = true;
    if (channel === "sms" && value && !globals.notifySms) body.notifySms = true;
    try {
      await api("/users/me", { method: "PATCH", body });
      await refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const becomePro = async () => {
    setBusy(true);
    try {
      await api("/users/me/become-pro", { method: "POST", body: pro });
      await refresh();
      toast("Votre compte est maintenant professionnel.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const exportData = async () => {
    try {
      const data = await api("/users/me/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `trocoin-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      toast("Archive téléchargée (format JSON).", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    try {
      await api("/users/me", { method: "DELETE" });
      toast("Votre compte a été supprimé.", "success");
      logout();
      router.push("/");
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  if (!user) return null;
  const isPro = user.accountType === "professionnel";
  const phone = user.phoneNumber.replace(/^\+33/, "0").replace(/(\d{2})(?=\d)/g, "$1 ");

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>Paramètres</h1>
        <Link href="/aide/changer-mes-informations" className="small">Aide sur les paramètres</Link>
      </div>

      <section className="panel" id="profil">
        <h2 className="h3">Profil public</h2>
        <div className="row" style={{ marginBottom: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--bottle)", color: "var(--white)", display: "grid", placeItems: "center", overflow: "hidden", fontSize: "1.4rem", fontWeight: 700 }}>
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl(user.avatarUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : user.displayName.slice(0, 1).toUpperCase()}
          </div>
          <label className="btn btn-outline btn-sm">
            Changer la photo
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload("/users/me/avatar", e.target.files[0], "Photo de profil mise à jour.")} />
          </label>
          <Link href={`/vendeurs/${user.id}`} className="btn btn-ghost btn-sm">Voir mon profil public</Link>
        </div>
        <div className="form-row">
          <div className="field"><label htmlFor="dn">Pseudo affiché</label><input id="dn" className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={50} /><span className="hint">Visible sur vos annonces et dans la messagerie.</span></div>
          <div className="field"><label htmlFor="city">Ville</label><input id="city" className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={100} /></div>
          <div className="field"><label htmlFor="cp">Code postal</label><input id="cp" className="input" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} maxLength={5} inputMode="numeric" /></div>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={() => save({ displayName: form.displayName, city: form.city, postalCode: form.postalCode }, "Profil enregistré.")}>Enregistrer</button>
      </section>

      <section className="panel" id="identifiants">
        <h2 className="h3">Identifiants</h2>
        <p className="small muted">Ces informations ne sont jamais affichées publiquement. Le numéro de mobile identifie le compte et ne se modifie pas.</p>
        <dl className="small" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", margin: 0 }}>
          <dt className="muted">Numéro de mobile</dt><dd style={{ margin: 0 }}>{phone}</dd>
          <dt className="muted">E-mail</dt><dd style={{ margin: 0 }}>{user.email || <span className="muted">Aucune adresse enregistrée (compte créé par SMS)</span>}</dd>
          <dt className="muted">Nom d&apos;utilisateur</dt><dd style={{ margin: 0 }}>{user.username || <span className="muted">—</span>}</dd>
          {(user.firstName || user.lastName) && <><dt className="muted">Nom</dt><dd style={{ margin: 0 }}>{[user.firstName, user.lastName].filter(Boolean).join(" ")}</dd></>}
          {user.companyName && <><dt className="muted">Raison sociale</dt><dd style={{ margin: 0 }}>{user.companyName}</dd></>}
        </dl>
      </section>

      <section className="panel" id="mot-de-passe">
        <h2 className="h3">Mot de passe</h2>
        <p className="small muted">Après le changement, toutes vos sessions sont déconnectées : vous vous reconnecterez avec le nouveau mot de passe.</p>
        {pwError && <div className="alert alert-error" role="alert">{pwError}</div>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPwError(null);
            if (pw.next !== pw.confirm) return setPwError("Les deux nouveaux mots de passe ne correspondent pas.");
            setPwBusy(true);
            try {
              await api("/auth/password/change", { method: "POST", body: { currentPassword: pw.current, newPassword: pw.next, newPasswordConfirmation: pw.confirm } });
              toast("Mot de passe modifié. Reconnectez-vous.", "success");
              logout();
              router.push("/connexion");
            } catch (err) {
              setPwError((err as Error).message);
            } finally {
              setPwBusy(false);
            }
          }}
        >
          <div className="form-row">
            <div className="field"><label htmlFor="pw-current">Mot de passe actuel</label><PasswordInput id="pw-current" value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} autoComplete="current-password" /></div>
            <div className="field"><label htmlFor="pw-next">Nouveau mot de passe</label><PasswordInput id="pw-next" value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} autoComplete="new-password" minLength={8} /><span className="hint">8 caractères minimum.</span></div>
            <div className="field"><label htmlFor="pw-confirm">Confirmer le nouveau</label><PasswordInput id="pw-confirm" value={pw.confirm} onChange={(v) => setPw({ ...pw, confirm: v })} autoComplete="new-password" invalid={pw.confirm.length > 0 && pw.next !== pw.confirm} /></div>
          </div>
          <button className="btn btn-primary" disabled={pwBusy || pw.current.length === 0 || pw.next.length < 8 || pw.next !== pw.confirm}>{pwBusy ? "Enregistrement…" : "Changer le mot de passe"}</button>
          <p className="small muted" style={{ marginTop: 8 }}>Compte créé par SMS sans mot de passe ? Utilisez <Link href="/mot-de-passe-oublie">Mot de passe oublié</Link> pour en définir un.</p>
        </form>
      </section>

      <section className="panel" id="notifications">
        <h2 className="h3">Notifications</h2>
        <p className="small muted">Choisissez, pour chaque type d&apos;évènement, les canaux par lesquels vous souhaitez être prévenu. Les notifications restent toujours consultables dans <Link href="/compte/notifications">Notifications</Link>.</p>
        {prefs ? (
          <div className="table-wrap">
            <table className="table" style={{ marginBottom: 8 }}>
              <thead>
                <tr>
                  <th>Évènement</th>
                  <th style={{ textAlign: "center" }}>Dans le compte</th>
                  <th style={{ textAlign: "center" }}>Push</th>
                  <th style={{ textAlign: "center" }}>E-mail</th>
                  <th style={{ textAlign: "center" }}>SMS</th>
                </tr>
              </thead>
              <tbody>
                {NOTIF_ROWS.map((r) => (
                  <tr key={r.key}>
                    <td><strong>{r.label}</strong><br /><span className="small muted">{r.help}</span></td>
                    <td style={{ textAlign: "center" }}><input type="checkbox" checked disabled aria-label={`${r.label} : toujours dans le compte`} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} /></td>
                    <td style={{ textAlign: "center" }}><input type="checkbox" checked={prefs[r.key].push} onChange={(e) => setPref(r.key, "push", e.target.checked)} aria-label={`${r.label} par push`} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} /></td>
                    <td style={{ textAlign: "center" }}><input type="checkbox" checked={prefs[r.key].email} onChange={(e) => setPref(r.key, "email", e.target.checked)} aria-label={`${r.label} par e-mail`} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} /></td>
                    <td style={{ textAlign: "center" }}>
                      {r.sms ? (
                        <input type="checkbox" checked={prefs[r.key].sms} onChange={(e) => setPref(r.key, "sms", e.target.checked)} aria-label={`${r.label} par SMS`} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                      ) : (
                        <span className="small muted" title="Le SMS est réservé aux évènements critiques">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="skeleton" style={{ height: 160 }} />
        )}
        <div className="row" style={{ gap: 16 }}>
          <label className="checkbox small"><input type="checkbox" checked={globals.notifyPush} onChange={(e) => { setGlobals({ ...globals, notifyPush: e.target.checked }); save({ notifyPush: e.target.checked }, e.target.checked ? "Push activé." : "Push coupé pour tous les évènements."); }} /> Autoriser le push</label>
          <label className="checkbox small"><input type="checkbox" checked={globals.notifySms} onChange={(e) => { setGlobals({ ...globals, notifySms: e.target.checked }); save({ notifySms: e.target.checked }, e.target.checked ? "SMS activés pour les évènements critiques cochés." : "SMS coupés."); }} /> Autoriser les SMS (évènements critiques uniquement)</label>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>Phase de test : les e-mails sont préparés mais pas encore envoyés ; vos choix sont enregistrés et s&apos;appliqueront dès l&apos;activation de l&apos;envoi.</p>
      </section>

      <section className="panel" id="pro">
        <h2 className="h3">{isPro ? "Ma boutique" : "Passer en compte professionnel"}</h2>
        {isPro ? (
          <>
            <p className="small muted">SIRET : {user.siret}{user.siretVerified ? " · vérifié au registre des entreprises" : ""} · Badge Pro actif. Votre boutique est visible à l&apos;adresse <Link href={`/vendeurs/${user.id}`}>/vendeurs/{user.id.slice(0, 8)}…</Link></p>
            <div className="row" style={{ marginBottom: 12 }}>
              {user.shopLogoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(user.shopLogoUrl)} alt="Logo" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover" }} />
              )}
              <label className="btn btn-outline btn-sm">
                Logo de la boutique
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload("/users/me/shop-logo", e.target.files[0], "Logo mis à jour.")} />
              </label>
            </div>
            <div className="form-row">
              <div className="field"><label htmlFor="sn">Nom de la boutique</label><input id="sn" className="input" value={shop.shopName} onChange={(e) => setShop({ ...shop, shopName: e.target.value })} maxLength={80} /></div>
              <div className="field"><label htmlFor="sw">Site web</label><input id="sw" className="input" value={shop.shopWebsite} onChange={(e) => setShop({ ...shop, shopWebsite: e.target.value })} placeholder="https://…" /></div>
              <div className="field"><label htmlFor="sa">Adresse</label><input id="sa" className="input" value={shop.shopAddress} onChange={(e) => setShop({ ...shop, shopAddress: e.target.value })} maxLength={200} /></div>
              <div className="field"><label htmlFor="sh">Horaires</label><input id="sh" className="input" value={shop.shopHours} onChange={(e) => setShop({ ...shop, shopHours: e.target.value })} maxLength={200} placeholder="Lun–Sam 9h–19h" /></div>
            </div>
            <div className="field"><label htmlFor="sd">Présentation</label><textarea id="sd" className="textarea" value={shop.shopDescription} onChange={(e) => setShop({ ...shop, shopDescription: e.target.value })} maxLength={2000} /></div>
            <div className="row">
              <button className="btn btn-primary" disabled={busy} onClick={() => save(shop, "Boutique enregistrée.")}>Enregistrer la boutique</button>
              <Link href="/compte/boutique" className="btn btn-outline">Équipe et import de catalogue</Link>
            </div>
          </>
        ) : user.accountType === "admin" ? (
          <p className="muted" style={{ margin: 0 }}>Compte administrateur.</p>
        ) : (
          <>
            <p className="small muted">Badge Pro, page boutique, statistiques, dépôts illimités. Renseignez le SIRET de votre entreprise (14 chiffres) : il est contrôlé auprès du registre public des entreprises. <Link href="/aide/espace-pro">En savoir plus</Link>.</p>
            <div className="form-row">
              <div className="field"><label htmlFor="siret">SIRET</label><input id="siret" className="input" value={pro.siret} onChange={(e) => setPro({ ...pro, siret: e.target.value.replace(/\D/g, "").slice(0, 14) })} inputMode="numeric" /></div>
              <div className="field"><label htmlFor="psn">Nom commercial</label><input id="psn" className="input" value={pro.shopName} onChange={(e) => setPro({ ...pro, shopName: e.target.value })} maxLength={80} /></div>
            </div>
            <button className="btn btn-primary" disabled={busy || pro.siret.length !== 14 || pro.shopName.trim().length < 2} onClick={becomePro}>Activer le compte professionnel</button>
          </>
        )}
      </section>

      <section className="panel" id="bloques">
        <h2 className="h3">Utilisateurs bloqués</h2>
        {blocks.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Aucun utilisateur bloqué. Vous pouvez bloquer un membre depuis une conversation ou son profil.</p> : (
          <div className="stack">
            {blocks.map((b) => (
              <div key={b.id} className="row spread">
                <span>{b.displayName}</span>
                <button className="btn btn-ghost btn-sm" onClick={async () => { try { await api(`/users/me/blocks/${b.id}`, { method: "DELETE" }); setBlocks(blocks.filter((x) => x.id !== b.id)); toast("Utilisateur débloqué.", "success"); } catch (e) { toast((e as Error).message, "error"); } }}>Débloquer</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel" id="donnees" style={{ borderColor: "#ecc7bb" }}>
        <h2 className="h3">Mes données (RGPD)</h2>
        <p className="small muted">Téléchargez une copie de vos données (profil, annonces, messages, avis, transactions, favoris, préférences) ou supprimez définitivement votre compte. La suppression retire vos annonces, anonymise votre profil et libère votre numéro, votre e-mail et votre nom d&apos;utilisateur. <Link href="/aide/mes-donnees-rgpd">Détails</Link>.</p>
        <div className="row">
          <button className="btn btn-outline" onClick={exportData}>Télécharger mes données</button>
          <button className="btn btn-danger" onClick={() => setDeleteOpen(true)}>Supprimer mon compte</button>
        </div>
      </section>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Supprimer définitivement mon compte ?">
        <p>Cette action est irréversible. Une transaction en cours empêche la suppression : terminez-la d&apos;abord.</p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={() => setDeleteOpen(false)}>Annuler</button>
          <button className="btn btn-danger" disabled={busy} onClick={deleteAccount}>Oui, supprimer</button>
        </div>
      </Modal>
    </div>
  );
}
