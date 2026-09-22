# Trocoin — plateforme de petites annonces (France)

Monorepo : **API NestJS 12 + TypeORM** (racine) et **front Next.js 16** (`frontend/`).
Règle non négociable : un compte = un numéro de **mobile français (+33 6/7)**. Tout autre
indicatif est refusé à l'inscription. La vérification de ce numéro par SMS est **différée par
choix** pendant la bêta (voir `AUDIT.md` §6) : le code Vonage reste en place, désactivé.

Documents : `cahier-des-charges.md`, `architecture-technique.md`,
`analyse-concurrentielle.md` (étude leboncoin + écarts), `docs/design-system.md` (direction artistique et composants), `docs/seo-checklist.md` (état du site pour Google Search Console), `docs/etiquettes-transporteur.md` (étiquettes d'envoi : comparatif Boxtal / Sendcloud / direct, architecture en simulation), `docs/parite-resultats.md` (contrôle de parité rejouable : `node scripts/audit-parite.js`), `AUDIT.md` (sécurité,
complétude, ce qui n'a pas pu être testé, recommandations avant lancement),
`DEPLOIEMENT.md` (mise en ligne pas à pas : Neon + Render + Vercel, sauvegardes, SMS).

**Production** : API `https://api.trocoin.fr` (Render, Docker, PostgreSQL Neon ; ancienne adresse
`trocoin.onrender.com` conservée en alias) et front `https://www.trocoin.fr` (Vercel ; `trocoin.fr` et
`trocoin.vercel.app` y redirigent). Déploiement automatique à chaque push sur `main` après une
CI verte (tests API, tests navigateur, image Docker) ; procédure et variables : `DEPLOIEMENT.md`.

## Démarrage rapide (développement)

```bash
# API (port 3000) — SQLite locale, SMS / paiement / notifications simulés
npm install
cp .env.example .env
npm run dev

# Front (port 3001)
cd frontend && npm install && cp .env.example .env.local && npm run dev -- -p 3001
```

- Site public : http://localhost:3001 — inscription par formulaire (aucun SMS). L'ancien parcours
  de connexion par code SMS n'a plus d'écran : `/connexion/sms` renvoie vers `/connexion`
  (les routes OTP de l'API restent, utilisées par les tests).
- Données de démonstration : `node test/seed-demo.js` (3 comptes, 12 annonces avec photos,
  1 annonce bloquée par la pré-modération, 1 signalement, 1 conversation).
- Premier administrateur : `npm run create-admin -- 0611223344 "Admin"` (crée ou promeut le
  compte portant ce numéro) puis connexion → menu « Console d'administration » → `/admin`.

## Tests

```bash
npm test                 # 235 tests e2e (API, supertest)
npm run e2e:build        # construit l'API (dist/) et le front (next build) pour les tests navigateur
npm run e2e              # 115 scénarios Playwright dans Chromium (desktop 1280 px + mobile 375 px) : parcours, accessibilité (axe) site + back-office, clavier, SEO
node scripts/charge.js --api https://api.trocoin.fr --front https://www.trocoin.fr --vus 10 --minutes 3   # test de charge léger (lectures publiques)
SOURCE_DATABASE_URL=… TARGET_DATABASE_URL=… node scripts/migrer-base.js   # copie intégrale d'une base Postgres vers une autre, preuve par comptages + empreintes (DEPLOIEMENT.md §6b) (Jest + supertest, SQLite en mémoire)
# Les mêmes tests sur PostgreSQL (schéma créé par les migrations) :
E2E_DB=postgres DB_TYPE=postgres DATABASE_URL=postgresql://... DB_SYNCHRONIZE=false npm test
cd frontend && npx tsc --noEmit && npx next build
```


## Tests navigateur (Playwright)

Scénarios utilisateur de bout en bout, joués dans un vrai Chromium contre **l'API compilée**
(`dist/main.js`, base SQLite jetable `data/e2e.sqlite`, fournisseurs simulés : SMS, paiement,
e-mail, registre Sirene) et **le front construit** (`next build` puis `next start`). Rien de
manuel : Playwright démarre et arrête les deux serveurs (`e2e/start-api.js`, `playwright.config.ts`).

```bash
npx playwright install chromium   # une fois
npm run e2e:build                 # API + front (≈ 2 min)
npm run e2e                       # 115 scénarios (≈ 4 min 30)
npx playwright show-report        # rapport HTML, traces et captures des échecs
npm run e2e:ui                    # mode interactif pas à pas
```

Ports par défaut : API 3000, front 3001. Si le port 3000 est occupé, changez les deux URL avant
la construction ET l'exécution (l'URL de l'API est figée dans le build du front) :
`E2E_API_URL=http://localhost:3010 E2E_FRONT_URL=http://localhost:3011 npm run e2e:build && … npm run e2e`.

| Fichier | Parcours | Écrans |
|---|---|---|
| `e2e/01-recherche.spec.ts` | mot-clé, catégorie, « Toute la France », rayon 5 km → 1 km autour de Lyon, tri par distance et par prix | desktop + mobile |
| `e2e/02-inscription.spec.ts` | particulier (mot de passe, doublons e-mail et téléphone), professionnel (SIRET valide, clé fausse, SIRET inconnu du registre) | desktop + mobile |
| `e2e/03-connexion.spec.ts` | e-mail ou username, mauvais mot de passe, déconnexion, espace compte et console refusés ensuite | desktop |
| `e2e/04-depot.spec.ts` | Voitures (critères obligatoires, 2 photos, code postal) et Locations de vacances (champs propres, 1 photo, commune) | desktop |
| `e2e/05-achat.spec.ts` | deux navigateurs : contact, messagerie temps réel, achat simulé, réception confirmée, avis | desktop |
| `e2e/06-admin.spec.ts` | connexion admin, refus d'annonce avec motif, signalement déposé par un membre puis traité | desktop |
| `e2e/07-accessibilite.spec.ts` | axe-core (WCAG 2.0/2.1 A + AA, bonnes pratiques) sur 26 pages publiques et du compte, panneau de localisation et boîte de dialogue ouverts, étapes du dépôt : zéro violation tolérée (contraste, libellés, noms accessibles, titres, points de repère, alt) | desktop |
| `e2e/09-admin-accessibilite.spec.ts` | back-office : axe sur les 10 pages de la console (files alimentées par l'API), suspension puis réactivation d'un compte au clavier seul avec la boîte de confirmation, trace dans le journal | desktop |
| `e2e/10-seo.spec.ts` | sitemap (familles, sous-catégories, aide, légal, annonces ; rien de privé), robots.txt, titre + description uniques par page et `noindex` des pages privées, JSON-LD Product + fil d'Ariane et WebSite | desktop |
| `e2e/08-clavier.spec.ts` | clavier seul : lien d'évitement, recherche avec commune et rayon aux flèches, menu du compte et déconnexion, boîte de dialogue (focus confiné, Échap, retour du focus), dépôt (radios aux flèches, champ fichier atteignable) | desktop |
| `e2e/11-marges-mobile.spec.ts` | marges ≥ 12 px et absence de débordement sur les pages publiques et du compte à 375 px | mobile |
| `e2e/12-securite.spec.ts` | changement d'adresse e-mail (mot de passe, lien à la nouvelle adresse, avertissement à l'ancienne, effectif au clic) ; double authentification (QR code, activation, connexion en deux temps, code de récupération à usage unique, désactivation) | desktop |
| `e2e/13-messagerie.spec.ts` | suppression de conversations : mode sélection, sélection individuelle et multiple, tout sélectionner / désélectionner, confirmation, annulation ; l'autre participant garde ses conversations | desktop |
| `e2e/14-filtres-decouverte.spec.ts` | panneau « Tous les filtres » (ordre des blocs, tri, dons, vendeurs avec compteurs, urgentes, Tout effacer, Rechercher (N), volet mobile), bandeau livraison et périmètre France, bas de page de catégorie (suggestions, villes, fil d'Ariane), pagination, barre des familles, pied de page, consultation sans connexion | desktop + mobile |
| `e2e/15-experience.spec.ts` | suggestions pendant la frappe (annonce, catégorie, commune) et recherches récentes, aperçu rapide au clic long, panneau des familles et menu « Catégories » animés, menu mobile animé, dépôt (barre de progression, catégorie suggérée d'après le titre, jauge de prix en direct, checklist « Faire → »), Mes annonces (rien de groupé avec une annonce, sélection et pause groupée avec deux), appareils connectés et déconnexion générale | desktop + mobile |
| `e2e/16-profils.spec.ts` | profils vendeur et boutique en sections repliables : annonces ouvertes, avis et informations de la boutique repliés, clavier (Entrée / Espace, aria-expanded), état mémorisé après rechargement, axe sans violation, compte pro créé pour le scénario | desktop + mobile |
| `e2e/17-expedition.spec.ts` | étiquette d'envoi : adresse de livraison exigée au paiement, panneau vendeur (colis prérempli, tarif, point relais, achat de l'étiquette, PDF téléchargé, numéro repris), confirmation d'expédition, suivi côté acheteur ; refus du transporteur affiché sans bloquer la vente, saisie manuelle | desktop |
| `e2e/18-fiche.spec.ts` | fiche annonce complète (bureau) : fil d'Ariane à six niveaux (région, département, ville) et `BreadcrumbList`, galerie (favoris, partage, « Voir les photos » plein écran), repères de catégorie sous le titre, position du prix par rapport au marché, « Publiée aujourd'hui », « Les + de cette annonce », informations clés en grille dépliable, équipements, description « Voir plus », carte zoom 13 avec cercle visible, « Signaler l'annonce » en bas, carrousel « Ces annonces peuvent vous intéresser » ; badge « Déjà vu » (visiteur puis membre) ; « Suivre » le vendeur (alerte dans Mes recherches) |
| `e2e/19-session.spec.ts` | rester connecté (bureau et mobile) : fermeture du navigateur puis retour avec un jeton d'accès expiré → toujours connecté, session renouvelée en silence, ancien jeton toléré 30 s sans casser la session ; « Se déconnecter » efface les deux jetons et le serveur refuse l'ancien ; double authentification demandée à la connexion par mot de passe seulement, pas au retour |
| `e2e/20-telephone-stats.spec.ts` | téléphone au dépôt : un compte sans numéro est bloqué à l'aperçu (champ obligatoire, numéro invalide refusé) puis publie avec un mobile français enregistré sur le compte ; un compte avec numéro ne le retape pas (case « Afficher mon numéro ») ; statistiques par annonce sur Mes annonces (vues, favoris, messages, clics « Voir le numéro »), mises à jour au retour sur l'onglet, jamais publiques ; numéro masqué depuis les paramètres → bouton absent de la fiche | desktop |
| `e2e/21-admin-droits.spec.ts` | console admin : menu regroupé par domaine (Vue d'ensemble, Comptes, Annonces, Transactions, Configuration, Traçabilité) ; suppression définitive d'une annonce (bouton inactif sans motif ni mot SUPPRIMER en majuscules, annonce en 404, entrée `listing.delete` avec le motif dans le journal filtré par cible) ; fiche détaillée d'une transaction avec annulation forcée hors litige (note transmise à l'acheteur, `transaction.cancel` dans le journal lié) puis suppression définitive du vendeur (connexion refusée, profil en 404, `user.delete` au journal) |
| `e2e/22-confirmer-email.spec.ts` | lien de confirmation d'e-mail invalide ou expiré : message clair (« Ce lien n'est plus valable… expiré ou déjà utilisé »), bouton de renvoi sur la page même pour un membre connecté (envoi confirmé), bouton « Se connecter pour recevoir un nouveau lien » pour un anonyme qui ramène sur la page avec le bouton de renvoi |

Les pages d'inscription et de recherche vérifient en plus l'absence de défilement horizontal
(`expectNoHorizontalOverflow`) : c'est la régression trouvée lors du tour de polish. Les données
de départ (admin, vendeur, acheteur, cinq annonces géolocalisées, photos JPEG générées) sont
créées par `e2e/global-setup.ts` à travers l'API ; les suggestions de communes
(adresse.data.gouv.fr) sont simulées dans le navigateur, aucun réseau externe n'est requis.
En CI, le job `e2e-navigateur` tourne à chaque push et pull request et **bloque le déploiement
Render** en cas d'échec ; rapport et traces sont joints en artefact.

## Fonctionnalités

**Public** : accueil, recherche (catégorie/sous-catégorie, prix, état, livraison,
particulier/pro, date, rayon km avec carte, filtres spécifiques par catégorie, tri),
détail d'annonce (galerie, caractéristiques, carte approximative, vendeur, similaires,
partage, signalement), vitrine vendeur/pro, pages légales, sitemap, robots.

**Compte** : dépôt d'annonce par étapes (champs dynamiques par catégorie,
photos réordonnables, brouillon, aperçu), gestion des annonces (pause, vendue,
renouvellement, duplication), favoris, messagerie temps réel (WebSocket, réponses
rapides, blocage, signalement), paiement sécurisé (séquestre, expédition ou remise en
main propre avec code, annulation, litige), avis, alertes de recherche, notifications,
passage en compte pro (SIRET) et vitrine, onboarding Stripe Connect, export RGPD,
suppression de compte.

**Administration** (`/admin`, rôle admin relu en base à chaque requête) : statistiques,
utilisateurs (suspension, rôle, badge identité), annonces (approbation, refus motivé,
correction, retrait, suppression définitive avec motif et saisie du mot SUPPRIMER), signalements
(traitement avec action), transactions (fiche détaillée `/admin/litiges/:id` ; arbitrage d'un litige
et décision forcée sur toute vente ouverte : rembourser, libérer, annuler), comptes (suspension
réversible, annonces remises en ligne à la réactivation ; suppression définitive avec motif + SUPPRIMER,
ventes non expédiées remboursées, refusée tant qu'une vente expédiée ou un litige est en cours, données
personnelles effacées), journal d'audit consultable (filtre par cible). Menu regroupé par domaine.
Suppression **réelle** (AUDIT §41, `src/retention/retention.service.ts`) : une annonce ou un compte supprimé
(par le membre ou par l'admin) disparaît de la base et de toutes les listes ; seules les **ventes payées**
gardent une trace comptable (montant, dates, références, titre de l'annonce) sans données personnelles,
affichée « Compte supprimé » / « Annonce supprimée » ; journal d'audit, signalements, conversations et
avis rédigés sont conservés.
Audit page par page de la console : `docs/audit-admin.md` ; audit final de tout le site (routes, sécurité,
design, organisation, paiement) : `docs/audit-final.md` ; intégration PayPal : `docs/paypal-integration.md`.

## Phase 2 (gratuit par défaut)

- **Monétisation désactivée par défaut** (`system_settings.monetization_enabled = false`) : annonces illimitées, mises en avant gratuites, formules sans effet pour tous les comptes. L'admin l'active depuis « Monétisation et formules ».
- Mise en avant (boost 7 j, urgent 7 j), import de catalogue CSV/XML et gestion multi-utilisateurs (comptes pro), recadrage et glisser-déposer des photos, historique de consultation, photo et proposition de prix dans la messagerie, CMS des pages légales, suggestions de recherche, fournisseur PayPal (simulé).
- Catégories : 12 familles dans l'ordre de référence ; Locations de vacances sans sous-catégorie (champs dynamiques filtrables) ; Services 15 sous-catégories ; Animaux 5.

## Phase 4 (accueil et différenciateurs)

- **Accueil utilitaire** : la recherche (mots-clés + localisation « Toute la France » par défaut + raccourcis) et l'accès direct aux 12 familles occupent le haut de page, sans slogan.
- **« Toute la France »** dans le sélecteur de localisation (accueil et recherche) ; une ville reste requise au dépôt.
- **Dons / Échanges uniquement** : filtre `price_type` (`gratuit`, `echange`, `fixe`, `negociable`, `sur_demande`) mis en avant sur l'accueil et en tête des résultats.
- **Prix moyen constaté** au dépôt : `GET /listings/price-estimate?category=&q=` (médiane et quartiles des annonces en ligne comparables, ≥ 3 annonces).
- **Badge « Fiche complète »** calculé automatiquement (`isComplete` sur les cartes, `completeness` sur le détail) : 3 photos, description ≥ 120 caractères, prix, tous les critères de la catégorie cohérents ; checklist affichée pendant le dépôt (`src/listings/listing-completeness.ts`).

## Phase 5 (inscription par formulaire, sans SMS — temporaire)

- `POST /auth/register` : particulier (nom, prénom, username, e-mail, mobile français, mot de passe + confirmation) ou professionnel (mêmes champs + raison sociale + SIRET, clé de Luhn vérifiée par `isValidSiret`). Doublons e-mail / téléphone / username / SIRET refusés en 409 avec un message explicite.
- `POST /auth/login` : e-mail ou username + mot de passe (hash scrypt, `src/auth/password.ts`). Session identique au parcours OTP (access 15 min + refresh révocable).
- **Aucun SMS à l'inscription** : le compte est créé avec `phoneVerified=false` (relaxation temporaire documentée dans `AUDIT.md` §11). L'ancien parcours OTP (`/auth/register/phone`, `/auth/otp/verify`, page `/connexion/sms`) reste disponible pour les comptes créés par SMS.
- Migration `UserCredentials` : colonnes nullable `firstName`, `lastName`, `username` (unique), `passwordHash` (jamais sélectionné par défaut), `companyName` ; les comptes existants ne sont pas modifiés.

## Phase 6 (mot de passe oublié, œil, localisation leboncoin, filtres)

- **Mot de passe oublié** : `POST /auth/password/forgot` (toujours 200) → e-mail avec lien à usage unique (1 h) → `POST /auth/password/reset` (sessions révoquées). Fournisseur d'e-mail interchangeable (`IEmailProvider`, `src/email/email.service.ts`) : `mock` en dev (lien via `/dev/last-reset-link/:email`), `none` en prod sans clé (503 explicite), `resend` / `brevo` attendent `RESEND_API_KEY` ou `BREVO_API_KEY` + `EMAIL_FROM` (appel HTTP non implémenté sans clé). Back-office : bouton « Réinitialiser le mot de passe » (mot de passe temporaire affiché une fois, journalisé).
- **Afficher / masquer** le mot de passe (`PasswordInput`) sur inscription, connexion et réinitialisation.
- **Localisation** calquée sur leboncoin (`LocationPicker`) : un champ « Ajouter une localisation », suggestions « Autour de moi » puis « Toute la France », communes via adresse.data.gouv.fr, rayon 0 / 1 / 5 / 10 / 20 / 30 / 50 / 100 / 200 km (5 km par défaut, 0 km = la commune seule).
- **Filtres par catégorie** alignés sur le relevé leboncoin (`analyse-concurrentielle.md` §10) : type de véhicule, puissance DIN, couleurs en liste, type de vente, exposition, état du bien, fonction, niveau d'études, produit (téléphonie), taille d'écran, pièce (ameublement).

## Phase 7 (bandeau, dépôt, images, mot de passe)

- **Bandeau** : la recherche domine (une ligne ≥ 1100 px avec libellés de navigation masqués sous 1400 px ; deuxième ligne pleine largeur en dessous), placeholder court « Rechercher sur Trocoin ».
- **Dépôt** : exemple de titre par catégorie (`title-examples.ts`), description auto-extensible (`AutoTextarea`), champs ajoutés d'après les annonces leboncoin (sellerie, salles d'eau, couleur puériculture).
- **Images** : toute photo/avatar/logo est ré-encodée par `sharp` (orientation appliquée, EXIF/GPS/ICC supprimés, ≤ 1600 px, format d'origine) ; un fichier corrompu est rejeté. L'image envoyée n'est jamais servie telle quelle.
- **Paiement sécurisé retirable par le vendeur** (AUDIT.md §46) : case « Proposer le paiement sécurisé sur mes annonces » dans Paramètres (`securePaymentDisabled` sur `PATCH /users/me`) ; décoché, le devis répond `eligible: false` avec le motif « ce vendeur ne propose pas le paiement sécurisé : réglez en main propre » et `POST /transactions` refuse (400) ; le numéro suit sa propre préférence.
- **Comptes de démonstration** (AUDIT.md §46, admin seulement) : indicateur interne `isDemoAccount` réglé depuis la fiche admin d'un membre (case « Compte de démonstration », pastille « Démo » dans la liste et la fiche, action tracée au journal) ; jamais renvoyé par les routes publiques ; sur ses annonces le numéro n'est jamais révélé (`phoneAvailable: false`, `POST /listings/:id/phone` → 404) et aucun paiement en ligne n'est possible, la messagerie reste normale. Contenu de lancement en production : 10 comptes vendeurs, 60 annonces (5 par famille), photos CC0 / domaine public (Openverse, Wikimedia Commons) avec source et licence consignées hors dépôt (`private/`, ignoré par git).
- **En-tête sur une seule rangée** (AUDIT.md §47) : logo, bouton « Catégories », recherche compacte (≤ 520 px), puis Mes recherches, Favoris, Messages, compte et « Déposer une annonce » sur la même ligne (60 px) ; sur mobile, monogramme + recherche + Messages + menu (56 px). Plus de rangée de familles sous l'en-tête ni de bandeau de réassurance : sur l'accueil, la grille d'icônes des catégories est posée directement sous l'en-tête. Au survol d'une tuile sur bureau, panneau des sous-catégories en colonnes de 8 posé sous la tuile (AUDIT.md §48) ; Catégories, recherche, compte et « Déposer une annonce » font 40 px de haut. Le panneau a des coins arrondis et un fond `--accent-tint` qui s'estompe vers le blanc (AUDIT.md §49). Dans les modules CSS, une classe globale (`.btn`, `.field`, `.eyebrow`) se cible avec `:global(...)` : sans cela le nom est haché et la règle ne s'applique jamais (débordement corrigé dans « Tous les filtres »).
- **Barème du paiement sécurisé réglable** (AUDIT.md §51, `docs/mecanisme-paiement-explique.md`) : commission vendeur, pourcentage, fixe et plafond des frais de protection acheteur dans `system_settings` (`commission_percent`, `buyer_fee_percent`, `buyer_fee_fixed_eur`, `buyer_fee_cap_eur`, défaut 8 % et 5 % + 0,50 € plafonnés à 15 €), modifiables depuis Admin → Monétisation et formules (valeur en vigueur affichée, confirmation, `settings.update` au journal avec ancienne et nouvelle valeur). Chaque transaction fige ses montants et son barème (`feeRates`) à sa création : jamais de recalcul rétroactif ; `POST /transactions` accepte `expectedTotal` et répond 409 `QUOTE_CHANGED` avec le nouveau devis si le total affiché n'est plus le bon. La fenêtre de paiement et la page Stripe détaillent prix de l'article et frais de protection sur deux lignes (côté acheteur, ni la formule des frais ni le net du vendeur ne sont affichés, AUDIT.md §53) ; `/settings/public` expose `fees` (aide et page Versements sans chiffre en dur).
- **Annonces sans expiration et verrous anti-fraude** (AUDIT.md §54, `docs/audit-admin.md`) : plus de durée de vie (tâche `expireListings` retirée, `expiresAt` non renseigné) ; après publication, le vendeur ne peut plus changer la catégorie, la marque ni retirer, remplacer ou déplacer les photos de publication (`listing_photos.lockedAt`, 400 explicites, champs grisés dans le formulaire) ; ajouter des photos reste permis, à la suite. L'admin garde tous ses pouvoirs et peut retirer une photo verrouillée (`DELETE /admin/listings/:id/photos/:photoId`, motif, journal). Sur mobile, un tap sur une famille de la grille d'accueil déplie ses sous-catégories.
- **Mot de passe** : `POST /auth/password/change` (ancien mot de passe requis, autres sessions révoquées), section « Mot de passe » dans Paramètres.
- **Changement d'adresse e-mail** (AUDIT.md §19) : `POST /auth/email/change` (mot de passe exigé) → lien 24 h envoyé à la nouvelle adresse, avertissement à l'ancienne ; effectif au clic (`POST /auth/email/verify` renvoie `changed: true`).
- **Double authentification** (AUDIT.md §19, facultative) : TOTP RFC 6238 sans dépendance (`src/auth/totp.ts`), QR code (`qrcode`). `POST /auth/2fa/setup` → secret + QR, `POST /auth/2fa/enable { code }` → 8 codes de récupération (affichés une fois, hash en base), `POST /auth/2fa/disable { password, code }`. Connexion : `POST /auth/login` renvoie `{ twoFactorRequired, challengeToken }` (JWT 5 min, refusé comme session), puis `POST /auth/login/2fa { challengeToken, code }` ; un code TOTP ne sert qu'une fois (`totpLastStep`), un code de récupération non plus.
- **Véhicules** : marque et modèle en listes dépendantes (`src/categories/vehicle-models.ts`, fichier statique : 57 marques de voitures, 31 de motos, 17 d'utilitaires, « Autre » partout) ; `FieldSchema.dependsOn` / `optionsByParent`, validés côté serveur. **Localisation** : 5 dernières communes (« Récents », localStorage + `recentLocations` sur le compte) ; arrondissements de Paris, Lyon, Marseille regroupés sous « toute la ville » (`frontend/src/lib/geo.ts`).
- **Confirmation de l'adresse e-mail** (AUDIT.md §18) : à l'inscription, e-mail avec lien à usage unique (24 h) vers `/confirmer-email?token=…` → `POST /auth/email/verify` → `emailVerified` sur `/users/me`. Renvoi depuis Paramètres : `POST /auth/email/resend` (60 s entre deux envois, 3/h/IP). Compte non confirmé : usage normal + rappel dans l'espace compte. En dev : lien via `/dev/last-verification-link/:email`.

## Phase 8 (barre d'accueil épurée, panneau de rayon, plein texte, plafond photos)

- **Accueil** : deux champs sans libellé au-dessus, textes-guides « QUOI ? » et « OÙ ? », bouton Rechercher.
- **Panneau de localisation** : après le choix d'une commune ou d'« Autour de moi », le panneau reste ouvert et propose le rayon (0 / 1 / 5 / 10 / 20 / 30 / 50 / 100 / 200 km, 5 km par défaut, curseur + paliers cliquables, Effacer / Valider), comme sur leboncoin.
- **Recherche plein texte** sur PostgreSQL (migration `ListingsFullText`, index GIN, accents retirés, stemming français, préfixe par mot) ; repli `LIKE` sur SQLite.
- **Plafond de photos** par compte et par 24 h (`MAX_PHOTOS_PER_DAY`, défaut 150).

## Phase 9 (infrastructure : stockage objet, SIRET au registre, Redis, deploy hook)

- **Stockage des photos** interchangeable (`IStorageProvider`, `src/common/upload/storage.service.ts`) : `local` (défaut, disque éphémère sur Render) ou `s3` (S3 / Cloudflare R2 : `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`), testé contre un faux S3 en mémoire.
- **SIRET vérifié au registre public** (`recherche-entreprises.api.gouv.fr`, sans clé) à l'inscription pro et au passage pro : inconnu/fermé refusé, registre en panne → « non vérifié » visible dans l'admin (`SIRENE_PROVIDER=api|mock|none`).
- **Rate limiting partagé** via `REDIS_URL` (`RedisThrottlerStorage`, script Lua atomique), sinon mémoire.
- **CI → Render** : job `deploy-render` déclenché par le secret `RENDER_DEPLOY_HOOK` après une CI verte, avec preuve par `/health` (`DEPLOIEMENT.md` §2b).
- Documents : `AUDIT.md` (état consolidé), `AUDIT-HISTORIQUE.md` (journal des phases).
- **Back-office, SEO, ménage, charge** (14 septembre, soir) : console d'administration conforme WCAG AA (axe 0 violation, clavier), sitemap dynamique complet, métadonnées uniques par page et par catégorie, JSON-LD Product + BreadcrumbList + WebSite, index composites de recherche, Dependabot, test de charge `scripts/charge.js` (résultats dans `AUDIT.md` §12).
- **Accessibilité et performance** (14 septembre, soir) : lien d'évitement, menus et modales au clavier, noms accessibles, hiérarchie de titres, zones live (résultats, messagerie, notifications), vignettes 480 px pour les listes (`thumbUrl`), carte de l'annonce chargée à l'approche, décalages de mise en page supprimés sur la recherche ; scores Lighthouse dans `AUDIT.md` §11.
- **Polish page par page** (14 septembre, après-midi) : centre d'aide structuré (`/aide`, 6 rubriques, 22 articles, recherche), partage d'annonce et de boutique (lien, WhatsApp, e-mail, Facebook, X, partage natif), « autres annonces de ce vendeur » et reprise des dernières consultations sur l'accueil, préférences de notification par famille et canal (`notificationPrefs`), boîte de confirmation unique à la place des `confirm()` natifs, navigation compte et console admin adaptées au mobile, textes légaux par défaut resynchronisés.
- **Auto-deploy prouvé** (14 septembre) : secret `RENDER_DEPLOY_HOOK` en place, la CI déclenche Render et vérifie `/health`.
- Sauvegarde hebdomadaire chiffrée (`.github/workflows/backup.yml`, secrets `DATABASE_URL_BACKUP` + `BACKUP_PASSPHRASE`) ; suppression de compte revue pour les comptes à mot de passe ; « Paris / Lyon / Marseille (toute la ville) » dans la localisation.

## Configuration

Voir `.env.example`. En production, le démarrage est **refusé** si : `JWT_SECRET`
absent/faible, `CORS_ORIGINS` absent, `DB_TYPE≠postgres`, un fournisseur (`SMS`,
`PAYMENT`, `NOTIFICATION`) laissé en `mock`, ou les clés du fournisseur SMS absentes.
Modes autorisés en production sans prestataire : `PAYMENT_PROVIDER=disabled` (503 explicite)
et `NOTIFICATION_PROVIDER=none` (in-app uniquement).

### Séquestre sur le solde de la plateforme (AUDIT §39)

Modèle Stripe « paiements et transferts distincts » (carte, et **PayPal via Stripe** dès son activation dans
le Dashboard : même session Checkout, même séquestre, aucun identifiant PayPal — `docs/paypal-integration.md`
§7) : l'autorisation de l'acheteur est **encaissée sur
le solde de Trocoin** au plus tard 24 h après le paiement (`ESCROW_CAPTURE_AFTER_HOURS`), plus tôt dès
que le vendeur expédie, se déclare prêt pour la remise, ou qu'un litige s'ouvre — pendant ce court
délai une annulation libère simplement l'autorisation (aucun débit, aucun frais). Le solde de la
plateforme n'expire pas : le vendeur n'est payé que par un **virement séparé** (Stripe Transfer
rattaché à la charge d'origine) à la confirmation — réception confirmée, code de remise saisi,
décision admin « libérer », ou réception présumée 7 jours après l'expédition (rappels à l'acheteur
48 h et 24 h avant, litige encore possible 7 jours après). Sans expédition ni remise sous 7 jours
(`ESCROW_SHIP_DEADLINE_DAYS`, rappels 48 h et 24 h avant) : annulation et remboursement. Un
remboursement avant virement part du solde de Trocoin ; après virement, le virement est d'abord
annulé (compte du vendeur débité) puis l'acheteur remboursé. Un vendeur sans compte de versement est
payé par la tâche périodique dès qu'il l'a créé. Tâche `runEscrowSchedule` toutes les 15 minutes ;
filet admin « Séquestres à échéance (48 h) » (`GET /admin/transactions?due=1`). Les ventes créées
avant la bascule (`escrowModel = destination`) se terminent avec l'ancienne logique (AUDIT §37 :
capture à la confirmation, action par défaut avant l'expiration de l'autorisation). Variables
`ESCROW_*` dans `.env.example`.

### Sessions

Jeton d'accès JWT court (`JWT_EXPIRES_IN`, 15 min) + **refresh token** opaque stocké haché
en base (`refresh_tokens`), tourné à chaque `POST /auth/refresh`, révoqué à la déconnexion
(`POST /auth/logout`), à la suspension par un admin et à la suppression du compte. La
réutilisation d'un refresh token déjà consommé révoque toute la famille de sessions, sauf dans
les 30 s qui suivent sa rotation (`REFRESH_REUSE_GRACE_MS` : deux onglets ou une requête rejouée
ne sont pas un vol ; le second appel est simplement refusé).
`GET /auth/sessions` liste les sessions actives, `DELETE /auth/sessions` les ferme toutes.

**Téléphone et annonces** (AUDIT §35) : le numéro de mobile français est **celui du compte**
(unique, `users.phoneNumber`), réutilisé pour toutes les annonces ; il n'est pas stocké par annonce.
Publier exige un numéro valide (un compte qui n'en a pas le saisit à l'aperçu du dépôt, `PATCH
/users/me { phoneNumber }`, accepté seulement si le compte n'en a pas encore) ; les brouillons restent
possibles sans. `users.phonePublic` (vrai par défaut, réglable au dépôt et dans les paramètres)
propose le bouton « Voir le numéro » sur les annonces en ligne : le numéro n'est jamais dans le HTML
ni sur les cartes, il est délivré par `POST /listings/:id/phone` à un membre connecté et chaque clic
incrémente `listings.phoneClicksCount`. `GET /listings/mine` renvoie par annonce `stats`
(vues, favoris, conversations, clics), visibles du propriétaire seul.

**Rester connecté** (depuis le 16 septembre 2026, AUDIT §34) : la session vit dans le stockage
local du navigateur (`trocoin_token`, `trocoin_refresh`), donc elle survit à la fermeture du
navigateur ou de l'application. Au retour, le front renouvelle d'abord le jeton d'accès s'il a
expiré (`ensureFreshToken` dans `frontend/src/lib/api.ts`, appelé au chargement du compte et avant
tout appel dont le jeton expire dans la minute), puis charge le compte ; la session locale n'est
effacée que sur un refus définitif du serveur (jeton révoqué ou plus de `REFRESH_TOKEN_TTL_DAYS`
jours sans visite), jamais sur une panne réseau. Les onglets se synchronisent (verrou Web Locks
pour la rotation, évènement `storage` pour la déconnexion). Seul « Se déconnecter » efface les
deux jetons et révoque la famille côté serveur. La double authentification n'est demandée qu'à la
connexion par mot de passe.

### Production

`Dockerfile` multi-étapes (image finale sans dépendances de dev, utilisateur non-root,
`HEALTHCHECK` sur `GET /health`). CI GitHub Actions (`.github/workflows/ci.yml`) : tsc,
tests e2e SQLite + PostgreSQL 16, build, `npm audit`, `next build`, image Docker.
Monitoring Sentry activé par `SENTRY_DSN`. Guide complet : `DEPLOIEMENT.md`.

### Base de données et migrations

Dev : SQLite + `synchronize`. Production : PostgreSQL, `synchronize` désactivé,
migrations exécutées au démarrage. Générer la première migration **contre la base
cible** :

```bash
# Migration initiale déjà générée et exécutée contre PostgreSQL (src/migrations/*-InitialPostgres.ts).
# Pour une évolution du schéma :
DB_TYPE=postgres DATABASE_URL=postgresql://... DB_SYNCHRONIZE=false npm run migration:generate
npm run migration:run
```

### Fournisseurs à brancher

| Service | Interface | Fichier |
|---|---|---|
| SMS — Vonage **implémenté** ; Twilio non implémenté | `ISmsProvider` | `src/sms/vonage-sms.provider.ts`, `src/sms/sms.service.ts` |
| Paiement (Stripe Connect, implémenté, non testé en réel) | `IPaymentProvider` | `src/payments/stripe-payment.provider.ts` |
| Onboarding vendeur Stripe | — | `src/users/stripe-connect.service.ts` |
| Push / SMS de notification (FCM) | `INotificationProvider` | `src/notifications/notifications.service.ts` |

## Principales routes API

```
GET /listings/facets · GET /listings/discover · DELETE /conversations/:id · POST /conversations/bulk-delete · POST /auth/register · POST /auth/email/verify · POST /auth/email/resend · POST /auth/email/change · POST /auth/login · POST /auth/login/2fa · POST /auth/2fa/setup · POST /auth/2fa/enable · POST /auth/2fa/disable · POST /auth/password/forgot · POST /auth/password/reset · POST /auth/register/phone · POST /auth/otp/verify · POST /auth/refresh · POST /auth/logout · /auth/sessions
GET  /health
GET  /users/me · PATCH /users/me · POST /users/me/become-pro · GET /users/:id/profile
GET  /users/me/export · DELETE /users/me · /users/me/blocks · /users/me/saved-searches
GET  /categories/tree · GET /categories/:slug/schema · GET /categories/suggest?q= · GET /listings/suggest?q=
GET  /settings/public · GET /plans · /users/me/entitlements · /users/me/subscription/:planId
/users/me/shop/members · /users/me/shops · POST /listings/import · POST /listings/:id/promote
/listings/history · GET /listings/history/ids · /conversations/:id/images · /conversations/:id/offers · GET /pages/:slug
/admin/settings · /admin/plans · /admin/pages
POST /listings/:id/phone (« Voir le numéro », connecté, compté pour le vendeur) · GET /listings/mine (avec `stats` par annonce)
GET  /listings (filtres, dont `region=` et `postal_code=` préfixe) · POST /listings · GET/PATCH/DELETE /listings/:id · POST /listings/bulk
POST /listings/:id/photos · PATCH /listings/:id/photos/order · /listings/:id/similar
/listings/:id/favorite · /conversations · /transactions (quote, ship, handover, dispute…)
/transactions/:id/shipment (quote, relay-points, étiquette PDF, tracking — SHIPPING_PROVIDER=mock|none|boxtal, docs/etiquettes-transporteur.md) · GET /shipping/diagnostic (sandbox Boxtal seulement)
/transactions/:id/review · /reports · /notifications
/admin/stats · /admin/users (DELETE /admin/users/:id : motif + confirm=SUPPRIMER) · /admin/listings (DELETE /admin/listings/:id : idem) · /admin/reports · /admin/transactions (GET :id, POST :id/resolve : rembourser | liberer | annuler) · /admin/audit-log
WebSocket : join / leave / message (JWT dans handshake.auth.token)
```
