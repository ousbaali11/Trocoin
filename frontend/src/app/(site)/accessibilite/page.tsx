import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Accessibilité",
  description: "Ce que Trocoin fait pour rester utilisable par tous : contrastes, clavier, lecteurs d'écran, mobile, et comment nous signaler un problème.",
};

/**
 * Page d'information sur l'accessibilité : uniquement ce qui est réellement en place et vérifié
 * par les tests automatiques du site (axe-core, clavier, marges mobiles). Aucune attestation ni
 * taux de conformité inventé : un audit RGAA complet n'a pas été réalisé.
 */
export default function Page() {
  return (
    <div className="container page" style={{ maxWidth: 760 }}>
      <p className="eyebrow">Informations</p>
      <h1>Accessibilité</h1>
      <p className="muted">
        Trocoin doit pouvoir être utilisé par tout le monde, quel que soit l&apos;appareil ou la façon de naviguer. Voici ce qui est en place aujourd&apos;hui, et comment nous prévenir si quelque chose vous bloque.
      </p>

      <section className="panel">
        <h2 className="h3">Ce qui est en place</h2>
        <ul>
          <li><strong>Contrastes</strong> : texte foncé sur fonds clairs, conformes au niveau AA des WCAG 2.1 sur toutes les pages, sans réglage à activer.</li>
          <li><strong>Clavier</strong> : lien « Aller au contenu » en début de page, parcours complet au clavier (recherche, dépôt d&apos;annonce, messagerie, boîtes de dialogue avec retour du focus, menus fermés par Échap).</li>
          <li><strong>Lecteurs d&apos;écran</strong> : titres hiérarchisés, libellés sur chaque champ et bouton, images d&apos;annonce décrites par leur titre, zones de repère (en-tête, navigation, contenu, pied de page).</li>
          <li><strong>Mobile</strong> : zones tactiles d&apos;au moins 44 px, texte jamais inférieur à 14 px, champs de saisie qui ne déclenchent pas de zoom, aucune information à moins de 12 px du bord de l&apos;écran.</li>
          <li><strong>Animations</strong> : réduites ou supprimées quand votre appareil demande « réduire les animations ».</li>
          <li><strong>Vérifications</strong> : ces règles sont contrôlées automatiquement (axe-core, navigation au clavier, marges mobiles) à chaque mise à jour du site, avant sa mise en ligne.</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="h3">Ce qui reste à faire</h2>
        <p>
          Un audit complet selon le référentiel français RGAA n&apos;a pas encore été réalisé : cette page n&apos;est donc pas une déclaration de conformité. Les cartes interactives (vue « Carte » des résultats) restent difficiles à utiliser sans souris ; la liste des annonces reste disponible pour la même recherche.
        </p>
      </section>

      <section className="panel">
        <h2 className="h3">Un problème ? Dites-le nous</h2>
        <p>
          Si une page ou une fonction vous est inaccessible, décrivez-nous ce qui bloque (page, appareil, outil utilisé) depuis la page <Link href="/aide/signaler">Signaler un contenu ou un problème</Link>. Nous corrigeons en priorité tout ce qui empêche de chercher, de déposer une annonce ou d&apos;échanger avec un membre.
        </p>
      </section>
    </div>
  );
}
