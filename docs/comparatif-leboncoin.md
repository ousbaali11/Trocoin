# Comparatif fonctionnel Trocoin / leboncoin — 15 septembre 2026

Ce document consolide les relevés faits sur leboncoin.fr les 14 et 15 septembre 2026 (mobile
375 px et bureau, connecté et non connecté ; détails dans `analyse-concurrentielle.md` §3, §10,
§11 et `AUDIT.md` §14) et donne, pour chaque fonctionnalité, son statut sur Trocoin après le tour
de refonte mobile-first. Trocoin garde son identité visuelle : la comparaison porte sur la
complétude fonctionnelle, jamais sur la copie de l'interface.

Statuts : **présent** (déjà là avant ce tour) · **ajouté** (dans ce tour) · **non pertinent**
(choix produit assumé, avec la raison) · **différé** (dépend d'un partenaire ou d'une décision).

## 1. Parcours non connecté

| Fonctionnalité leboncoin | Trocoin | Statut |
|---|---|---|
| Accueil : recherche « Quoi ? / Où ? », raccourcis, familles de catégories | Accueil avec barre réduite, raccourcis (dons, échanges, du jour, livraison), 12 familles | présent |
| Recherche par mot-clé avec suggestions et correction | Suggestions titres + catégories, correction orthographique simple | présent |
| Localisation : autour de moi, commune + rayon (0 à 200 km), toute la France | Identique (9 paliers de rayon, 5 km par défaut) ; « Toute la France » affiché dans le champ | présent (affichage corrigé) |
| Filtres : prix min/max, état, date de publication, livraison, avec photo, particulier/pro, urgentes, type de prix | Tous présents, plus les filtres spécifiques par famille (12 familles) | présent |
| Sous-catégories | Arborescence familles → catégories, filtre et fil d'Ariane | présent |
| Tri : pertinence, date, prix croissant/décroissant, distance | Date, prix, distance présents ; **pertinence** (score plein texte PostgreSQL, puis mises en avant, puis fraîcheur) | ajouté |
| Pagination | Pagination classique (24 par page) ; leboncoin pagine aussi | présent |
| Vue carte | Carte des résultats (Leaflet, positions approximatives) | présent |
| Cartes d'annonce : titre, prix, lieu, date de dépôt, badges Urgent / À la une / Pro, cœur favori | Identique en hiérarchie, palette Trocoin (AUDIT §14 et §16) | présent |
| Fiche annonce : galerie, caractéristiques, description, carte vendeur (note, ancienneté, réactivité), localisation approximative, annonces similaires, annonces du vendeur | Présent, plus le prix moyen constaté de la catégorie | présent |
| Partage d'annonce (menu) | Copier le lien, WhatsApp, e-mail, Facebook, X, partage natif | présent |
| Signalement d'annonce | Motifs fermés + précisions, traité en console d'administration | présent |
| « Voir le numéro » du vendeur | Non : la messagerie est le seul canal (protection des membres) | non pertinent |
| Aperçu rapide d'une annonce (survol sur bureau) | Non observé sur mobile ; la fiche s'ouvre directement | non pertinent |
| Pages statiques : aide, CGU, confidentialité, mentions légales | Centre d'aide (6 rubriques, 22 articles, recherche), pages légales éditables | présent |
| Bons plans, simulation de crédit, financement, Protection Panne | Services partenaires | non pertinent |

## 2. Parcours connecté

| Fonctionnalité leboncoin | Trocoin | Statut |
|---|---|---|
| Tableau de bord | Statistiques, dernières annonces, messages, transactions en cours, notifications | présent |
| Dépôt d'annonce : catégorie, champs par catégorie, photos (ordre, couverture), prix (fixe, négociable, don, échange), localisation, livraison, aperçu, brouillon | Identique, 10 photos réordonnables, brouillon, modération des annonces sensibles | présent |
| Gestion des annonces : modifier, renouveler, dupliquer, mettre en pause, marquer vendue, statistiques | Identique, plus « Mettre en avant » et « Urgent » (gratuits pendant le lancement) | présent |
| Messagerie temps réel, réponses rapides, photos, offres de prix, « Vu », « en train d'écrire » | Identique (WebSocket) | présent |
| Favoris, recherches sauvegardées avec alertes, annonces consultées | Identique | présent |
| Notifications et préférences par évènement et canal | Identique (compte, push, e-mail, SMS pour les critiques) | présent |
| Paramètres : profil, identifiants, mot de passe, sessions, export RGPD, suppression | Identique ; connexion par e-mail, nom d'utilisateur **ou mobile** | présent (mobile ajouté) |
| Paiement sécurisé avec fonds bloqués, remise en main propre par code, suivi d'envoi | Stripe Checkout en capture différée, code de remise à 6 chiffres, numéro de suivi | présent |
| Avis après transaction (donnés / reçus) | Identique | présent |
| Historique d'achats et ventes, litiges avec médiation | Identique (arbitrage en console) | présent |
| Badges : Pro, Identité vérifiée, Réactif | Pro et Identité vérifiée présents ; « Réactif » (taux et délai de réponse) | différé (nécessite un historique de réponses significatif) |
| Blocage d'un utilisateur | Identique | présent |
| Étiquettes transporteur intégrées | Absent | différé (partenariat transporteur) |
| Espace pro : vitrine, statistiques, import de catalogue, multi-comptes, formules | Identique (monétisation désactivée pendant le lancement) | présent |

## 3. Écarts volontairement non repris

- Finition / version constructeur (véhicules) : référentiel propriétaire ; marque → modèle est
  désormais couvert par une liste statique (§5.2).
- Type d'annonce « Demande » : Trocoin ne gère que des offres.
- Accessibilité « renfort de contraste » : les contrastes Trocoin sont conformes AA par défaut.
- Recherche par dates d'arrivée / départ (locations de vacances) : relève d'un moteur de
  réservation, hors périmètre d'un site d'annonces.

## 4. Ce que ce tour a ajouté ou corrigé

1. Tri par **pertinence** sur les recherches par mot-clé (`sort=relevance`).
2. Connexion par **numéro de mobile** en plus de l'e-mail et du nom d'utilisateur.
3. Affichage de **« Toute la France »** dans le champ de localisation quand il est choisi.
4. Marges mobiles, cartes compactes, en-tête sur une ligne, fluidité (transitions, squelettes
   de chargement, retours tactiles) : voir `AUDIT.md` §16 et §17.

## 5. Les six familles restantes, le menu « Partager » et les items « confort » — 15 septembre 2026 (après-midi)

### 5.1 Conditions du relevé

Le relevé des panneaux de filtres sur leboncoin.fr (bureau, cookies refusés) a permis d'ouvrir le
menu « Tous les filtres » d'une famille et la liste de ses sous-catégories (Matériel professionnel :
Tracteurs, Matériel agricole, BTP - Chantier gros-oeuvre, Poids lourds, Manutention - Levage,
Équipements industriels, Équipements pour restaurants & hôtels, Équipements & Fournitures de bureau,
Équipements pour commerces & marchés, Matériel médical ; les treize familles du menu, dont
« Locations de vacances », « Animaux », « Services », « Famille », « Loisirs »). Au premier choix
d'une sous-catégorie, le site a répondu « Accès temporairement restreint » (protection
anti-robot), encore actif une heure plus tard. Aucun contournement n'a été tenté, conformément à la
règle du projet. **Les filtres détaillés ci-dessous n'ont donc pas été observés ce jour** : ils
reposent sur la connaissance générale du site et sont à confirmer lors d'un passage manuel
(≈ 15 minutes depuis un navigateur normal, une sous-catégorie à la fois).

**Une exception, observée pour de bon** : deux heures plus tard, la page de résultats de la
famille Animaux s'est ouverte et son menu « Tous les filtres » a pu être lu en entier — Prix,
**Type d'animal** (Tout, Chiens, Chats, Nouveaux animaux de compagnie, Equidés, Animaux de la
ferme, Oiseaux, Poissons, avec le nombre d'annonces de chaque valeur), Tri, Type d'annonces
(Offres / Demandes), Type de vendeurs, Annonces urgentes. Le blocage est revenu au clic suivant.
La liste « Animal » de Trocoin a été alignée sur ces valeurs.

### 5.2 Statut par famille

| Famille | Filtres attendus sur leboncoin (à confirmer) | Trocoin avant ce tour | Ajouté ce tour | Statut |
|---|---|---|---|---|
| Matériel professionnel | Par sous-catégorie : type de matériel, marque, année, heures, puissance (tracteurs), PTAC (poids lourds) | Marque et année à la racine seulement (non hérités par BTP et Agricole), type + heures | BTP et Agricole : marque, année, heures filtrables, types étendus (poids lourds, manutention, semis, fenaison, pulvérisation), puissance (ch) ; Restauration : types étendus, marque ; Fournitures de bureau : type, marque, quantité | ajouté |
| Famille | Équipement bébé : produit, type, marque, couleur ; mobilier enfant : type ; vêtements bébé : taille, type, univers, marque | Type de produit, marque, couleur (puériculture) ; taille + marque (vêtements) | Puériculture : 5 types de plus ; mobilier : types étendus, marque, couleur ; vêtements : type de vêtement, fille / garçon / mixte, marque filtrable | ajouté |
| Loisirs | Sport : univers, activité (liste), produit, marque ; instruments : type, niveau ; vélos : type, taille de cadre, roues, matériau, marque ; livres : genre, format ; jouets : âge, type | Discipline en texte libre, type d'instrument, type de vélo, genre | Sport : activité en liste (19 entrées) + univers ; vélos : taille de cadre en liste, taille des roues, matériau ; livres : genres étendus + format ; jouets et collection : filtres activés, marque | ajouté |
| Locations de vacances | Type de logement, capacité, chambres, environnement, classement (étoiles), équipements (piscine, jardin, wifi, climatisation, parking, TV, lave-linge, barbecue), animaux acceptés ; dates | Type, voyageurs, piscine, jardin, animaux, wifi, climatisation, parking, chambres | Types : mobil-homes, hôtels, insolites ; environnement ; classement ; TV, lave-linge, barbecue ; wifi / climatisation / parking / chambres filtrables | ajouté (dates : non pertinent, §3) |
| Services | Cours : matière (liste), niveau ; prestations : type ; services animaux : type, animal, tarif ; entraide : type d'aide | Matière en texte libre ; sous-catégories Services animaux et Entraide sans champs propres | Matière en liste (17 entrées), niveau filtrable, événementiel filtrable ; schémas propres pour Services animaux et Entraide entre voisins | ajouté |
| Animaux | **Observé** : Type d'animal (Chiens, Chats, Nouveaux animaux de compagnie, Equidés, Animaux de la ferme, Oiseaux, Poissons), Offres / Demandes ; attendus par sous-catégorie : race, âge, sexe, vacciné, identifié, LOF ; accessoires : animal concerné, type | Type (9 valeurs dont Rongeur, Reptile, Cheval), race, âge en texte libre, sexe, identification, vacciné, LOF | Liste « Animal » alignée sur les 7 valeurs observées + Autre ; âge en tranches filtrable, race et sexe filtrables (vente / don), sexe ajouté aux dons ; accessoires : animal concerné, types étendus, marque | ajouté (Demandes : non pertinent, §3) |

### 5.3 Menu « Partager »

Le menu de partage d'une annonce leboncoin n'a pas pu être ouvert (même blocage). D'après la
connaissance générale du site, il propose : copier le lien, WhatsApp, Messenger, e-mail, Facebook,
et le partage natif du téléphone sur mobile. Trocoin propose : partage natif du téléphone (quand
il existe), copier le lien, WhatsApp, e-mail, Facebook, X. **Équivalent** : seul Messenger manque,
et il exige une clé d'application Facebook — non repris. Aucun changement ce tour.

### 5.4 Items « confort » livrés (AUDIT.md §19)

| Fonctionnalité | Trocoin | Statut |
|---|---|---|
| Listes marque → modèle (voitures, motos, utilitaires) | Listes dépendantes : 57 marques de voitures, 31 de motos, 17 d'utilitaires, « Autre » toujours possible ; le modèle se filtre selon la marque au dépôt comme en recherche ; validé côté serveur | ajouté |
| Historique des localisations | 5 dernières communes proposées avant la saisie (« Récents ») dans la recherche et le dépôt ; navigateur + compte quand connecté (partagé entre appareils) | ajouté |
| Arrondissements groupés | Paris, Lyon, Marseille : une entrée « toute la ville » et un sous-menu dépliable des arrondissements (1er à 20e, 1er à 9e, 1er à 16e), libellés « Paris 11e (75011) » | ajouté |
| Changement d'e-mail avec confirmation | Mot de passe exigé, lien envoyé à la nouvelle adresse (24 h), avertissement à l'ancienne à la demande et à la confirmation | ajouté |
| Double authentification | TOTP (Google Authenticator, Aegis, Authy…), QR code, 8 codes de récupération à usage unique, désactivation avec mot de passe + code ; facultative | ajouté |

## 6. Dix points relevés par captures d'écran (connecté et non connecté) — 15 septembre 2026 (soir)

| # | Point observé sur leboncoin | Trocoin après ce tour | Statut |
|---|---|---|---|
| 1 | Panneau « Tous les filtres » identique pour toutes les catégories : Catégories, Étendre à la livraison, Prix min/max, Dons uniquement, Tri (5 choix), Type d'annonces (Offres / Demandes), Type de vendeurs avec compteurs, Annonces urgentes, boutons fixes « Tout effacer » / « Rechercher (N) » | Même panneau pour toutes les catégories, dans cet ordre : Catégories (catégorie active rappelée et modifiable), Localisation, **Étendre à la livraison** (nouveau paramètre `delivery_anywhere`), Prix, **Dons uniquement**, **Tri** en choix unique (Pertinence, Plus récentes, **Plus anciennes** — nouveau tri, Prix croissants, Prix décroissants), **Type de vendeurs** en cases à cocher avec le nombre d'annonces de chaque type (`GET /listings/facets`), **Annonces urgentes uniquement**, puis les filtres propres à Trocoin (état, photo, date, critères de la catégorie). Barre fixe en bas : « Tout effacer » (garde le mot-clé) et « Rechercher (N) », N mis à jour à chaque changement. Bureau : colonne fixe ; mobile : volet qui glisse depuis la droite, plein écran en hauteur | ajouté |
| 1 bis | Type d'annonces : Offres / Demandes | Non repris : Trocoin ne publie que des offres (§3). Un choix à une seule valeur n'apporterait rien | non pertinent |
| 2 | Suppression de conversations | Bouton « Sélectionner » ou appui long sur une conversation → cases à cocher, « Tout sélectionner / Tout désélectionner », « Supprimer (n) » avec confirmation « Supprimer n conversations ? … Cette action est irréversible ». La conversation n'est retirée que pour la personne qui supprime (colonnes `hiddenForBuyerAt` / `hiddenForSellerAt`) : l'autre participant garde l'échange, la modération et les litiges aussi ; elle réapparaît si l'autre écrit à nouveau. Documenté dans `conversation.entity.ts` | ajouté |
| 3 | Mega-menu : chaque famille de la barre de navigation ouvre un panneau de sous-catégories en colonnes, parfois avec un encart promotionnel | Barre des familles sous l'en-tête sur bureau (≥ 1024 px, appareils avec survol) : survol ou clic ouvre un panneau avec les sous-catégories en colonnes de 8, lien « Tout {famille} », fermeture par Échap ou clic ailleurs. Sur mobile, le menu principal garde l'accordéon existant. Pas d'encart promotionnel (rien à inventer) | ajouté |
| 4 | Bas de page de catégorie : « Les utilisateurs recherchent aussi… », « Localisations les plus demandées… », fil d'Ariane | `GET /listings/discover?category=…` : recherches suggérées construites à partir des sous-catégories et des valeurs des critères de la catégorie (marques pour les véhicules), villes des annonces en ligne de la catégorie (avec leur nombre) complétées par les grandes villes françaises tant que le site est jeune, fil d'Ariane Accueil › Famille › Catégorie. Aucune recherche « fréquente » n'est enregistrée sur Trocoin (pas de journal des recherches, choix de sobriété) : les suggestions viennent des données du site, pas d'un historique | ajouté |
| 5 | Pagination numérotée avec flèches | Déjà en place (`Pagination.tsx` : Précédent, numéros avec points de suspension, Suivant) ; aucun défilement infini. Rien à changer | présent |
| 6 | Sans connexion : annonces complètes (photo, titre, prix, livraison, vendeur avec note et nombre d'avis, cœur, badge « À la une ») ; seule une action demande la connexion | Fiche et résultats entièrement publics (aucun mur de connexion). **Ajouté** : la note du vendeur et son nombre d'avis sur les cartes (« ★ 4,8 (12) », dès le premier avis). Favori, contact, achat, signalement, sauvegarde de recherche → page de connexion avec retour. Le coût de livraison n'est pas affiché : Trocoin n'a pas de tarif de livraison intégré (mention « Livraison possible ») | présent (note ajoutée) |
| 7 | Badge « À la une » en haut à gauche de la photo | Déjà en place, au même endroit (avec « Urgent ») ; libellé identique. Rien à changer | présent |
| 8 | Bandeau explicatif quand le filtre livraison est actif, puce « Livraison acceptée ✕ », sélecteur de périmètre France | Bandeau « Livraison : les annonces ci-dessous peuvent vous être envoyées… », puce « Livraison acceptée ✕ » retirable, périmètre « Autour de {commune} » / « France » (= étendre à la livraison) quand une localisation est choisie ; l'en-tête des résultats indique « + livraison partout en France » | ajouté |
| 9 | Pied de page sombre en 4 colonnes, applications mobiles, marques sœurs, réseaux sociaux, note Trustpilot | Quatre colonnes (À propos, Informations légales, Nos solutions pros, Des questions ?) avec 16 liens qui aboutissent tous (nouvelle page `/accessibilite`, factuelle, sans taux de conformité inventé). Omis volontairement : applications mobiles, réseaux sociaux et avis externes (n'existent pas), fond sombre (palette claire du site) | ajouté (partiel, volontaire) |
| 10 | Encarts Google Ads et « Sponsorisé » tiers | Aucune régie publicitaire ; les seules mises en avant sont les annonces « À la une » des vendeurs Trocoin (point 7) | non pertinent |

## 7. Confirmation de parité, ligne par ligne — 15 septembre 2026 (nuit)

Ce n'est pas une relecture du document : chaque ligne des sections 1, 2, 5 et 6 a été rejouée
par `node scripts/audit-parite.js`, qui interroge la **production publique sans connexion** (API
Render, pages Vercel, Chromium pour ce qui se rend côté navigateur) et, pour les parcours
connectés, la **pile locale construite à partir du même commit** avec le seed e2e (aucun compte
de test n'écrit en production). Le tableau complet, numéroté, avec la preuve et la source de
chaque ligne, est dans `docs/parite-resultats.md` (régénéré à chaque exécution).

**Résultat chiffré (production 1.13.0, 15 septembre 2026, nuit) : 36 points contrôlés —
32 équivalents, 2 partiels, 1 manquant, 1 non pertinent (choix produit).**

Ce qui n'est pas équivalent, et pourquoi :

| # | Point | Statut | Constat |
|---|---|---|---|
| 1 | Cartes en production (photo, prix, badges, cœur, note) | partiel | aucune annonce n'est en ligne en production au moment du contrôle : la carte est vérifiée sur la pile locale (scénario 01) mais pas en production |
| 2 | Badges Pro / Identité vérifiée / **Réactif** | partiel | Pro et Identité vérifiée affichés ; « Réactif » toujours différé (le taux de réponse est calculé, aucun badge ne l'affiche) |
| 3 | Étiquettes transporteur intégrées | manquant | pas de partenaire transporteur : numéro de suivi saisi à la main (différé, §2) |
| 4 | Bons plans, crédit, financement, Protection Panne, régie publicitaire | non pertinent | services partenaires hors périmètre (§3, §6 point 10) |

Écart découvert par ce contrôle et corrigé dans le même tour : la ligne « appareils connectés »
de la section 2 était marquée présente alors que seule l'API existait (`GET/DELETE
/auth/sessions`) ; l'écran « Appareils connectés » des paramètres a été ajouté (liste des
sessions avec navigateur et système, « Déconnecter tous les appareils » avec confirmation).
Ajouts de ce tour repris dans le contrôle : aperçu rapide d'une annonce au clic long, « Plus de
filtres » en accordéon, suggestions de communes et recherches récentes pendant la frappe,
catégorie suggérée d'après le titre, actions groupées sur Mes annonces.

## 8. Fiche annonce complète, prix hors photo, carte zoomée — 16 septembre 2026

Brief « Fiche annonce complète (inspirée de leboncoin) + prix hors photo + zoom carte ». Chaque
élément de l'inventaire leboncoin (du clic sur une annonce au bas de page) est repris ici avec son
statut **après** ce tour : **en place** (existait déjà, vérifié), **complété** (existait
partiellement), **ajouté** (nouveau), **équivalent** (fonction obtenue autrement, avec ce que
Trocoin sait réellement), **écarté** (avec la raison). Vérifié par le scénario `e2e/18-fiche` et
par les captures du tour (AUDIT.md §33).

| # | Élément observé sur leboncoin | Statut | Ce que fait Trocoin |
|---|---|---|---|
| 1 | Fil d'Ariane Accueil › Catégorie › Région › Département › Ville › Titre | **complété** | avant : Accueil › Famille › Catégorie. Maintenant les six niveaux : région et département dérivés du code postal (`src/common/geo/france-admin.ts`, jamais de l'adresse), chaque niveau cliquable vers la recherche filtrée (`region=`, nouveau filtre ; `postal_code=69` ; `city=`), titre en `aria-current`. Le `BreadcrumbList` (Google) suit les mêmes niveaux |
| 2 | Galerie : plusieurs photos, compteur, partage, compteur de favoris, « Voir les photos » | **complété** | compteur « n / total » et vignettes existaient ; ajoutés sur la photo : cœur + nombre de favoris, menu « Partager », bouton « Voir les photos » (plein écran avec flèches, compteur, clavier, Échap) |
| 3 | Bloc prix : titre, lieu + année / km / carburant, prix, position par rapport au marché, « il y a X jours » | **complété** | ligne de repères sous le titre selon la catégorie (année · kilométrage · carburant ; surface · pièces ; marque · modèle…) ; jauge « Prix dans la fourchette / Bonne affaire / Au-dessus du marché » construite sur l'estimation déjà utilisée au dépôt (`/listings/price-estimate`, médiane et quartiles des annonces comparables en ligne) ; rien d'affiché sous trois annonces comparables ; « Publiée aujourd'hui / hier / il y a N jours » (date complète au survol) |
| 4 | Bloc vendeur : avatar, nom, « Suivre », badges de confiance, « Membre depuis », message, paiement sécurisé, téléphone | **complété / équivalent** | avatar, nom, type, identité vérifiée, note, « Membre depuis » existaient. **Ajouté « Suivre »** : recherche sauvegardée sur le seul critère vendeur (`query.seller`), alerte à chaque nouvelle annonce, visible et gérable dans « Mes recherches », « ✓ Suivi » pour retirer. Repères de confiance **uniquement calculés** : « Répond à X % des messages » (taux existant, affiché à partir de 80 %) et « N annonces en ligne » ; pas de badge « Très réactif » ni « profil recommandé » inventé. Message et « Acheter » (paiement sécurisé Trocoin, inchangé) : boutons du bloc d'actions juste au-dessus. **Téléphone : écarté**, Trocoin ne rend jamais un numéro public (contact par messagerie) |
| 5 | « Les + de cette annonce » | **ajouté** | badges tirés des données réelles de l'annonce : annonce récente (< 7 jours), fiche complète, N photos (≥ 3), neuf, livraison possible, vente urgente, vendeur à l'identité vérifiée, vendeur professionnel, options cochées dans les critères (contrôle technique à jour, première main, piscine…) ; section absente quand rien ne ressort |
| 6 | « Les informations clés » en grille à deux colonnes, « Voir les critères supplémentaires » | **complété** | les critères par catégorie existaient (panneau « Caractéristiques » en colonnes automatiques) ; maintenant « Les informations clés » : grille à deux colonnes (une sur mobile), six critères visibles, « Voir les critères supplémentaires (n) » / « Voir moins » |
| 7 | Équipements avec dépliant | **ajouté** | section « Équipements » = options cochées des critères (booléens à oui), coche verte, « Voir tous les équipements (n) » au-delà de six ; ces options ne sont plus répétées dans les informations clés |
| 8 | Description avec « Voir plus » / « Voir moins » | **ajouté** | tronquée à 8 lignes ou 500 caractères, texte complet dans le HTML (moteurs de recherche) |
| 9 | Localisation : carte | **complété** | zoom 11 → **13** (rues lisibles) ; cercle : rayon réel inchangé (1,5 km, cohérent avec l'arrondi des coordonnées publiques à 0,01°) mais **≈ 4 fois plus grand à l'écran** (≈ 58 px → ≈ 226 px de diamètre), trait de 3 px et fond teinté ; carte de 320 px de haut ; libellé « Ville, Département, Région ». Même carte **ajoutée à l'aperçu avant publication** du dépôt (coordonnées arrondies comme pour les visiteurs) |
| 10 | « Signaler l'annonce » toujours accessible | **complété** | existait dans le bloc d'actions (colonne de droite, qui reste collée à l'écran) ; ajouté un lien « Signaler l'annonce » en bas de la fiche, même boîte de dialogue, connexion demandée avec retour sur l'annonce |
| 11 | « Ces annonces peuvent vous intéresser » : carrousel + « Voir plus d'annonces » | **complété** | la section « Annonces similaires » (même catégorie, même département d'abord) devient un carrousel horizontal (accroche au défilement, flèches quand ça déborde, tactile et molette) titré « Ces annonces peuvent vous intéresser », avec « Voir plus d'annonces » vers la catégorie |
| 12 | Badge « Déjà vu » sur les vignettes des résultats | **ajouté** | étiquette « Déjà vu » (en haut à gauche de la photo, à côté d'« À la une » / « Urgent ») ; visiteur : 100 derniers identifiants mémorisés dans le navigateur ; membre : fusion avec l'historique serveur de « Annonces consultées » (`GET /listings/history/ids`), donc valable d'un appareil à l'autre ; jamais sur ses propres annonces |
| 13 | Prix incrusté sur la photo des cartes | **retiré (demande)** | le prix passe **sous la photo**, dans le bloc de texte après le titre (Fraunces 1,05 rem, encre), sur toutes les cartes (résultats, accueil, profils, favoris, historique, similaires) ; la fiche n'affiche le prix qu'une fois, sous le titre |
| 14 | Simulateur de financement, assurance / garantie payante, publicités et carrousels sponsorisés | **écarté** | partenariats commerciaux réels de leboncoin (banque, assureur, régie) ; le paiement sécurisé Trocoin reste tel quel |

Ce qui n'existe pas sur Trocoin et n'a pas été inventé : téléphone du vendeur (jamais public),
badges « Très réactif » / « profil recommandé » (aucune donnée fiable ; le taux de réponse calculé est
affiché tel quel), position du prix sans annonces comparables (rien d'affiché plutôt qu'un
chiffre).
