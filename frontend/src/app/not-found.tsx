import Link from "next/link";

/** Repli hors du groupe (site) : la vraie page 404 du site est app/(site)/not-found.tsx (avec en-tête et pied de page). */
export default function RootNotFound() {
  return (
    <main id="contenu" className="container page" style={{ textAlign: "center", padding: "80px 20px" }}>
      <p className="eyebrow">Erreur 404</p>
      <h1>Cette page n&apos;existe pas</h1>
      <p><Link href="/" className="btn btn-primary">Retour à l&apos;accueil</Link></p>
    </main>
  );
}
