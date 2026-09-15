import Link from "next/link";
import { Logo } from "./Logo";
import styles from "./Footer.module.css";

/**
 * Pied de page en quatre colonnes (À propos, Informations légales, Nos solutions pros, Des
 * questions ?), tous les liens mènent à des pages existantes. Volontairement absents tant qu'ils
 * n'existent pas pour de vrai : applications mobiles, réseaux sociaux, note d'avis externes.
 * Fond clair, comme le reste du site.
 */
const ANNEE_CREATION = 2026;

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.grid}`}>
        <div>
          <h2>À propos</h2>
          <Link href="/a-propos">Qui sommes-nous</Link>
          <Link href="/aide/conseils-de-securite">Conseils de sécurité</Link>
          <Link href="/aide/signaler">Signaler un contenu</Link>
          <Link href="/recherche">Toutes les annonces</Link>
        </div>
        <div>
          <h2>Informations légales</h2>
          <Link href="/cgu">Conditions générales d&apos;utilisation</Link>
          <Link href="/confidentialite">Politique de confidentialité</Link>
          <Link href="/mentions-legales">Mentions légales</Link>
          <Link href="/accessibilite">Accessibilité</Link>
        </div>
        <div>
          <h2>Nos solutions pros</h2>
          <Link href="/aide/espace-pro">Espace professionnel</Link>
          <Link href="/aide/formules">Formules et mises en avant</Link>
          <Link href="/aide/boutique-equipe-import">Boutique, équipe et import de catalogue</Link>
          <Link href="/inscription">Créer un compte professionnel</Link>
        </div>
        <div>
          <h2>Des questions ?</h2>
          <Link href="/aide">Centre d&apos;aide</Link>
          <Link href="/aide/rechercher">Rechercher une annonce</Link>
          <Link href="/aide/alertes">Alertes et recherches sauvegardées</Link>
          <Link href="/aide/historique-et-favoris">Historique et favoris</Link>
        </div>
      </div>
      <div className={`container ${styles.bottom}`}>
        <span className={styles.brand}>
          <Logo dark />
          <span>Les petites annonces entre voisins, en France. Un compte = un numéro de mobile français.</span>
        </span>
        <span>© {ANNEE_CREATION}{year > ANNEE_CREATION ? `–${year}` : ""} Trocoin — Plateforme éditée en France · Paiement sécurisé · Messagerie intégrée · Modération humaine</span>
      </div>
    </footer>
  );
}
