export function Rating({ value, count, size = 14 }: { value: number; count?: number; size?: number }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} aria-label={count ? `${value} sur 5, ${count} avis` : "Aucun avis"}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={i <= rounded ? "var(--ochre)" : i - 0.5 === rounded ? "url(#half)" : "var(--line)"}>
          <defs>
            <linearGradient id="half">
              <stop offset="50%" stopColor="var(--ochre)" />
              <stop offset="50%" stopColor="var(--line)" />
            </linearGradient>
          </defs>
          <path d="M12 2.5l2.9 6.2 6.7.8-4.9 4.6 1.3 6.7L12 17.5l-6 3.3 1.3-6.7L2.4 9.5l6.7-.8z" />
        </svg>
      ))}
      {count !== undefined && (
        <span className="small muted" style={{ marginLeft: 2 }}>
          {count > 0 ? `${value.toFixed(1)} (${count})` : "Nouveau"}
        </span>
      )}
    </span>
  );
}
