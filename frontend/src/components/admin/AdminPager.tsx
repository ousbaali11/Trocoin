"use client";

export function AdminPager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 12, fontSize: ".85rem" }}>
      <span className="mono">{total} résultat{total > 1 ? "s" : ""} · page {page}/{pages}</span>
      <button className="a-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Précédent</button>
      <button className="a-btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Suivant</button>
    </div>
  );
}

export function statusPill(status: string): { cls: string; label: string } {
  const map: Record<string, { cls: string; label: string }> = {
    en_ligne: { cls: "ok", label: "En ligne" },
    en_attente: { cls: "warn", label: "À vérifier" },
    brouillon: { cls: "", label: "Brouillon" },
    vendue: { cls: "accent", label: "Vendue" },
    refusee: { cls: "danger", label: "Refusée" },
    expiree: { cls: "", label: "Expirée" },
    desactivee: { cls: "", label: "En pause" },
    ouvert: { cls: "warn", label: "Ouvert" },
    traite: { cls: "ok", label: "Traité" },
    rejete: { cls: "", label: "Rejeté" },
    sequestre: { cls: "warn", label: "Séquestre" },
    livree: { cls: "warn", label: "Expédiée" },
    confirme: { cls: "ok", label: "Terminée" },
    litige: { cls: "danger", label: "Litige" },
    rembourse: { cls: "", label: "Remboursée" },
    annulee: { cls: "", label: "Annulée" },
    particulier: { cls: "", label: "Particulier" },
    professionnel: { cls: "accent", label: "Pro" },
    admin: { cls: "danger", label: "Admin" },
  };
  return map[status] || { cls: "", label: status };
}
