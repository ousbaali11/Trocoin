# Trocoin — plateforme de petites annonces (France)

Monorepo : **API NestJS 12 + TypeORM** (racine) et **front Next.js 16** (`frontend/`).
Règle non négociable : un compte = un numéro de **mobile français (+33 6/7)** vérifié
par SMS. Tout autre indicatif est refusé à l'inscription.

Documents : `cahier-des-charges.md`, `architecture-technique.md`,
`analyse-concurrentielle.md` (étude leboncoin + écarts), `AUDIT.md` (sécurité,
complétude, ce qui n'a pas pu être testé, recommandations avant lancement),
`DEPLOIEMENT.md` (mise en ligne pas à pas : Neon + Render + Vercel, sauvegardes, SMS).

**Production** : API `https://trocoin.onrender.com` (Render, Docker, PostgreSQL Neon, SMS Vonage) ;
front Next.js sur Vercel (URL à confirmer, `https://trocoin.vercel.app` répondait `NOT_FOUND` le
13 septembre 2026). Procédure : `DEPLOIEMENT.md`.

## Démarrage rapide (développement)

```bash
# API (port 3000) — SQLite locale, SMS / paiement / notifications simulés
npm install
cp .env.example .env
npm run dev

# Front (port 3001)
cd frontend && npm install && cp .env.example .env.local && npm run dev -- -p 3001
```

- Site public : http://localhost:3001 — le code OTP s'affiche dans la page de
  connexion (raccourci actif uniquement avec `SMS_PROVIDER=mock` hors production).
- Données de démonstration : `node test/seed-demo.js` (3 comptes, 12 annonces avec photos,
  1 annonce bloquée par la pré-modération, 1 signalement, 1 conversation).
- Premier administrateur : `npm run create-admin -- 0611223344 "Admin"` puis
  connexion normale par OTP → menu « Console d'administration » → `/admin`.
- Page de test interne historique : `public/index.html` (servie uniquement hors production).

## Tests

```bash
npm test                 # 74 tests e2e (Jest + supertest, SQLite en mémoire)
# Les mêmes tests sur PostgreSQL (schéma créé par les migrations) :
E2E_DB=postgres DB_TYPE=postgres DATABASE_URL=postgresql://... DB_SYNCHRONIZE=false npm test
node test/ws-smoke.js    # messagerie temps réel contre un serveur lancé
cd frontend && npx tsc --noEmit && npx next build
```

## Fonctionnalités

**Public** : accueil, recherche (catégorie/sous-catégorie, prix, état, livraison,
particulier/pro, date, rayon km avec carte, filtres spécifiques par catégorie, tri),
détail d'annonce (galerie, caractéristiques, carte approximative, vendeur, similaires,
partage, signalement), vitrine vendeur/pro, pages légales, sitemap, robots.

**Compte** (OTP) : dépôt d'annonce par étapes (champs dynamiques par catégorie,
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
