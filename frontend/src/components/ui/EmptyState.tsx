import Link from "next/link";

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: { href: string; label: string } }) {
  return (
    <div className="panel" style={{ textAlign: "center", padding: "48px 24px" }}>
      <h2 className="h3" style={{ marginBottom: 6 }}>{title}</h2>
      {text && <p className="muted" style={{ maxWidth: 420, margin: "0 auto 16px" }}>{text}</p>}
      {action && (
        <Link href={action.href} className="btn btn-primary">
          {action.label}
        </Link>
      )}
    </div>
  );
}
