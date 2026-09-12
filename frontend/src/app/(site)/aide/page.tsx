import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Centre d'aide", description: "Comment fonctionne Trocoin : inscription, dépôt d'annonce, paiement sécurisé, sécurité, espace professionnel." };

export default function AidePage() {
  return (
    <div className="container page narrow">
      <p className="eyebrow">Centre d&apos;aide</p>
      <h1>Questions fréquentes</h1>
      <nav className="row small" style={{ marginBottom: 24 }}>
        <a href="#compte">Compte</a> · <a href="#annonce">Annonces</a> · <a href="#paiement">Paiement sécurisé</a> · <a href="#securite">Sécurité</a> · <a href="#signaler">Signalement</a> · <a href="#pro">Professionnels</a>
      </nav>

      <section id="compte" className="panel" style={{ marginBottom: 16 }}>
        <h2>Compte</h2>
        <h3>Pourquoi un numéro de mobile français est-il obligatoire ?</h3>
        <p>Trocoin est une plateforme française : chaque compte est rattaché à un numéro de mobile en 06 ou 07, vérifié par SMS. Cela limite les faux comptes et permet de retrouver l&apos;auteur d&apos;une annonce en cas de litige. Les indicatifs étrangers sont refusés à l&apos;inscription.</p>
        <h3>Je n&apos;ai pas reçu mon code</h3>
        <p>Patientez une minute puis demandez un nouveau code. Cinq codes maximum par heure sont envoyés par numéro.</p>
        <h3>Supprimer mon compte et récupérer mes données</h3>
        <p>Depuis <Link href="/compte/parametres">Paramètres</Link>, vous pouvez télécharger une archive de vos données (droit à la portabilité) et supprimer votre compte. Vos annonces sont retirées immédiatement, vos données personnelles anonymisées ; les transactions sont conservées le temps légal.</p>
      </section>

      <section id="annonce" className="panel" style={{ marginBottom: 16 }}>
        <h2>Annonces</h2>
        <h3>Combien coûte le dépôt d&apos;une annonce ?</h3>
        <p>Rien : le dépôt est gratuit pour les particuliers (20 annonces par mois) avec jusqu&apos;à 10 photos.</p>
        <h3>Règles de diffusion</h3>
        <ul>
          <li>Rédigez en français, un objet par annonce, dans la bonne catégorie.</li>
          <li>Pas de numéro de téléphone, d&apos;adresse e-mail ni de lien dans le texte ou sur les photos : la messagerie Trocoin sert à ça.</li>
          <li>Localisez l&apos;annonce là où se trouve réellement l&apos;objet.</li>
          <li>Interdits : armes, tabac et vapotage, médicaments, stupéfiants, contrefaçons, documents officiels, espèces protégées, contenus pour adultes, services financiers, animaux sans identification légale.</li>
        </ul>
        <p>Une annonce contenant des termes sensibles passe en vérification manuelle avant publication. Vous êtes prévenu du résultat.</p>
        <h3>Durée de vie</h3>
        <p>Une annonce reste en ligne 60 jours. Vous pouvez la renouveler en un clic, la mettre en pause ou la marquer comme vendue depuis <Link href="/compte/annonces">Mes annonces</Link>.</p>
      </section>

      <section id="paiement" className="panel" style={{ marginBottom: 16 }}>
        <h2>Paiement sécurisé</h2>
        <p>Pour les objets jusqu&apos;à 2 500 € (hors véhicules, immobilier, emploi, services, vacances et animaux), l&apos;acheteur paie par carte sur Trocoin. Les fonds sont bloqués jusqu&apos;à ce qu&apos;il confirme la réception.</p>
        <ul>
          <li><strong>Frais acheteur :</strong> 5 % + 0,50 € (plafonnés à 15 €), affichés avant validation.</li>
          <li><strong>Commission vendeur :</strong> 8 % retenus sur le versement.</li>
          <li><strong>Remise en main propre :</strong> l&apos;acheteur reçoit un code à 6 chiffres ; le vendeur le saisit au rendez-vous pour libérer les fonds.</li>
          <li><strong>Envoi :</strong> le vendeur renseigne le numéro de suivi Colissimo ou Mondial Relay.</li>
          <li><strong>Litige :</strong> ouvrez-le depuis la transaction ; un médiateur Trocoin tranche (remboursement ou versement) après examen.</li>
        </ul>
        <p>Pour recevoir vos paiements, configurez votre compte de versement depuis <Link href="/compte/paiements">Mes paiements</Link>.</p>
      </section>

      <section id="securite" className="panel" style={{ marginBottom: 16 }}>
        <h2>Conseils de sécurité</h2>
        <ul>
          <li>Ne payez jamais hors de la plateforme (virement, mandat, cartes prépayées).</li>
          <li>Méfiez-vous des prix bien en dessous du marché et des vendeurs pressés.</li>
          <li>Pour une remise en main propre, choisissez un lieu public et vérifiez l&apos;objet avant de valider.</li>
          <li>Ne communiquez jamais votre code de remise avant d&apos;avoir l&apos;objet en main.</li>
          <li>Un membre vous importune ? Bloquez-le depuis la conversation ou son profil.</li>
        </ul>
      </section>

      <section id="signaler" className="panel" style={{ marginBottom: 16 }}>
        <h2>Signaler un contenu</h2>
        <p>Chaque annonce et chaque profil dispose d&apos;un bouton « Signaler ». Choisissez le motif (arnaque, contrefaçon, objet interdit, mauvaise catégorie, doublon…). Notre équipe examine chaque signalement et peut retirer l&apos;annonce ou suspendre le compte. Vous êtes informé de la décision.</p>
      </section>

      <section id="pro" className="panel">
        <h2>Espace professionnel</h2>
        <p>Vous êtes garage, agence immobilière, commerçant, artisan ? Passez votre compte en professionnel depuis <Link href="/compte/parametres">Paramètres</Link> en indiquant votre SIRET. Vous obtenez :</p>
        <ul>
          <li>le badge « Pro » sur vos annonces et votre profil ;</li>
          <li>une page boutique (logo, description, horaires, adresse, site web) ;</li>
          <li>des statistiques de vues, favoris et contacts ;</li>
          <li>aucune limite mensuelle de dépôt.</li>
        </ul>
        <p className="small muted">Les abonnements, l&apos;import de catalogue et la gestion multi-utilisateurs arrivent dans une prochaine version.</p>
      </section>
    </div>
  );
}
