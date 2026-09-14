"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import type { SellerSummary } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { PasswordInput } from "@/components/ui/PasswordInput";

export default function ParametresPage() {
  const { user, refresh, logout } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ displayName: "", city: "", postalCode: "", notifyPush: true, notifySms: false });
  const [shop, setShop] = useState({ shopName: "", shopDescription: "", shopAddress: "", shopHours: "", shopWebsite: "" });
  const [pro, setPro] = useState({ siret: "", shopName: "" });
  const [blocks, setBlocks] = useState<SellerSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setForm({ displayName: user.displayName, city: user.city ?? "", postalCode: user.postalCode ?? "", notifyPush: user.notifyPush, notifySms: user.notifySms });
    setShop({ shopName: user.shopName ?? "", shopDescription: user.shopDescription ?? "", shopAddress: user.shopAddress ?? "", shopHours: user.shopHours ?? "", shopWebsite: user.shopWebsite ?? "" });
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

  return (
    <div className="stack" style={{ gap: 16 }}>
      <h1>Paramètres</h1>

      <section className="panel">
        <h3>Profil</h3>
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
        </div>
        <div className="form-row">
          <div className="field"><label htmlFor="dn">Pseudo affiché</label><input id="dn" className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={50} /></div>
          <div className="field"><label htmlFor="ph">Numéro de mobile</label><input id="ph" className="input" value={user.phoneNumber.replace(/^\+33/, "0").replace(/(\d{2})(?=\d)/g, "$1 ")} disabled /><span className="hint">Identifiant du compte, non modifiable. Il n&apos;est jamais affiché publiquement.</span></div>
          <div className="field"><label htmlFor="city">Ville</label><input id="city" className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={100} /></div>
          <div className="field"><label htmlFor="cp">Code postal</label><input id="cp" className="input" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} maxLength={5} /></div>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={() => save({ displayName: form.displayName, city: form.city, postalCode: form.postalCode }, "Profil enregistré.")}>Enregistrer</button>
      </section>

      <section className="panel">
        <h3>Mot de passe</h3>
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
          <p className="small muted" style={{ marginTop: 8 }}>Compte créé par SMS sans mot de passe ? Utilisez <a href="/mot-de-passe-oublie">Mot de passe oublié</a> pour en définir un.</p>
        </form>
      </section>

      <section className="panel">
        <h3>Notifications</h3>
        <label className="checkbox" style={{ marginBottom: 8 }}><input type="checkbox" checked={form.notifyPush} onChange={(e) => { setForm({ ...form, notifyPush: e.target.checked }); save({ notifyPush: e.target.checked }, "Préférence enregistrée."); }} /> Notifications (messages, transactions, alertes de recherche)</label>
        <label className="checkbox"><input type="checkbox" checked={form.notifySms} onChange={(e) => { setForm({ ...form, notifySms: e.target.checked }); save({ notifySms: e.target.checked }, "Préférence enregistrée."); }} /> SMS pour les évènements critiques (paiement, litige, modération)</label>
      </section>

      <section className="panel">
        <h3>{isPro ? "Ma boutique" : "Passer en compte professionnel"}</h3>
        {isPro ? (
          <>
            <p className="small muted">SIRET : {user.siret} · Badge Pro actif. Votre boutique est visible à l&apos;adresse <a href={`/vendeurs/${user.id}`}>/vendeurs/{user.id.slice(0, 8)}…</a></p>
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
            <button className="btn btn-primary" disabled={busy} onClick={() => save(shop, "Boutique enregistrée.")}>Enregistrer la boutique</button>
          </>
        ) : user.accountType === "admin" ? (
          <p className="muted" style={{ margin: 0 }}>Compte administrateur.</p>
        ) : (
          <>
            <p className="small muted">Badge Pro, page boutique, statistiques, dépôts illimités. Renseignez le SIRET de votre entreprise (14 chiffres).</p>
            <div className="form-row">
              <div className="field"><label htmlFor="siret">SIRET</label><input id="siret" className="input" value={pro.siret} onChange={(e) => setPro({ ...pro, siret: e.target.value.replace(/\D/g, "").slice(0, 14) })} inputMode="numeric" /></div>
              <div className="field"><label htmlFor="psn">Nom commercial</label><input id="psn" className="input" value={pro.shopName} onChange={(e) => setPro({ ...pro, shopName: e.target.value })} maxLength={80} /></div>
            </div>
            <button className="btn btn-dark" disabled={busy || pro.siret.length !== 14 || pro.shopName.trim().length < 2} onClick={becomePro}>Activer le compte professionnel</button>
          </>
        )}
      </section>

      <section className="panel">
        <h3>Utilisateurs bloqués</h3>
        {blocks.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Aucun utilisateur bloqué.</p> : (
          <div className="stack">
            {blocks.map((b) => (
              <div key={b.id} className="row spread">
                <span>{b.displayName}</span>
                <button className="btn btn-ghost btn-sm" onClick={async () => { await api(`/users/me/blocks/${b.id}`, { method: "DELETE" }); setBlocks(blocks.filter((x) => x.id !== b.id)); }}>Débloquer</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel" style={{ borderColor: "#ecc7bb" }}>
        <h3>Mes données (RGPD)</h3>
        <p className="small muted">Téléchargez une copie de vos données ou supprimez définitivement votre compte. La suppression retire vos annonces, anonymise votre profil et libère votre numéro.</p>
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
