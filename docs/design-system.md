# Trocoin — système de design (référence)

Trocoin rend les mêmes services que les grands sites d'annonces, sans en être une copie visible.
Ce document fixe les choix visuels et d'interaction ; toute nouvelle page les applique tels quels.
Dernière mise à jour : 15 septembre 2026 (tour « parité et différenciation », AUDIT.md §21).

## 1. Intention

- **Ton** : sobre, chaleureux, « papier clair ». Fond très légèrement teinté (`#f6f8f7`), surfaces
  blanches, encre bleu-nuit (`#1f2937`), un seul accent : le vert bouteille. Ni orange, ni fond
  sombre, ni dégradés saturés.
- **Signature** : titres et prix en **Fraunces** (serif à empattements doux), texte courant en
  **Public Sans** ; boutons et étiquettes en **pilules** (coins entièrement arrondis) ; cartes
  d'annonce « fiche » avec photo encadrée, prix posé sur la photo et cœur qui chevauche le cadre.
- **Structure** : en-tête sur deux rangées (identité et compte en haut, recherche large en
  dessous, familles en troisième ligne sur bureau), là où la plupart des sites mettent tout sur
  une ligne. Sur chaque écran, **une seule action dominante**.

## 2. Palette et usages

| Jeton | Valeur | Quand l'utiliser |
|---|---|---|
| `--bg` | `#f6f8f7` | fond de page, blocs de code, zones « repos » |
| `--white` | `#ffffff` | panneaux, cartes, champs, boîtes de dialogue, en-tête, pied de page |
| `--ink` | `#1f2937` | texte principal, titres, prix (contraste 14:1 sur blanc) |
| `--ink-soft` | `#3e4c59` | texte secondaire dans les cartes, libellés de navigation |
| `--ink-muted` | `#5f6b78` | aides, dates, métadonnées (4,9:1 sur blanc, jamais sous 12 px) |
| `--line` / `--line-soft` | `#d9e0e7` / `#e8edf2` | bordures de champs / séparateurs et cadres légers |
| `--accent` | `#0f7b5f` | **action principale** (un bouton par écran), liens, état actif, focus |
| `--accent-dark` | `#0b6249` | survol de l'accent, texte sur `--accent-tint` |
| `--accent-tint` | `#e4f3ee` | fond des encarts positifs, survol des menus, état sélectionné léger |
| `--ochre` / `--ochre-tint` / `#7a5211` | `#d89a2b` / `#fbf0d9` | mise en avant (« À la une »), avertissements doux, note du vendeur (texte `#7a5211`) |
| `--brick` / `--brick-tint` | `#b3412a` / `#fbe7e2` | erreurs, suppression, « Urgent », compteurs de non-lus |
| `--sage-dark` / `--sage-tint` | `#3f7d5a` / `#e6f2ea` | confirmations secondaires (« Fiche complète », livraison) |
| bleu clair des encarts | `#e9f1fb` / `#1f3f6b` | information neutre (`.alert-info`) uniquement |

Règles : jamais deux couleurs d'accent sur un même écran ; l'ocre et la brique servent aux
états, pas à la décoration ; aucun texte coloré sous 4,5:1.

## 3. Typographie

| Rôle | Police | Taille | Graisse | Notes |
|---|---|---|---|---|
| Titre de page (h1) | Fraunces | `clamp(1.8rem, 3vw, 2.4rem)` | 700 | interlettrage −0,012 em, interligne 1,15 |
| Titre de section (h2) | Fraunces | `clamp(1.35rem, 2.2vw, 1.75rem)` | 700 | |
| Sous-titre (h3, `.h3`) | Fraunces | 1,15 rem | 600 | |
| **Prix sur une carte** | Fraunces | 1 rem | 600 | dans la pilule posée sur la photo |
| Texte courant | Public Sans | 16 px | 400 | interligne 1,55 ; jamais sous 14 px |
| Titre de carte | Public Sans | 15 px | 600 | deux lignes maximum |
| Métadonnées, dates, aides | Public Sans | 12–13 px | 400 | couleur `--ink-muted` |
| Étiquette | Public Sans | 11 px | 700 | majuscules, interlettrage 0,06 em |
| Navigation | Public Sans | 12 px sous l'icône (bureau) | 600 | |

Champs de saisie : 16 px sur mobile (pas de zoom automatique), hauteur ≥ 46 px.

## 4. Formes, ombres, espacement

- **Rayons** : `--radius-sm` 6 px (champs, listes déroulantes), `--radius` 10 px (panneaux,
  cartes génériques, boîtes de dialogue), `--radius-lg` 16 px (**cartes d'annonce**, panneaux de
  filtres), `--radius-pill` 999 px (**boutons, étiquettes, puces de filtres, bouton compte**).
- **Ombres** : `--shadow` (`0 1px 2px` + `0 8px 24px −14px`, très douce) au survol des cartes ;
  `--shadow-lg` (`0 20px 50px −20px`) pour tout ce qui flotte (menus, volets, boîtes). Pas
  d'ombre au repos.
- **Grille d'espacement** (multiples de 4) : 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64. Marges
  latérales de page 20 px (16 px sous 720 px), gouttière des cartes 14 px (10 px sur mobile),
  contenu jamais à moins de 12 px du bord sur mobile.
- **Conteneur** : 1180 px. Grille de cartes `minmax(150px, 1fr)`, 2 colonnes sous 640 px.

## 5. Composants

- **Boutons** (pilules, hauteur 42 px, 44 px sur mobile) : `btn-primary` vert plein — **une
  seule fois par écran** (Déposer une annonce, Envoyer, Publier, Rechercher (N), Contacter le
  vendeur…) ; `btn-outline` bordure encre pour les actions secondaires ; `btn-ghost` texte vert
  pour les actions tertiaires ; `btn-dark` encre pleine pour l'action « forte mais secondaire »
  (Acheter à côté de Contacter) et les onglets sélectionnés ; `btn-danger` brique pour les
  suppressions, toujours derrière une confirmation. Enfoncement au clic (`scale .97`).
- **Étiquettes** (`.pill`) : pilules 11–12 px en majuscules ; teintes claires (`pill-green`,
  `pill-ochre`, `pill-brick`, `pill-sage`) ; `pill-accent` pour l'élément en cours (étape du
  dépôt) en vert foncé `--accent-dark` sur texte blanc (7,6:1) ; `pill-dark` encre. Les étiquettes
  changent de couleur d'un coup (pas de transition) pour qu'un contrôle de contraste ne tombe
  jamais sur une teinte intermédiaire. La variante `pill-tag` (« À la une », « Urgent ») pose sur la
  photo une étiquette blanche avec un point coloré à gauche.
- **Cartes d'annonce** (`ListingCard`) : cadre blanc arrondi 16 px avec **6 px de cadre autour
  de la photo** (5 px + bordure de 1 px ; photo carrée, coins 12 px), **prix en pilule blanche en bas à gauche de la
  photo**, **cœur rond blanc à cheval sur le bas droit de la photo**, étiquettes en haut à
  gauche, puis titre (2 lignes), ligne d'état / Pro / note, et en pied « lieu · date » (la date reste
  entière, le lieu se tronque) avec la livraison à droite. Survol : élévation de 2 px et ombre douce ; clic long (souris, 500 ms) :
  **aperçu rapide** dans une boîte sans quitter la liste.
- **Champs** : bordure `--line`, anneau de focus vert à 3 px, libellé au-dessus, aide en dessous
  en `--ink-muted`.
- **Icônes** : traits de 1,8 px, bouts ronds, 16–20 px, sans remplissage ; pas d'émoji dans les
  libellés de navigation (les émoji restent tolérés dans les puces d'accueil).
- **Illustrations** : aucune illustration figurative ; les états vides utilisent une icône dans
  un disque teinté et une phrase d'aide. Les photos d'annonces sont le seul contenu imagé.
- **Boîtes de dialogue** : panneau blanc 10 px, voile `rgba(30,27,22,.55)`, titre sur deux lignes
  possibles avec fermeture à droite, focus confiné, Échap.
- **Volets et menus** : entrée par translation + léger agrandissement (160–220 ms, `ease-out`),
  sortie symétrique ; jamais d'apparition brute. Réduits à zéro si l'appareil demande moins
  d'animations.
- **Accordéons** (filtres, pages de profil) : en-tête bouton avec chevron, ouverture animée par
  `grid-template-rows`, état mémorisé pour la session (`FilterSection`, une clé de session par
  usage). Sur les profils vendeur et boutique, la section la plus utile (annonces en ligne) est
  ouverte d'emblée, « Informations de la boutique » et « Avis reçus » sont repliées ; en-têtes en
  Fraunces 1,35 rem (`size="lg"`).
- **Barre de progression** : dépôt d'annonce (étape n/5 avec pourcentage) et navigation entre
  pages (filet vert de 3 px en haut de l'écran pendant le chargement).

## 6. En-tête et navigation

- **Bureau** : rangée 1 = logo à gauche ; à droite Mes recherches, Favoris, Messages (icône au-dessus
  du libellé), compte, puis « Déposer une annonce » (seule action verte). Rangée 2 = bouton
  « Catégories » et **recherche large en pilule** avec suggestions (annonces, catégories,
  communes, vos recherches récentes). Rangée 3 = familles de catégories (panneau au survol).
- **Mobile** (≤ 900 px) : rangée 1 = logo, Messages, menu ; rangée 2 = recherche pleine largeur ;
  le menu glisse vers le bas et contient dépôt, liens personnels, catégories en accordéon, compte.

## 7. Mouvement

| Nom | Durée | Usage |
|---|---|---|
| `appear` | 220 ms | cartes et blocs à l'arrivée (décalage 30 ms) |
| `menu-in` / `menu-out` | 180 ms | menus, panneaux de familles, listes de suggestions |
| `drawer-in` / `drawer-out` | 220 ms | volet des filtres, menu mobile |
| `modal-in` | 200 ms | boîtes de dialogue |
| `pop` | 280 ms | cœur favori |
| `progress` | continu | filet de navigation |

Pas d'animation d'opacité à l'ouverture (les textes doivent être mesurables à tout instant) ;
`prefers-reduced-motion` supprime tout.

## 8. Écrans : action dominante

| Écran | Action verte unique | Secondaires |
|---|---|---|
| Accueil / toutes pages | Déposer une annonce (en-tête) | recherche, liens |
| Résultats | Rechercher (N) dans le panneau | Sauvegarder la recherche (contour), tri, vue carte |
| Fiche annonce | Contacter le vendeur | Acheter (encre), favori, partager, signaler |
| Dépôt | Continuer / Publier | Retour, brouillon (fantôme) |
| Messagerie | Envoyer | photo, proposition, signaler, bloquer |
| Paramètres | Enregistrer de la section modifiée | autres sections en contour |
| Mes annonces | Déposer une annonce | actions par annonce en contour / fantôme, actions groupées |

## 9. Ce qui reste volontairement différent des grands sites

Pas de bandeau publicitaire, pas d'encart partenaire, pas de fond sombre, pas d'application à
télécharger tant qu'elle n'existe pas. Les suggestions et « recherches récentes » viennent du
navigateur de la personne, jamais d'un profilage.
