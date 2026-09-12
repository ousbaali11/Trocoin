# Analyse concurrentielle — leboncoin.fr (état septembre 2026)

Document produit à partir d'une recherche web menée le 11 septembre 2026
(centre d'aide officiel `assistance.leboncoin.info`, règles de diffusion
`leboncoin.fr/dc/*`, CGV pro, presse spécialisée 2026). Les pages
`leboncoin.fr` elles-mêmes refusent les robots (HTTP 403) ; les
informations qui en proviennent sont donc issues d'articles tiers
récents et du centre d'aide, et sont signalées comme telles quand le
niveau de certitude est plus faible.

Rappel légal (cahier des charges §5) : on ne copie ni le nom, ni le
logo, ni la charte graphique, ni les textes de leboncoin. Seul le
concept fonctionnel est analysé ici.

---

## 1. Comptes et inscription

### 1.1 Création de compte
| Point | leboncoin (2026) |
|---|---|
| Identifiant principal | Adresse e-mail + mot de passe |
| SSO | Connexion possible via Google / Apple (app mobile et web) |
| Téléphone | Numéro de mobile demandé très tôt à la création ; code SMS à saisir. Sert à rattacher le compte à une ligne réelle (anti-comptes jetables) et comme canal de récupération. Numéros étrangers acceptés (leboncoin n'est pas restreint à la France). |
| Vérification e-mail | Lien de confirmation par e-mail |
| Vérification d'identité | Non requise pour consulter ni publier. **Obligatoire pour encaisser** de l'argent via le paiement sécurisé (CNI recto-verso ou passeport, via un prestataire KYC). Obligatoire aussi pour certaines catégories sensibles (véhicules avec paiement sécurisé). |
| Badges de confiance affichés sur le profil | « Pièce d'identité vérifiée », « Numéro de téléphone vérifié », « E-mail vérifié », ancienneté (« Membre depuis … »), note moyenne sur 5 et nombre d'avis, taux de réponse et délai de réponse moyen |

**Différence Trocoin** : le téléphone français est l'identifiant *unique*
et *obligatoire* (pas d'e-mail/mot de passe, pas de SSO au MVP). C'est
un choix produit assumé : il élimine de fait les comptes créés depuis
l'étranger. Il faudra en revanche prévoir une récupération de compte si
l'utilisateur change de numéro.

### 1.2 Particulier vs professionnel
| Point | Particulier | Professionnel |
|---|---|---|
| Abonnement | Aucun | Obligatoire, formules par volume d'annonces et par secteur (à partir de ≈ 39 € HT/mois « Pack Local » ≈ 50 annonces, jusqu'à > 1 500 € HT/mois pour l'auto/immo/emploi multi-régions) |
| Justificatifs | Aucun | SIRET/SIREN obligatoire, raison sociale, adresse, TVA intracom ; contrôles de cohérence d'activité |
| Dépôt d'annonce | Gratuit dans la plupart des catégories (frais fixes dans Auto, Immo, Emploi) | Compris dans l'abonnement + frais par annonce selon catégorie |
| Boutique | Non | Page « Boutique » (logo, bannière, description, horaires, adresse, lien site web, toutes les annonces), « Boutique premium » avec charte personnalisée |
| Import en masse | Non | Flux XML/CSV/API (« Offre Agilité » : import illimité et synchronisation du stock en temps réel) |
| Statistiques | Vues / contacts / favoris par annonce | Tableau de bord complet, export, comparaison période, CRM Pro léger (suivi des contacts, leads, relances) |
| Commission sur ventes sécurisées | 0 % (frais portés par l'acheteur) | Commission préférentielle par catégorie, plafonnée à 80 € |
| Multi-utilisateurs | Non | Oui (gestion des collaborateurs d'une même structure) |
| Support | Standard | Prioritaire |
| Badge | — | Mention « Pro » sur chaque annonce et sur le profil ; filtre de recherche « Particulier / Professionnel » |

### 1.3 Paramètres de compte
- Informations personnelles (nom, prénom, e-mail, téléphone, adresse
  postale utilisée pour la livraison)
- **Porte-monnaie** (solde issu des ventes) + **IBAN** pour virement,
  débloqué uniquement après vérification d'identité
- Préférences de notifications granulaires : e-mail / push / SMS par
  type d'évènement (messages, alertes recherche, favoris, transactions)
- Gestion des **recherches sauvegardées** (jusqu'à 50, chacune avec
  bascule push et bascule e-mail)
- Historique des annonces consultées
- Liste des utilisateurs bloqués
- Export des données personnelles (RGPD, archive téléchargeable)
- Suppression du compte (désactivation immédiate, annonces retirées,
  purge sous 30 jours)
- Gestion du consentement cookies
- Connexions / appareils actifs, changement de mot de passe, 2FA

---

## 2. Dépôt d'annonce

### 2.1 Arborescence des catégories (familles → catégories)
L'arbre officiel est modifié régulièrement ; la structure ci-dessous
est la structure stable observable en 2026 (aux intitulés près) :

1. **Véhicules** — Voitures, Motos, Caravaning, Utilitaires, Camions,
   Nautisme, Équipement auto, Équipement moto, Équipement caravaning,
   Équipement nautisme, Vélos (parfois rattachés à Loisirs)
2. **Immobilier** — Ventes immobilières, Locations, Colocations,
   Bureaux & Commerces, Immobilier neuf, Locations de vacances
   (famille séparée : voir 10)
3. **Emploi** — Offres d'emploi, Formations professionnelles
4. **Mode** — Vêtements, Chaussures, Accessoires & Bagagerie,
   Montres & Bijoux, Équipement bébé (croisé avec Famille)
5. **Maison & Jardin** — Ameublement, Électroménager, Arts de la table,
   Décoration, Linge de maison, Bricolage, Jardin & Plantes
6. **Multimédia** — Informatique, Consoles & Jeux vidéo, Image & Son,
   Téléphonie, Accessoires informatique
7. **Loisirs** — Antiquités, Collection, Instruments de musique,
   Jeux & Jouets, Livres, Modélisme, Sports & Hobbies, Vélos, Vins &
   Gastronomie, DVD/Films, CD/Musique, Billetterie
8. **Matériel professionnel** — Matériel agricole, Transport & Manutention,
   BTP & Chantier, Outillage & Matériaux 2nd œuvre, Équipements
   industriels, Restauration & Hôtellerie, Fournitures de bureau,
   Commerces & Marchés, Matériel médical
9. **Services** — Prestations de services, Billetterie, Évènements,
   Cours particuliers, Covoiturage, Services à la personne, Artisans &
   Musiciens, Baby-sitting
10. **Vacances** — Locations & Gîtes, Chambres d'hôtes, Campings, Hôtels,
    Hébergements insolites
11. **Famille** — Équipement bébé, Mobilier enfant, Vêtements bébé, Jouets
12. **Animaux** — Animaux (vente/don, réglementée), Accessoires animaux
13. **Autres** — Divers non classable

Trocoin a les 12 familles racines seedées, **mais aucune sous-catégorie**.

### 2.2 Champs dynamiques par catégorie
Champs collectés (obligatoires en gras) :

- **Voitures** : **marque**, **modèle**, **année (mise en circulation)**,
  **kilométrage**, **carburant** (essence, diesel, hybride, électrique,
  GPL…), **boîte de vitesse** (manuelle/automatique), puissance fiscale
  (CV), puissance DIN, nombre de portes, nombre de places, couleur,
  type de véhicule (citadine, SUV, berline…), crit'air, état
  (endommagé ou non), première main, date du contrôle technique,
  plaque d'immatriculation (pré-remplissage via SIV), équipements
  (options cochables)
- **Motos** : marque, modèle, année, kilométrage, cylindrée (cm³), type
  (roadster, trail…), permis requis
- **Utilitaires / camions / caravaning** : idem voitures + PTAC,
  nombre de couchages (caravaning), longueur (nautisme)
- **Immobilier vente** : **type de bien** (maison, appartement, terrain,
  parking, autre), **surface habitable (m²)**, **nombre de pièces**,
  nombre de chambres, nombre de salles de bain, étage / nombre d'étages,
  ascenseur, **classe énergie DPE (A→G)**, **GES (A→G)**, honoraires
  (si agence : prix avec/sans honoraires, % à charge), surface terrain,
  année de construction, extérieur (balcon, terrasse, jardin), parking,
  cave, orientation, référence
- **Immobilier location** : idem + **loyer charges comprises**, montant
  des charges, dépôt de garantie, **meublé / non meublé**, type de
  location (vide, meublé, colocation), disponible le, honoraires
  locataire, zone tendue (encadrement des loyers : loyer de référence
  majoré, complément de loyer)
- **Emploi** : type de contrat (CDI, CDD, intérim, alternance, stage,
  freelance), temps de travail (plein/partiel), secteur, fonction,
  expérience requise, niveau d'études, salaire (fourchette), lieu,
  date de début, télétravail
- **Mode / vêtements** : univers (femme, homme, fille, garçon), type de
  vêtement, **taille**, marque, couleur, matière, **état**
- **Chaussures** : univers, pointure, marque, couleur, état
- **Maison / électroménager / multimédia** : marque, modèle, état,
  couleur, capacité (Go), pour la téléphonie : marque, modèle,
  capacité de stockage, couleur, débloqué tout opérateur
- **Loisirs / vélos** : type de vélo, taille de cadre, état
- **Animaux** : type d'animal, race, âge, sexe, **N° SIREN ou ICAD /
  numéro d'identification obligatoire** (loi française), vaccination,
  LOF
- **Vacances** : type d'hébergement, capacité (personnes), nombre de
  chambres, équipements, classement, prix / nuit, dates disponibles
- **Services** : type de service, tarif horaire ou forfait, zone
  d'intervention

### 2.3 Prix
- Prix fixe ; case « Prix négociable » (parfois masqué au profit de la
  négociation en messagerie)
- « Don / gratuit » (catégorie « Je donne » ou prix 0)
- « Échange » n'est pas un type de prix natif chez leboncoin, mais un
  usage dans la description ; Trocoin le formalise (avantage)
- Fourchette de prix suggérée à partir des annonces similaires (aide au
  vendeur), estimation gratuite en auto / immo
- Paiement en 3 ou 4 fois (Oney) pour les achats sécurisés éligibles

### 2.4 Photos
- **3 photos gratuites** dans la majorité des catégories pour les
  particuliers (2026)
- « Photos Premium » : jusqu'à 10 ; « Pack Photos supplémentaires » :
  jusqu'à 20 (option payante)
- Formats JPEG/PNG/GIF/BMP, taille conseillée < 1,2 Mo, recadrage et
  rotation intégrés, **réorganisation par glisser-déposer**, la première
  est la **photo de couverture**
- Interdictions : photos avec coordonnées, QR codes, liens, mineurs,
  nudité, images sans rapport, **photos réutilisées d'une autre annonce**
- Reconnaissance d'image pour suggérer la catégorie et repérer les
  doublons / contrefaçons

### 2.5 Livraison intégrée et retrait
- Option « Livraison possible » activable par le vendeur (hors
  véhicules, immobilier, emploi, services)
- Modes : **Mondial Relay** (point relais), **Colissimo** (domicile /
  point retrait), **remise en main propre**, Chronopost et Shop2Shop
  selon période, coursier (grandes villes) pour objets volumineux
- Poids / gabarit déclaré par le vendeur à la mise en ligne, frais de
  port estimés et affichés à l'acheteur
- Étiquette générée par la plateforme après achat, à imprimer ou en QR
  code (dépôt sans impression)
- Zones de retrait : l'annonce est localisée à la **commune** où se
  trouve réellement l'objet, même si livraison nationale

### 2.6 Options payantes de visibilité
- **Boost / Remontée en tête de liste** (à partir de ≈ 0,99 €)
- **À la une** (mise en avant en haut de page pendant 7 ou 30 jours)
- **Urgent** (macaron)
- **Logo / photo en plus grand** dans la liste
- Depuis le 27 avril 2026 : fin de l'achat de crédits ; paiement direct
  par carte ou via abonnement pro
- Frais fixes de dépôt dans les catégories Auto, Immobilier, Emploi
  pour les particuliers (sequr.fr / blog GCF, 2026)

### 2.7 Cycle de vie
- Enregistrement automatique du **brouillon** pendant la saisie
- **Aperçu** avant publication
- Modération automatique + humaine avant mise en ligne (délai courant
  quelques minutes à quelques heures) ; e-mail si refus avec motif
- Statuts : en cours de validation, en ligne, en pause (invisible
  temporairement, contact impossible), vendue / conclue, refusée
  (motif), expirée, supprimée
- Durée : **60 jours** puis expiration (illimitée dans Vacances,
  Loisirs, Maison, Mode, Multimédia) ; renouvellement / remise en
  ligne en un clic, modification à tout moment (remodération si
  changement substantiel), duplication, marquage « vendu » avec
  demande d'évaluation

---

## 3. Recherche, filtres, tri

### 3.1 Barre de recherche
- Texte libre avec **suggestions** (auto-complétion sur les catégories
  et les mots-clés populaires), correction orthographique, option
  « Rechercher dans le titre uniquement »
- **Recherche visuelle** par photo (app mobile, catégories Mode,
  Maison, Famille, Loisirs, Véhicules)
- Historique des dernières recherches

### 3.2 Géographie
- « Toute la France », ou jusqu'à **10 localisations** simultanées
  (régions, départements, villes, codes postaux)
- « Autour de moi » avec rayon réglable **10 → 200 km**, **30 km par
  défaut**, tri par distance possible
- Vue **carte** des résultats (marqueurs cliquables, regroupement) en
  parallèle de la vue liste ; en immobilier la carte est centrale
- Recherche par « quartier » dans les grandes villes (immobilier)

### 3.3 Filtres
Communs : catégorie / sous-catégorie, prix min / max, **état** (neuf,
très bon état, bon état, état satisfaisant, pour pièces), **date de
publication** (24 h, 7 j, 30 j), **avec photo uniquement**, **livraison
possible**, **paiement sécurisé disponible**, **particulier /
professionnel**, « Voir aussi les annonces avec livraison » (hors
zone), annonces urgentes.
Spécifiques : tous les champs dynamiques de la catégorie (marque,
modèle, année, km, carburant, boîte, surface, pièces, DPE, taille,
pointure, contrat, etc.) avec sliders pour les numériques.

### 3.4 Tri
Pertinence (défaut, mixant récence, complétude, position géographique
et options payantes), prix croissant, prix décroissant, plus récentes,
**distance** (« Autour de moi »), et en immobilier : surface, prix/m².
Les annonces sponsorisées / boostées sont insérées avec mention.

### 3.5 Alertes / recherches sauvegardées
- Bouton « Sauvegarder cette recherche » sur toute page de résultats
- Jusqu'à **50** recherches par compte
- Chaque recherche a deux bascules indépendantes : **push** (app) et
  **e-mail**, fréquence quasi temps réel
- Gestion dans l'espace compte (renommer, supprimer, désactiver)

---

## 4. Page d'une annonce
- Galerie photo plein écran avec vignettes, zoom, compteur (« 3/10 »)
- Titre, prix (avec mention « Prix négociable », « Paiement en 4× »),
  date de publication, localisation (commune + code postal, carte avec
  cercle approximatif), catégorie / fil d'Ariane
- **Tableau des caractéristiques** (« Critères ») issu des champs
  dynamiques
- Description (texte brut, sauts de ligne conservés)
- Bloc **livraison** : modes proposés et coût estimé, protection acheteur
- Bloc **vendeur** : pseudo/boutique, particulier/pro, note sur 5 +
  nombre d'avis, badges de vérification, « Membre depuis », taux et
  délai de réponse, nombre d'annonces en ligne, lien vers le profil /
  la boutique, bouton « Suivre » le vendeur
- Actions : **Contacter / Envoyer un message**, **Acheter** (paiement
  sécurisé), **Faire une offre** (proposition de prix), **Favori**
  (cœur), **Partager** (lien, réseaux, e-mail), **Signaler**, appel
  téléphonique masqué si le vendeur l'autorise
- **Annonces similaires** (même catégorie, même zone) et « Autres
  annonces de ce vendeur »
- **Compteur de vues** visible du vendeur (statistiques) ; nombre de
  favoris
- Conseils de sécurité (« Ne payez jamais hors plateforme… »)
- Référence de l'annonce, données structurées SEO (schema.org/Product)

---

## 5. Messagerie et transaction

### 5.1 Messagerie interne
- Une conversation = un couple (acheteur, annonce) ; historique par
  annonce, vignette de l'annonce dans le fil
- Texte, **photos**, **proposition de prix** (offre → accepter / refuser
  / contre-offre), partage de localisation pour le RDV
- **Réponses rapides** pré-remplies (« Est-ce toujours disponible ? »,
  « Quel est votre dernier prix ? », « Où se situe le retrait ? »)
- Bouton « Notifier le vendeur » quand un acheteur met en favori
- Accusé de lecture, notifications push / e-mail, indicateur « en
  ligne »
- **Blocage** d'un utilisateur (il n'est pas prévenu, il conserve
  l'historique), **signalement** d'une conversation, filtre anti-spam
  et anti-arnaque automatique (détection de coordonnées, liens,
  phishing), masquage des numéros de téléphone
- Archivage / suppression de conversations, recherche dans les messages

### 5.2 Paiement sécurisé (« Transaction sécurisée »)
- Disponible pour la plupart des biens **hors véhicules, immobilier,
  emploi, services, vacances, animaux** ; plafond ≈ 2 500 €
- Acheteur : paie par carte (ou porte-monnaie, ou 3-4× Oney), les fonds
  sont **séquestrés** chez un prestataire de paiement agréé (Adyen /
  MangoPay selon les périodes), **frais de protection acheteur** à sa
  charge (barème dégressif ≈ 5-7 % + fixe) + frais de port
- Vendeur particulier : 0 commission, doit **confirmer la
  disponibilité sous 48 h**, puis **expédier sous 72 h** avec
  l'étiquette fournie (sinon remboursement automatique)
- Réception : l'acheteur a **3 jours** pour confirmer ou déclarer un
  problème ; libération des fonds vers le porte-monnaie du vendeur,
  retrait sur IBAN après vérification d'identité
- **Remise en main propre sécurisée** : paiement en ligne, RDV,
  déblocage par l'acheteur le jour du RDV (code / bouton dans l'app)
- Étiquette Mondial Relay / Colissimo générée par la plateforme, suivi
  intégré dans la conversation
- **Centre de résolution** : déclaration de non-conformité →
  **7 jours de résolution amiable** entre les parties (retour et
  remboursement) → intervention d'un médiateur leboncoin (≈ 7 jours
  ouvrés), décision : remboursement total/partiel ou libération
- Réductions / codes promo sur les frais de port, garantie
  reconditionné sur certains pros

---

## 6. Confiance et modération
- **Avis** : uniquement après une transaction sécurisée ou un contact
  confirmé, note 1-5 + commentaire, réponse du vendeur possible, avis
  affichés sur le profil avec date, filtrables
- **Badges** : téléphone vérifié, e-mail vérifié, identité vérifiée,
  Pro, « Vendeur fiable » (historique), ancienneté
- **Signalement** : bouton sur chaque annonce, profil et conversation ;
  motifs : arnaque / fraude, contrefaçon, objet interdit, mauvaise
  catégorie, doublon, annonce mensongère, contenu offensant,
  coordonnées dans l'annonce, autre ; suivi par une équipe Trust &
  Safety
- **Modération** : automatique (mots-clés, images, doublons,
  cohérence prix) puis humaine ; refus motivé par e-mail ; sanctions
  graduées (avertissement, retrait, suspension, bannissement, blocage
  du numéro de téléphone et de l'appareil)
- **Catégories interdites / réglementées** : tabac et vapotage,
  drogues et accessoires, armes (y compris répliques, couteaux
  spécifiques), médicaments, produits dangereux, espèces protégées
  (CITES), animaux hors cadre légal (SIREN / ICAD, chiots < 8 semaines),
  contrefaçons, billets de banque, documents officiels, consignes,
  services financiers / crédit, jeux d'argent, contenus adultes,
  articles réservés aux professionnels, produits rappelés, biens volés,
  logiciels piratés, comptes de jeu, données personnelles
- **Règles de rédaction** : annonce en **français** (loi Toubon),
  pas de coordonnées dans le titre / la description / les photos, pas
  de lien externe ni QR code, pas de bourrage de mots-clés, pas de
  doublon (un objet = une annonce), localisation réelle de l'objet
- **Juridique** : CGU, CGV particuliers et pros, politique de
  confidentialité, politique cookies, mentions légales, médiateur de la
  consommation, procédure DAC7 (collecte du NIR / adresse pour les
  vendeurs dépassant 30 transactions ou 2 000 €/an et transmission à
  l'administration fiscale), règles de classement publiées
  (obligation P2B), charte de bonne conduite

---

## 7. Espace professionnel
- Inscription pro avec SIRET, activité, choix de la formule
- **Formules** par secteur (Auto / Immobilier / Emploi / Commerces &
  Services / Vacances) : packs par volume d'annonces et zone (local,
  départemental, régional, multi-régions, national), « E-Vitrine »,
  « Offre Efficacité » (E-Vitrine + crédits de visibilité, catégories
  Loisirs, Mode, Maison, Multimédia), « Offre Agilité » (import de
  catalogue illimité + synchronisation temps réel), « Boutique
  premium » (page personnalisée)
- **Statistiques** : vues, contacts, appels, favoris, taux de
  conversion, par annonce et par période, export, comparaison marché
- **Import de flux** XML / CSV / API partenaires (logiciels DMS auto,
  logiciels immo)
- **Image de marque** : logo, bannière, description, horaires, adresse
  et carte, lien site, réseaux sociaux, avis clients agrégés
- **CRM Pro** léger : suivi des leads, statut des contacts, relances
- Multi-utilisateurs, facturation mensuelle, TVA, support prioritaire
- Commission préférentielle et plafonnée (80 €) sur les ventes
  sécurisées

---

## 8. Écarts identifiés (leboncoin vs cahier des charges vs code réel)

Légende : **Backend** = API NestJS ; **Front** = interface utilisateur
finale (Next.js à construire ; `public/index.html` n'est qu'un outil de
dev). « Absent » = rien dans le code au moment de l'analyse.

### 8.1 Comptes
| Fonctionnalité | Cahier des charges | Code actuel | Écart |
|---|---|---|---|
| Inscription téléphone FR + OTP | Oui | Fait | — |
| E-mail + mot de passe / SSO | Oui (secondaire) | Absent | Backend + Front (hors périmètre MVP, à documenter) |
| 2FA | Optionnel | Absent | Reporté |
| Profil : avatar, pseudo, ville, CP | Oui | Champs présents, **aucune validation** du PATCH (`patch: any`), pas d'upload d'avatar | Backend (DTO), Front |
| Taux / délai de réponse | Oui | Absent | Backend (calcul), Front |
| Badge identité vérifiée | Oui | Champ `identityVerified` jamais activable | Backend (admin), Front |
| Badge pro / SIRET | Oui | `become-pro` instantané, pas de SIRET | Backend (champ SIRET + validation format), Front |
| Suspension de compte | Oui | Champ `suspendedAt` **jamais vérifié** par l'auth | Backend (guard) |
| Rôle admin | Oui | Type existe, jamais utilisé | Backend (guard + seed) |
| Export RGPD / suppression de compte | Oui | Absent | Backend + Front |
| Préférences de notification | Oui | Absent | Backend + Front |
| Utilisateurs bloqués | Oui | Absent | Backend + Front |
| Refresh token / rotation | Archi §6 | Absent (JWT 7 jours) | Backend (à documenter dans l'audit) |

### 8.2 Dépôt d'annonce
| Fonctionnalité | CdC | Code actuel | Écart |
|---|---|---|---|
| 12 familles | Oui | Fait | — |
| Sous-catégories | Oui | Absent (`parentId` jamais rempli) | Backend (seed), Front |
| Champs dynamiques par catégorie | Oui | `attributes` JSON libre, **aucun schéma ni validation** | Backend (schéma par catégorie), Front (formulaire dynamique) |
| Types de prix (fixe, négociable, don, échange, sur demande) | Oui | Fait | Front |
| État de l'objet (liste fermée) | Oui | Champ texte libre non validé | Backend (enum), Front |
| Photos : max, ordre, couverture | 10-20, réordonnables | Upload 10 max, **pas de réordonnancement** | Backend (PATCH ordre), Front |
| Livraison possible / modes | Oui | Absent | Backend (champ + filtre), Front |
| Localisation lat/lng + rayon confidentialité | Oui | Colonnes présentes, jamais remplies | Backend (géocodage CP → lat/lng), Front (carte) |
| Brouillon | Oui | Absent | Backend (statut `brouillon`), Front |
| Aperçu avant publication | Oui | Absent | Front |
| Expiration 60 j + renouvellement | Oui | Absent | Backend (job), Front |
| Modération avant mise en ligne | Oui | Absent (`en_ligne` direct) | Backend (file admin), Front admin |
| Refus avec motif | Oui | Absent | Backend (champ), Front |
| Modification / duplication | Oui | Modification faite ; duplication absente | Front |
| Options payantes (boost, urgent) | Oui | Absent | Backend + Front (V2, hors MVP) |
| Quota gratuit particulier | Oui | Absent | Backend |
| Suppression d'annonce par le propriétaire | Implicite | Absent (`DELETE /listings/:id` prévu dans l'archi, non implémenté) | Backend |

### 8.3 Recherche
| Fonctionnalité | CdC | Code actuel | Écart |
|---|---|---|---|
| Texte (titre + description) | Oui | LIKE simple, sans suggestions | Front (suggestions côté client sur catégories) |
| Catégorie, ville, prix, vendeur, tri | Oui | Fait | — |
| Rayon km / géoloc | Oui | Absent | Backend (Haversine sur lat/lng), Front |
| Filtre état | Oui | Absent | Backend, Front |
| Filtre date de publication | Oui | Absent | Backend, Front |
| Filtre avec photo | Oui | Absent | Backend, Front |
| Filtre livraison possible | Oui | Absent | Backend, Front |
| Filtre particulier / pro | Oui | Absent (jointure users) | Backend, Front |
| Filtres spécifiques catégorie | Oui | Absent | Backend (filtre sur `attributes`), Front |
| Tri par distance | Oui | Absent | Backend, Front |
| Vue carte | Oui | Absent | Front |
| Recherche sauvegardée + alerte | Oui | Absent | Backend + Front |
| Historique de consultation | Oui | Absent | Front (local) |
| Résultats : photo de couverture, nb photos | — | La recherche ne renvoie **aucune photo** | Backend |

### 8.4 Page annonce
| Fonctionnalité | CdC | Code actuel | Écart |
|---|---|---|---|
| Galerie photos | Oui | Photos renvoyées | Front |
| Tableau de caractéristiques | Oui | `attributes` brut | Front (libellés) |
| Carte vendeur (note, ancienneté, pro) | Oui | Profil public dispo, **non joint** à l'annonce | Backend (inclure vendeur dans GET /listings/:id), Front |
| Annonces similaires | leboncoin | Absent | Backend (endpoint), Front |
| Compteur de vues | Oui | Fait (incrémenté à chaque GET, y compris par le propriétaire) | Backend (ne pas compter le propriétaire) |
| Signaler | Oui | Absent | Backend + Front |
| Favori / partage | Oui | Favori fait ; partage absent | Front |
| Localisation approximative | Oui | Absent | Front (carte) |
| SEO schema.org | Oui | Absent | Front (Next.js metadata) |

### 8.5 Messagerie et transaction
| Fonctionnalité | CdC | Code actuel | Écart |
|---|---|---|---|
| Chat temps réel | Oui | Fait | Front |
| Liste des conversations avec annonce / interlocuteur / dernier message / non-lus | Implicite | Renvoie uniquement les IDs | Backend (enrichir), Front |
| Accusé de lecture (`readAt`) | Oui | Colonne jamais remplie | Backend |
| Réponses rapides | Oui | Absent | Front |
| Proposition de prix | Oui | Absent | Backend + Front (reporté V1) |
| Photo dans un message | Oui | Colonne `attachmentUrl` inutilisée | Reporté |
| Blocage utilisateur | Oui | Absent | Backend + Front |
| Signalement de conversation | Oui | Absent | Backend (via Report) |
| Paiement séquestre | Oui | Fait (mock) ; Stripe non testé | Backend (onboarding Connect), Front |
| Commission affichée avant validation | Oui | Calculée serveur, non exposée avant achat | Backend (endpoint devis), Front |
| Remise en main propre avec code | Oui | Absent | Backend + Front (reporté) |
| Étiquette de livraison | Oui | Absent (`deliveryTrackingNumber` inutilisé) | Reporté (partenariat transporteur) |
| Statut `livree` par le vendeur | Implicite | Absent (le vendeur ne peut rien faire) | Backend + Front |
| Litige : résolution admin | Oui | Ouverture possible, **résolution impossible** | Backend (admin), Front admin |
| Remboursement | Oui | `refund()` provider jamais appelé | Backend (admin) |

### 8.6 Confiance, modération, admin
| Fonctionnalité | CdC | Code actuel | Écart |
|---|---|---|---|
| Avis après transaction | Oui | Fait | Front |
| Avis donnés (`listMine`) | Oui | Service existe, **aucune route** | Backend (route), Front |
| Signalement annonce / utilisateur | Oui | Absent | Backend + Front |
| Liste noire objets interdits | Oui | Absent | Backend (filtre mots-clés à la création → `en_attente`), Front (CGU) |
| Back-office admin complet | Oui | Absent | Backend + Front |
| Journal d'audit admin | Bonne pratique | Absent | Backend + Front admin |
| Stats globales | Oui | Absent | Backend + Front admin |
| CGU / confidentialité / mentions légales | Oui | Absent | Front (pages statiques) |
| DAC7 | Oui | Absent | Reporté (hors MVP, documenté) |

### 8.7 Espace pro
| Fonctionnalité | CdC | Code actuel | Écart |
|---|---|---|---|
| Vitrine (nom, description) | Oui | Fait | Front |
| Logo, horaires, adresse, site web | Oui | Absent | Backend (champs), Front |
| SIRET | Oui | Absent | Backend, Front |
| Statistiques (vues, contacts, favoris) | Oui | Vues seulement, pas d'agrégat | Backend (endpoint stats vendeur), Front |
| Import CSV/XML | Oui | Absent | Reporté (V2) |
| Abonnements | Oui | Absent | Reporté (V2) |
| Multi-utilisateurs | Oui | Absent | Reporté (V2) |

### 8.8 Sécurité / technique (détaillé dans AUDIT.md)
CORS ouvert, `synchronize: true`, secret JWT par défaut, pas de
vérification d'extension réelle des fichiers, pas de rate limiting dédié
OTP, DTO incomplets (`PATCH /users/me` sans DTO, `attributes` non
borné, `condition` libre), `suspendedAt` ignoré, pas de tests
automatisés, 21 vulnérabilités `npm audit` (dont 1 critique dans la
chaîne `sqlite3 → node-gyp → tar`).

---

## 9. Priorisation retenue pour cette mission

1. **Sécurité de l'existant** (bloquant) — CORS, migrations, secrets,
   rate limiting OTP, extension réelle des fichiers, `suspendedAt`, DTO,
   tests e2e.
2. **Signalement + rôle admin + back-office + audit log** (cahier des
   charges V1, indispensable pour opérer le site).
3. **Recherches sauvegardées + alertes** (job planifié + notification
   mock).
4. **Onboarding Stripe Connect** (structure testable, résultat réel non
   vérifiable ici).
5. **Compléments backend nécessaires au front** : sous-catégories,
   schémas de champs dynamiques, filtres état / livraison / pro /
   date / photo / rayon, similaires, enrichissement des conversations,
   `readAt`, blocage, statut `livree`, remboursement, suppression
   d'annonce, DTO profil, avis donnés, pages légales.
6. **Frontend Next.js** public + compte + admin.
7. Reporté et documenté (hors MVP) : SSO / e-mail, 2FA, options
   payantes, abonnements pro, import de flux, étiquettes transporteur,
   proposition de prix, photos dans les messages, DAC7, multi-utilisateurs,
   recherche visuelle, app mobile.

Sources principales consultées : centre d'aide leboncoin (articles
« Comment rechercher une annonce », « Quelles règles doit respecter mon
annonce », « Comment sauvegarder une recherche », « Vendeur : pourquoi
et comment vérifier mon identité », « Comment bloquer un utilisateur »,
« Acheteur : que faire si le produit reçu n'est pas conforme », « Le DPE
pour les annonces », « Comment souscrire au Pack Photos »), CGV Pro
`leboncoin.fr/dc/cgv_pro`, `leboncoinsolutionspro.fr` (offres Agilité /
Efficacité / Boutique premium), articles 2026 : sequr.fr (tarifs pro et
particulier 2026, paiement sécurisé 2026), lebondeal-bot.fr (photos,
livraison, alertes), annumoteurs.net (fin des crédits 27/04/2026),
margeoapp.com (frais 2026), blog-du-gcf.fr (tarifs particuliers 2026),
trustprotect.fr (remise en main propre 2026), finance-mag.com (paiement).
