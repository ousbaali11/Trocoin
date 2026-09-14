import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container page" style={{ textAlign: "center", padding: "80px 20px" }}>
      <p className="eyebrow">Erreur 404</p>
      <h1>Cette page n&apos;existe pas (ou plus)</h1>
      <p className="muted">L&apos;annonce a peut-être été retirée ou vendue.</p>
      <div className="row" style={{ justifyContent: "center" }}>
        <Link href="/" className="btn btn-primary">Retour à l&apos;accueil</Link>
        <Link href="/recherche" className="btn btn-outline">Parcourir les annonces</Link>
      </div>
    </div>
  );
}
