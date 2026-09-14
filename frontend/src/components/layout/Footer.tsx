import Link from "next/link";
import { Logo } from "./Logo";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.grid}`}>
        <div>
          <Logo dark />
          <p className={styles.tagline}>Les petites annonces entre voisins, en France. Un compte = un numéro de mobile français.</p>
        </div>
        <div>
          <h4>Trocoin</h4>
          <Link href="/a-propos">À propos</Link>
          <Link href="/aide">Centre d&apos;aide</Link>
          <Link href="/aide/conseils-de-securite">Conseils de sécurité</Link>
          <Link href="/aide/espace-pro">Espace professionnel</Link>
        </div>
        <div>
          <h4>Catégories</h4>
          <Link href="/recherche?category=immobilier">Immobilier</Link>
          <Link href="/recherche?category=vehicules">Véhicules</Link>
          <Link href="/recherche?category=multimedia">Électronique</Link>
          <Link href="/recherche?category=maison-jardin">Maison &amp; Jardin</Link>
          <Link href="/recherche">Toutes les catégories</Link>
        </div>
        <div>
          <h4>Informations légales</h4>
          <Link href="/cgu">Conditions générales d&apos;utilisation</Link>
          <Link href="/confidentialite">Politique de confidentialité</Link>
          <Link href="/mentions-legales">Mentions légales</Link>
          <Link href="/aide/signaler">Signaler un contenu</Link>
        </div>
      </div>
      <div className={`container ${styles.bottom}`}>
        <span>© {new Date().getFullYear()} Trocoin — Plateforme éditée en France.</span>
        <span>Paiement sécurisé · Messagerie intégrée · Modération humaine</span>
      </div>
    </footer>
  );
}
