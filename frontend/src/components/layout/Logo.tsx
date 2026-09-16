export function Logo({ dark = true }: { dark?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.45rem", letterSpacing: "-0.02em", color: dark ? "var(--ink)" : "#fff" }}>
      <span
        aria-hidden="true"
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          background: "var(--accent)",
          color: "#fff",
          display: "grid",
          placeItems: "center",
          fontSize: "1rem",
          fontWeight: 800,
        }}
      >
        T
      </span>
      <span data-brand="">Trocoin</span>
    </span>
  );
}
