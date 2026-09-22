"use client";

/** Dernier filet (AUDIT §69) : erreur dans la mise en page racine elle-même — page minimale en français. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, textAlign: "center" }}>
        <h1>Un petit contretemps</h1>
        <p>Le site ne répond pas pour le moment. Réessayez dans quelques instants.</p>
        <button type="button" onClick={() => reset()} style={{ padding: "10px 18px", fontSize: 16 }}>Réessayer</button>
      </body>
    </html>
  );
}
