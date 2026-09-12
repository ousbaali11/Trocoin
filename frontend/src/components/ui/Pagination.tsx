"use client";

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const window = 2;
  const items: number[] = [];
  for (let p = Math.max(1, page - window); p <= Math.min(pages, page + window); p++) items.push(p);
  return (
    <nav className="row" aria-label="Pagination" style={{ justifyContent: "center", marginTop: 28 }}>
      <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Précédent
      </button>
      {items[0] > 1 && (
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => onChange(1)}>1</button>
          {items[0] > 2 && <span className="muted">…</span>}
        </>
      )}
      {items.map((p) => (
        <button key={p} className={`btn btn-sm ${p === page ? "btn-dark" : "btn-ghost"}`} onClick={() => onChange(p)} aria-current={p === page ? "page" : undefined}>
          {p}
        </button>
      ))}
      {items[items.length - 1] < pages && (
        <>
          {items[items.length - 1] < pages - 1 && <span className="muted">…</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => onChange(pages)}>{pages}</button>
        </>
      )}
      <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Suivant
      </button>
    </nav>
  );
}
