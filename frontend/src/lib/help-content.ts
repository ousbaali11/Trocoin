/**
 * Centre d'aide structuré : rubriques → articles (slug, résumé, corps en
 * Markdown simplifié rendu par lib/markdown.ts). Contenu versionné dans le
 * code : chaque changement produit passe par une relecture, comme les tests.
 * Les liens internes utilisent les vraies routes du site.
 */
export interface HelpArticle {
  slug: string;
  title: string;
  summary: string;
  body: string;
  keywords?: string[];
  popular?: boolean;
}
export interface HelpSection {
  slug: string;
  title: string;
  intro: string;
  articles: HelpArticle[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    slug: "compte",
    title: "Compte et connexion",
    intro: "Inscription, identifiants, mot de passe, données personnelles.",
    articles: [
      {
        slug: "creer-un-compte",
        title: "Créer un compte",
        summary: "Ce qu'il faut pour s'inscrire, en particulier ou en professionnel.",
        popular: true,
        keywords: ["inscription", "numéro", "e-mail", "pro", "siret"],
        body: `## Ce qu'il faut
- un **numéro de mobile français** (06 ou 07) : un seul compte par numéro ;
- une adresse e-mail et un nom d'utilisateur (ils servent à vous connecter) ;
- un mot de passe de 8 caractères minimum.

## Compte professionnel
Choisissez « Professionnel » à l'inscription et indiquez la raison sociale et le **SIRET** de l'établissement (14 chiffres). Le numéro est contrôlé auprès du registre public des entreprises : un SIRET inconnu ou fermé est refusé. Vous obtenez le badge « Pro », une page boutique et des statistiques.

## Pendant la phase de test
Aucun SMS n'est envoyé à l'inscription : le numéro est enregistré sans vérification. Trocoin pourra vous demander de le confirmer par code SMS plus tard.`,
      },
      {
        slug: "se-connecter",
        title: "Se connecter",
        summary: "Par e-mail ou nom d'utilisateur, et que faire si le compte date d'avant le formulaire.",
        keywords: ["connexion", "identifiant", "sms"],
        body: `Sur la page **Se connecter**, saisissez votre e-mail, votre nom d'utilisateur *ou* le numéro de mobile de votre compte, puis votre mot de passe. L'icône « œil » affiche le mot de passe pour éviter les fautes de frappe.

## Compte créé par SMS, sans mot de passe
Les premiers comptes ont été ouverts uniquement par code SMS, sans mot de passe. Pour vous connecter, utilisez **Mot de passe oublié** (lien sous le champ du mot de passe) : un e-mail vous permet de définir un mot de passe, à condition qu'une adresse e-mail soit rattachée au compte. La connexion par code SMS n'est plus proposée.

## Sessions
Chaque connexion crée une session d'un mois, renouvelée automatiquement. Depuis **Paramètres**, changer de mot de passe déconnecte toutes vos sessions.`,
      },
      {
        slug: "mot-de-passe-oublie",
        title: "Mot de passe oublié",
        summary: "Recevoir un lien par e-mail pour choisir un nouveau mot de passe.",
        popular: true,
        keywords: ["réinitialiser", "oubli", "e-mail"],
        body: `Cliquez sur **Mot de passe oublié ?** sous le formulaire de connexion et indiquez votre e-mail : un lien de réinitialisation, valable une heure et utilisable une seule fois, vous est envoyé.

## Vous ne recevez rien ?
Vérifiez le dossier des courriers indésirables et l'adresse rattachée à votre compte. En dernier recours, contactez-nous depuis le centre d'aide : l'équipe peut vous remettre un **mot de passe temporaire**, à changer ensuite dans **Paramètres**.`,
      },
      {
        slug: "changer-mes-informations",
        title: "Modifier mon profil et mes préférences",
        summary: "Pseudo, ville, photo, notifications : tout se règle dans Paramètres.",
        keywords: ["pseudo", "photo", "ville", "notifications", "préférences"],
        body: `Depuis **Paramètres** :
- **Profil** : pseudo affiché, photo, ville et code postal (utilisés pour localiser vos annonces par défaut).
- **Identifiants** : e-mail, nom d'utilisateur et numéro de mobile sont affichés ; le numéro n'est jamais public.
- **Mot de passe** : changement avec déconnexion de toutes les sessions.
- **Notifications** : pour chaque type d'évènement (messages, achats et ventes, alertes de recherche, modération, informations Trocoin), choisissez les canaux. La notification dans votre compte est toujours conservée.`,
      },
      {
        slug: "mes-donnees-rgpd",
        title: "Télécharger mes données ou supprimer mon compte",
        summary: "Portabilité et effacement, en un clic depuis Paramètres.",
        keywords: ["rgpd", "export", "suppression", "données", "effacer"],
        body: `## Télécharger une copie de mes données
Dans **Paramètres → Mes données**, le bouton **Télécharger mes données** produit un fichier JSON contenant votre profil, vos annonces, vos conversations et messages, vos avis, vos transactions, vos favoris et vos préférences.

## Supprimer mon compte
Le bouton **Supprimer mon compte** retire immédiatement vos annonces, anonymise votre profil (pseudo, e-mail, nom d'utilisateur, nom, raison sociale), révoque toutes vos sessions et libère votre numéro, votre e-mail et votre nom d'utilisateur pour une nouvelle inscription. Les transactions et les avis sont conservés le temps légal, sans données personnelles.

Une transaction en cours empêche la suppression : terminez-la d'abord.`,
      },
    ],
  },
  {
    slug: "annonces",
    title: "Déposer et gérer une annonce",
    intro: "Rédaction, photos, règles de diffusion, durée de vie et statuts.",
    articles: [
      {
        slug: "deposer-une-annonce",
        title: "Déposer une annonce",
        summary: "Cinq étapes : catégorie, description, photos, localisation, aperçu.",
        popular: true,
        keywords: ["dépôt", "publier", "gratuit", "photos"],
        body: `Le dépôt est **gratuit**. Le formulaire vous guide en cinq étapes :
1. **Catégorie** : choisissez la plus précise, elle détermine les critères demandés et les filtres de recherche.
2. **Description** : titre (un exemple adapté à la catégorie est proposé), prix, état, critères de la catégorie, description libre. Une **estimation de prix** s'affiche à partir des annonces comparables.
3. **Photos** : autant de photos que vous voulez (JPEG, PNG, WEBP, 8 Mo chacune). Un recadrage est proposé ; la première est la couverture, glissez-déposez pour réordonner.
4. **Localisation** : ville ou code postal ; seule une position approximative (environ 1 km) est publique.
5. **Aperçu** puis publication.

Vous pouvez enregistrer un **brouillon** à tout moment. Une annonce dont tous les critères, une description détaillée et au moins trois photos sont renseignés reçoit le badge **Fiche complète**.`,
      },
      {
        slug: "regles-de-diffusion",
        title: "Règles de diffusion",
        summary: "Ce qui est autorisé, ce qui est interdit, et la vérification manuelle.",
        popular: true,
        keywords: ["interdit", "règles", "modération", "refus"],
        body: `- Rédigez en français, **un objet par annonce**, dans la bonne catégorie.
- Pas de numéro de téléphone, d'adresse e-mail ni de lien dans le texte ou sur les photos : la messagerie Trocoin sert à ça.
- Localisez l'annonce là où se trouve réellement l'objet.
- **Interdits** : armes, tabac et vapotage, médicaments, stupéfiants, contrefaçons, documents officiels, espèces protégées, contenus pour adultes, services financiers, animaux sans identification légale.

Une annonce contenant des termes sensibles passe en **vérification manuelle** avant publication (statut « En vérification »). Vous êtes prévenu du résultat par notification ; en cas de refus, le motif est indiqué dans **Mes annonces**.`,
      },
      {
        slug: "gerer-mes-annonces",
        title: "Gérer mes annonces : statuts, pause, renouvellement",
        summary: "Sans limite de durée : mise en pause, marquer vendue, dupliquer, supprimer ; ce qui ne se modifie plus après publication.",
        keywords: ["statut", "pause", "vendue", "durée", "expiration", "renouveler", "dupliquer", "catégorie", "marque", "photos", "verrouillé"],
        body: `Une annonce reste en ligne **sans limite de durée**, jusqu'à ce que vous la mettiez en pause, la marquiez vendue ou la supprimiez. Depuis **Mes annonces**, pour chaque annonce :
- **Modifier** le titre, la description, le prix, les critères, la localisation, et **ajouter** des photos ;
- **Mettre en pause** (invisible, réactivable) ou **marquer vendue** ;
- **Remettre en ligne** une annonce en pause, ou la **renouveler** pour la faire remonter dans les résultats ;
- **Dupliquer** pour repartir d'un brouillon identique ;
- **Mettre en avant** (tête des résultats pendant 7 jours) ou activer le macaron **Urgent** ;
- **Supprimer** définitivement.

**Ce qui ne se modifie plus une fois l'annonce publiée** : sa catégorie, sa marque (quand la catégorie en a une) et les photos présentes à la publication (ni retrait, ni remplacement, ni déplacement). C'est une protection contre la tromperie : personne ne doit pouvoir publier une annonce crédible, gagner des vues et des favoris, puis la transformer en autre chose. Vous pouvez toujours ajouter des photos à la suite ; pour vendre autre chose, déposez une nouvelle annonce. Une photo publiée par erreur (plaque, visage, adresse) ? Écrivez-nous : l'équipe peut la retirer.

Les onglets filtrent par statut : en ligne, en vérification, brouillons, en pause, vendues ou refusées. Le nombre de vues et de mises en favori est affiché sur chaque annonce.`,
      },
      {
        slug: "photos",
        title: "Photos : formats, limites et confidentialité",
        summary: "Ce que Trocoin fait de vos images.",
        keywords: ["photo", "exif", "gps", "taille"],
        body: `Pas de limite au nombre de photos par annonce ; JPEG, PNG ou WEBP de 8 Mo maximum chacune (150 photos par compte et par 24 heures, garde-fou contre les abus). Chaque image est **ré-encodée** par Trocoin : les métadonnées (dont la position GPS de l'appareil) sont supprimées et la taille est réduite à 1 600 px maximum.

Un plafond quotidien d'envois protège la plateforme contre les abus ; en usage normal vous ne l'atteindrez pas.`,
      },
    ],
  },
  {
    slug: "acheter",
    title: "Rechercher et acheter",
    intro: "Recherche, localisation, alertes, messagerie, proposition de prix.",
    articles: [
      {
        slug: "rechercher",
        title: "Rechercher une annonce",
        summary: "Mots-clés, localisation avec rayon, filtres par catégorie, vue carte.",
        popular: true,
        keywords: ["recherche", "filtres", "carte", "rayon", "localisation"],
        body: `Tapez ce que vous cherchez (« QUOI ? ») et où (« OÙ ? ») : **Autour de moi**, **Toute la France** ou une commune avec un rayon (0 à 200 km, 5 km par défaut). Paris, Lyon et Marseille peuvent être choisies en entier ou par arrondissement.

Les résultats se filtrent par catégorie, prix, état, type d'annonce (dons, échanges…), livraison, vendeur particulier ou professionnel, date de publication, et par les **critères propres à la catégorie** (marque, kilométrage, surface…). La vue **Carte** situe les annonces ; le tri par distance est disponible dès qu'une localisation est choisie.

La recherche comprend les pluriels et ignore les accents.`,
      },
      {
        slug: "alertes",
        title: "Sauvegarder une recherche et recevoir des alertes",
        summary: "Jusqu'à 50 recherches, vérification toutes les 5 minutes.",
        keywords: ["alerte", "recherche sauvegardée", "notification"],
        body: `Depuis une page de résultats, **Sauvegarder cette recherche** enregistre vos critères. Toutes les 5 minutes, Trocoin vérifie les nouvelles annonces correspondantes et vous notifie. Gérez vos alertes (notification, SMS, suppression) dans **Mes recherches** ; 50 recherches maximum.`,
      },
      {
        slug: "contacter-un-vendeur",
        title: "Contacter un vendeur et proposer un prix",
        summary: "Messagerie intégrée, réponses rapides, photos, proposition de prix.",
        keywords: ["message", "messagerie", "offre", "négocier", "prix"],
        body: `Le bouton **Contacter le vendeur** ouvre une conversation dans la messagerie Trocoin. Vous pouvez envoyer du texte, des photos et, pour un achat, une **proposition de prix** que le vendeur accepte ou refuse (une seule proposition en attente à la fois).

Les échanges sont en temps réel quand les deux membres sont connectés, sinon ils sont livrés à la prochaine ouverture. Un membre importun peut être **bloqué** ou **signalé** depuis la conversation.`,
      },
      {
        slug: "historique-et-favoris",
        title: "Favoris et annonces consultées",
        summary: "Retrouver ce que vous avez vu ou aimé.",
        keywords: ["favoris", "historique", "cœur"],
        body: `Le cœur sur une annonce l'ajoute à vos **Favoris**. Les 40 dernières annonces ouvertes sont listées dans **Annonces consultées** ; vous pouvez effacer cet historique à tout moment. L'accueil vous propose de reprendre vos dernières consultations.`,
      },
    ],
  },
  {
    slug: "paiement",
    title: "Paiement sécurisé et remise",
    intro: "Fonds bloqués, code de remise, envoi, litige, avis.",
    articles: [
      {
        slug: "paiement-securise",
        title: "Comment fonctionne le paiement sécurisé",
        summary: "L'acheteur paie sur Trocoin, qui conserve les fonds jusqu'à la réception.",
        popular: true,
        keywords: ["paiement", "sécurisé", "frais", "commission", "séquestre"],
        body: `Pour les objets jusqu'à **2 500 €** (hors véhicules, immobilier, emploi, services, vacances et animaux), l'acheteur paie sur Trocoin. Trocoin **encaisse et conserve** les fonds jusqu'à ce qu'il confirme la réception ; le vendeur est payé à ce moment-là seulement. Le vendeur doit expédier (ou remettre) sous **7 jours**, sinon la vente est annulée et l'acheteur intégralement remboursé.

- **Frais acheteur** : {{frais_acheteur}}, affichés séparément du prix avant validation.
- **Commission vendeur** : {{commission}} retenus sur le versement.
- Le barème d'une vente est celui en vigueur au moment du paiement ; il ne change plus ensuite.
- **Remise en main propre** : l'acheteur reçoit un code à 6 chiffres ; le vendeur le saisit au rendez-vous pour libérer les fonds.
- **Envoi** : le vendeur renseigne le numéro de suivi Colissimo ou Mondial Relay.

Pendant la phase de test, le paiement est **simulé** (aucune carte n'est débitée) : le parcours complet est testable sans risque.`,
      },
      {
        slug: "litige",
        title: "Ouvrir un litige",
        summary: "Objet non reçu, non conforme ou endommagé : un médiateur tranche.",
        keywords: ["litige", "remboursement", "médiation", "problème"],
        body: `Depuis la transaction (**Achats et ventes**), cliquez sur **Ouvrir un litige** et décrivez précisément le problème. Les fonds restent bloqués ; un médiateur Trocoin examine le dossier et décide du **remboursement** de l'acheteur ou du **versement** au vendeur. Les deux parties sont notifiées de la décision et de sa motivation.`,
      },
      {
        slug: "recevoir-mes-paiements",
        title: "Recevoir mes paiements",
        summary: "Configurer le compte de versement.",
        keywords: ["versement", "stripe", "iban", "vendre"],
        body: `Dans **Paiements**, configurez votre compte de versement auprès de notre prestataire de paiement : vos coordonnées bancaires ne transitent jamais par Trocoin. Les ventes vous sont versées automatiquement après confirmation de réception.

Au-delà de 30 ventes ou 2 000 € par an, la réglementation européenne (DAC7) impose une déclaration : des informations complémentaires vous seront demandées.`,
      },
      {
        slug: "avis",
        title: "Les avis",
        summary: "Laissés après une transaction sécurisée confirmée, dans les deux sens.",
        keywords: ["avis", "note", "réputation"],
        body: `Une fois la transaction terminée, acheteur et vendeur peuvent laisser une **note de 1 à 5** et un commentaire. Les avis sont visibles sur le profil public et dans **Avis** (reçus et donnés). Ils doivent rester factuels et courtois ; un avis abusif peut être signalé.`,
      },
    ],
  },
  {
    slug: "securite",
    title: "Sécurité et signalement",
    intro: "Éviter les arnaques, signaler un contenu, bloquer un membre.",
    articles: [
      {
        slug: "conseils-de-securite",
        title: "Conseils de sécurité",
        summary: "Les réflexes qui évitent la quasi-totalité des arnaques.",
        popular: true,
        keywords: ["arnaque", "sécurité", "fraude", "conseils"],
        body: `- Ne payez **jamais hors de la plateforme** (virement, mandat, cartes prépayées, lien de paiement envoyé par message).
- Méfiez-vous des prix bien en dessous du marché et des vendeurs pressés ou injoignables par messagerie.
- Pour une remise en main propre, choisissez un **lieu public** et vérifiez l'objet avant de valider.
- Ne communiquez jamais votre **code de remise** avant d'avoir l'objet en main.
- Ne partagez pas vos coordonnées bancaires ni de copie de pièce d'identité par messagerie.
- Un membre vous importune ? **Bloquez-le** depuis la conversation ou son profil.`,
      },
      {
        slug: "signaler",
        title: "Signaler une annonce, un profil ou une conversation",
        summary: "Le bouton Signaler et ce qu'il déclenche.",
        keywords: ["signaler", "signalement", "modération"],
        body: `Chaque annonce, profil et conversation dispose d'un bouton **Signaler**. Choisissez le motif (arnaque, contrefaçon, objet interdit, mauvaise catégorie, doublon, annonce mensongère, contenu offensant, coordonnées dans l'annonce, harcèlement) et ajoutez des précisions.

Notre équipe examine chaque signalement : elle peut corriger ou retirer l'annonce, suspendre le compte, ou classer le signalement. Vous êtes informé de la décision par notification.`,
      },
      {
        slug: "comptes-et-verifications",
        title: "Ce que Trocoin vérifie sur un compte",
        summary: "Badges affichés et ce qu'ils garantissent.",
        keywords: ["badge", "vérifié", "identité", "pro"],
        body: `- **Pro** : compte professionnel dont le SIRET a été fourni ; l'équipe contrôle que l'établissement existe et est actif au registre public des entreprises.
- **Identité vérifiée** : attribué manuellement par l'équipe après contrôle.
- Le numéro de mobile est obligatoire et unique, mais **non vérifié par SMS pendant la phase de test** : aucun badge « téléphone vérifié » n'est affiché.`,
      },
    ],
  },
  {
    slug: "pro",
    title: "Espace professionnel",
    intro: "Boutique, équipe, import de catalogue, formules.",
    articles: [
      {
        slug: "espace-pro",
        title: "Passer en compte professionnel",
        summary: "Badge Pro, page boutique, statistiques, dépôts illimités.",
        popular: true,
        keywords: ["pro", "professionnel", "siret", "boutique", "garage", "agence"],
        body: `Vous êtes garage, agence immobilière, commerçant, artisan ? Choisissez « Professionnel » à l'inscription, ou passez votre compte en professionnel depuis **Paramètres** en indiquant votre SIRET (contrôlé au registre des entreprises). Vous obtenez :
- le badge **Pro** sur vos annonces et votre profil ;
- une **page boutique** (logo, présentation, horaires, adresse, site web) ;
- des **statistiques** de vues, favoris et contacts ;
- aucune limite mensuelle de dépôt.`,
      },
      {
        slug: "boutique-equipe-import",
        title: "Boutique, équipe et import de catalogue",
        summary: "Gérer à plusieurs, importer un fichier CSV ou XML.",
        keywords: ["équipe", "import", "csv", "xml", "catalogue", "collaborateur"],
        body: `Dans **Ma boutique** :
- **Équipe** : invitez des collaborateurs par leur numéro de mobile ; ils créent, modifient et mettent en pause les annonces de la boutique, vous restez le vendeur affiché.
- **Import de catalogue** : fichier CSV ou XML (500 lignes maximum) avec les colonnes reference, titre, description, categorie, prix, type_prix, etat, ville, code_postal, livraison et attr_… pour les critères. Une référence déjà importée met l'annonce à jour. Un modèle est téléchargeable.

Les informations publiques de la vitrine se modifient dans **Paramètres**.`,
      },
      {
        slug: "formules",
        title: "Formules et mises en avant",
        summary: "Tout est gratuit pendant le lancement ; ce qui changera ensuite.",
        keywords: ["formule", "abonnement", "prix", "mise en avant", "urgent"],
        body: `Pendant le lancement, **tout est gratuit et illimité** : annonces, remontée en tête de liste, macaron « Urgent », statistiques, vitrine. Les formules présentées dans **Formule** ne s'appliqueront que lorsque la monétisation sera activée ; vous serez prévenu à l'avance et aucun prélèvement n'est effectué sans votre accord.`,
      },
    ],
  },
];

export const HELP_ARTICLES: Array<HelpArticle & { section: HelpSection }> = HELP_SECTIONS.flatMap((s) => s.articles.map((a) => ({ ...a, section: s })));

export function findHelpArticle(slug: string) {
  return HELP_ARTICLES.find((a) => a.slug === slug) ?? null;
}

/** Recherche plein texte simple (titre, résumé, mots-clés, corps), sans accents. */
export function searchHelp(query: string): Array<HelpArticle & { section: HelpSection }> {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const terms = norm(query).split(/\s+/).filter((t) => t.length >= 2);
  if (terms.length === 0) return [];
  return HELP_ARTICLES.map((a) => {
    const hay = norm(`${a.title} ${a.summary} ${(a.keywords ?? []).join(" ")} ${a.body}`);
    const title = norm(a.title);
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 3;
      else if (hay.includes(t)) score += 1;
      else return { a, score: -1 };
    }
    return { a, score };
  })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}
