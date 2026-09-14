# Trocoin — plateforme de petites annonces (France)

Monorepo : **API NestJS 12 + TypeORM** (racine) et **front Next.js 16** (`frontend/`).
Règle non négociable : un compte = un numéro de **mobile français (+33 6/7)**. Tout autre
indicatif est refusé à l'inscription. La vérification de ce numéro par SMS est **différée par
choix** pendant la bêta (voir `AUDIT.md` §6) : le code Vonage reste en place, désactivé.

Documents : `cahier-des-charges.md`, `architecture-technique.md`,
`analyse-concurrentielle.md` (étude leboncoin + écarts), `AUDIT.md` (sécurité,
complétude, ce qui n'a pas pu être testé, recommandations avant lancement),
`DEPLOIEMENT.md` (mise en ligne pas à pas : Neon + Render + Vercel, sauvegardes, SMS).

**Production** : API `https://trocoin.onrender.com` (Render, Docker, PostgreSQL Neon) et front
`https://trocoin.vercel.app` (Vercel). Déploiement automatique à chaque push sur `main` après une
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

- Site public : http://localhost:3001 — inscription par formulaire (aucun SMS) ; pour l'ancien
  parcours par code SMS, le code s'affiche dans la page (`SMS_PROVIDER=mock` hors production).
- Données de démonstration : `node test/seed-demo.js` (3 comptes, 12 annonces avec photos,
  1 annonce bloquée par la pré-modération, 1 signalement, 1 conversation).
- Premier administrateur : `npm run create-admin -- 0611223344 "Admin"` (crée ou promeut le
  compte portant ce numéro) puis connexion → menu « Console d'administration » → `/admin`.

## Tests

```bash
npm test                 # 97 tests e2e (API, supertest)
npm run e2e:build        # construit l'API (dist/) et le front (next build) pour les tests navigateur
npm run e2e              # 47 scénarios Playwright dans Chromium (desktop 1280 px + mobile 375 px) : parcours, accessibilité (axe) site + back-office, clavier, SEO
node scripts/charge.js --api https://trocoin.onrender.com --front https://trocoin.vercel.app --vus 10 --minutes 3   # test de charge léger (lectures publiques) (Jest + supertest, SQLite en mémoire)
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
npm run e2e                       # 47 scénarios (≈ 3 min 30)
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
correction, retrait), signalements (traitement avec action), litiges (remboursement /
libération), journal d'audit.

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
- **Mot de passe** : `POST /auth/password/change` (ancien mot de passe requis, autres sessions révoquées), section « Mot de passe » dans Paramètres.

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

### Sessions

Jeton d'accès JWT court (`JWT_EXPIRES_IN`, 15 min) + **refresh token** opaque stocké haché
en base (`refresh_tokens`), tourné à chaque `POST /auth/refresh`, révoqué à la déconnexion
(`POST /auth/logout`), à la suspension par un admin et à la suppression du compte. La
réutilisation d'un refresh token déjà consommé révoque toute la famille de sessions.
`GET /auth/sessions` liste les sessions actives, `DELETE /auth/sessions` les ferme toutes.

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
POST /auth/register · POST /auth/login · POST /auth/password/forgot · POST /auth/password/reset · POST /auth/register/phone · POST /auth/otp/verify · POST /auth/refresh · POST /auth/logout · /auth/sessions
GET  /health
GET  /users/me · PATCH /users/me · POST /users/me/become-pro · GET /users/:id/profile
GET  /users/me/export · DELETE /users/me · /users/me/blocks · /users/me/saved-searches
GET  /categories/tree · GET /categories/:slug/schema · GET /listings/suggest?q=
GET  /settings/public · GET /plans · /users/me/entitlements · /users/me/subscription/:planId
/users/me/shop/members · /users/me/shops · POST /listings/import · POST /listings/:id/promote
/listings/history · /conversations/:id/images · /conversations/:id/offers · GET /pages/:slug
/admin/settings · /admin/plans · /admin/pages
GET  /listings (filtres) · POST /listings · GET/PATCH/DELETE /listings/:id
POST /listings/:id/photos · PATCH /listings/:id/photos/order · /listings/:id/similar
/listings/:id/favorite · /conversations · /transactions (quote, ship, handover, dispute…)
/transactions/:id/review · /reports · /notifications
/admin/stats · /admin/users · /admin/listings · /admin/reports · /admin/transactions · /admin/audit-log
WebSocket : join / leave / message (JWT dans handshake.auth.token)
```
