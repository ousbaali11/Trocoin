"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { formatDateTime } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import type { LegalPage } from "@/lib/types";

export default function AdminPagesPage() {
  const { toast } = useToast();
  const [pages, setPages] = useState<LegalPage[]>([]);
  const [slug, setSlug] = useState("cgu");
  const [draft, setDraft] = useState<LegalPage | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<LegalPage[]>("/admin/pages").then(setPages).catch((e) => toast(e.message, "error")), [toast]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const p = pages.find((x) => x.slug === slug);
    if (p) setDraft({ ...p });
  }, [pages, slug]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await api(`/admin/pages/${draft.slug}`, { method: "PATCH", body: { title: draft.title, content: draft.content, published: draft.published } });
      toast("Page enregistrée : visible immédiatement sur le site (cache 60 s).", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="a-head"><div><h1>Pages légales et éditoriales</h1><p>CGU, confidentialité, mentions légales, à propos. Markdown simplifié : <code>## Titre</code>, <code>- liste</code>, <code>**gras**</code>, <code>_italique_</code>. Le HTML est neutralisé au rendu.</p></div></div>
      <div className="a-filters">
        {pages.map((p) => (
          <button key={p.slug} className={`a-btn ${p.slug === slug ? "primary" : ""}`} onClick={() => { setSlug(p.slug); setPreview(false); }}>
            {p.title} {!p.published && <span className="a-pill warn">brouillon</span>}
          </button>
        ))}
      </div>
      {draft && (
        <div className="a-panel">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <label className="mono" style={{ flex: 1, minWidth: 240 }}>Titre<input className="a-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: ".88rem" }}><input type="checkbox" checked={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} /> Publiée</label>
            <span className="mono">/{draft.slug} · modifiée {formatDateTime(draft.updatedAt)}</span>
            <button className="a-btn" onClick={() => setPreview((p) => !p)}>{preview ? "Éditer" : "Aperçu"}</button>
            <button className="a-btn primary" disabled={busy} onClick={save}>Enregistrer</button>
            <a className="a-btn" href={`/${draft.slug}`} target="_blank" rel="noreferrer">Voir sur le site ↗</a>
          </div>
          {preview ? (
            <div style={{ border: "1px solid var(--a-line)", borderRadius: 8, padding: 20, background: "#fff" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.content) }} />
          ) : (
            <textarea className="a-textarea" style={{ minHeight: 520, fontFamily: "ui-monospace, Consolas, monospace", fontSize: ".85rem" }} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
          )}
        </div>
      )}
    </div>
  );
}
