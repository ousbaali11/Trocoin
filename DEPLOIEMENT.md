# Déploiement de Trocoin — guide pas à pas (15–20 min)

Combinaison la plus simple, gratuite pour des testeurs, sans serveur à administrer :

| Brique | Hébergeur recommandé | Pourquoi |
|---|---|---|
| Base PostgreSQL | **Neon** (neon.tech, offre gratuite) | Postgres 16 managé, sauvegardes automatiques + restauration à un instant donné (PITR), URL `sslmode=require` directement utilisable |
| API NestJS | **Render** (render.com, Web Service Docker, offre gratuite) | Construit l'image depuis le `Dockerfile` du dépôt, HTTPS automatique, variables d'environnement chiffrées, health check |
| Front Next.js | **Vercel** (vercel.com, offre Hobby) | Éditeur de Next.js, build à chaque push, HTTPS et CDN inclus |

Alternatives équivalentes : Railway (API + Postgres au même endroit, `DATABASE_URL` injectée
automatiquement) ou Fly.io. Les étapes ci-dessous restent les mêmes, seule l'interface change.

> Aucune CLI d'hébergeur (`railway`, `render`, `vercel`, `docker`, `psql`) n'est installée sur
> le poste de développement : tout se fait depuis les interfaces web. Seul `gh` (GitHub) est
> authentifié.

## 0. Prérequis (à créer par vous, 5 min)

1. Un compte **Neon**, un compte **Render**, un compte **Vercel** — les trois acceptent la
   connexion « Continue with GitHub » avec le compte qui possède `ousbaali11/Trocoin`.
2. Un nom de domaine (facultatif pour tester : Render et Vercel fournissent des sous-domaines
   `*.onrender.com` / `*.vercel.app`).
3. Un compte **SMS** (Vonage ou Twilio) — voir §5 : sans lui, aucune inscription n'est
   possible en production (le mode `mock` est refusé au démarrage).

## 1. Base de données PostgreSQL (Neon, 3 min)

1. neon.tech → *New project* → nom `trocoin`, région **Frankfurt (eu-central-1)** (données en UE).
2. *Connection details* → cocher *Pooled connection* → copier l'URL, de la forme
   `postgresql://neondb_owner:XXXX@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
3. Rien d'autre : le schéma est créé par les migrations au premier démarrage de l'API
   (`src/migrations/*-InitialPostgres.ts`, 23 tables). Ne jamais activer `synchronize`.

## 2. API (Render, 5 min)

1. render.com → *New* → *Web Service* → *Build and deploy from a Git repository* → choisir
   `ousbaali11/Trocoin`, branche `main`.
2. Réglages : *Runtime* **Docker** (le `Dockerfile` à la racine est détecté), région
   **Frankfurt**, *Instance type* Free (ou Starter pour éviter la mise en veille).
3. *Health Check Path* : `/health`.
4. *Environment variables* (pas de guillemets autour des valeurs) :

   | Variable | Valeur |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PORT` | `3000` |
   | `TRUST_PROXY` | `true` |
   | `DB_TYPE` | `postgres` |
   | `DATABASE_URL` | l'URL Neon copiée à l'étape 1 |
   | `DB_POOL_MAX` | `5` |
   | `JWT_SECRET` | résultat de `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` — **généré pour la prod, différent du dev, jamais commité** |
   | `JWT_EXPIRES_IN` | `15m` |
   | `REFRESH_TOKEN_TTL_DAYS` | `30` |
   | `CORS_ORIGINS` | `https://<votre-projet>.vercel.app` (puis vos vrais domaines, séparés par des virgules) |
   | `SMS_PROVIDER` | `vonage` ou `twilio` + les clés correspondantes (§5) |
   | `PAYMENT_PROVIDER` | `disabled` (paiement sécurisé indisponible, endpoints en 503) tant que Stripe n'est pas configuré |
   | `NOTIFICATION_PROVIDER` | `none` (notifications in-app seulement) |
   | `SENTRY_DSN` | facultatif (§7) |
   | `APP_VERSION` | facultatif, ex. `1.0.0` (affiché par `/health`) |

5. *Create Web Service*. Le premier build prend ~4 min. Dans les logs vous devez voir :
   `Migration InitialPostgres… has been executed successfully`, puis
   `API Trocoin démarrée … (env=production)` et `CORS autorisé pour : https://…`.
   Si la configuration est incomplète, l'API **refuse de démarrer** et le log indique
   précisément la variable fautive (`Configuration invalide : …`).
6. Notez l'URL : `https://trocoin-api.onrender.com` (à adapter). Vérifiez
   `https://trocoin-api.onrender.com/health` → `{"status":"ok","database":"postgres",…}`.

### Fichiers envoyés (photos)

Les photos sont écrites dans `/app/uploads`. Sur l'offre gratuite de Render le disque est
**éphémère** : les photos disparaissent à chaque redéploiement. Pour les testeurs c'est
acceptable ; avant l'ouverture publique, ajouter un *Persistent Disk* Render monté sur
`/app/uploads` (payant) ou basculer sur un stockage objet (S3/R2 — non implémenté).

## 3. Front (Vercel, 4 min)

1. vercel.com → *Add New… → Project* → importer `ousbaali11/Trocoin`.
2. *Root Directory* : `frontend` (important). Framework détecté : Next.js.
3. *Environment Variables* :
   - `NEXT_PUBLIC_API_URL` = `https://trocoin-api.onrender.com` (l'URL Render, sans slash final)
   - `NEXT_PUBLIC_SITE_URL` = `https://<votre-projet>.vercel.app`
4. *Deploy*. Ces variables sont figées dans le bundle au build : après tout changement,
   *Redeploy*.
5. Revenir sur Render et mettre à jour `CORS_ORIGINS` avec l'URL Vercel définitive
   (l'API redémarre automatiquement).

## 4. Vérification externe après déploiement (3 min)

Depuis un téléphone **hors du réseau du développeur** :

1. `https://trocoin-api.onrender.com/health` → `status: ok`.
2. `https://trocoin-api.onrender.com/dev/last-otp/0612345678` → **404** (endpoint de dev neutralisé).
3. Ouvrir le site Vercel → *Se connecter* → saisir un mobile français → **le SMS arrive** →
   code accepté → *Déposer une annonce* → l'annonce apparaît dans la recherche.
4. Se déconnecter puis revenir en arrière : l'espace compte doit refuser l'accès
   (le refresh token est révoqué en base, l'access token expire sous 15 min).
5. Créer l'administrateur : dans Render → *Shell* :
   `node dist/admin/create-admin.js 06XXXXXXXX "Admin"`, puis connexion normale par OTP →
   « Console d'administration ».

## 5. SMS (obligatoire avant tout test réel)

**Vonage est implémenté** (`src/sms/vonage-sms.provider.ts`, API `POST https://rest.nexmo.com/sms/json`).
Variables, **noms exacts** : `SMS_PROVIDER=vonage`, `VONAGE_API_KEY`, `VONAGE_API_SECRET`,
`SMS_SENDER` (expéditeur alphanumérique ≤ 11 caractères, ex. `Trocoin`). Le démarrage refuse
une configuration incomplète.

Comportement : délai d'attente 8 s (10 s au niveau du service), chaque statut d'erreur Vonage
est traduit en message explicite dans les logs (identifiants invalides, crédit insuffisant,
numéro bloqué, expéditeur refusé, **numéro non autorisé sur compte d'essai — statut 29**),
l'utilisateur reçoit un 503 et aucun code OTP fantôme n'est laissé en base. Tests unitaires
`src/sms/vonage-sms.provider.spec.ts` (10 cas, fetch simulé).

Points d'attention Vonage :
- **Compte d'essai** : seuls les numéros ajoutés dans *Dashboard → Getting started → Test numbers*
  reçoivent les SMS (statut 29 sinon). Créditer le compte lève la restriction.
- Vérifier le solde sans envoyer : `GET https://rest.nexmo.com/account/get-balance?api_key=…&api_secret=…`.
- Coût indicatif d'un SMS vers un mobile français : ~0,07 €.

Twilio (`SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`) reste
**non implémenté** faute d'identifiants pour le tester ; le démarrage l'accepte mais chaque envoi
répond 503 explicitement.

## 6. Sauvegardes et restauration

**Neon** conserve automatiquement l'historique (PITR) : 6 h sur l'offre gratuite, 7 à 30 jours
sur les offres payantes. Restauration : *Branches → Restore* → choisir la date/heure →
Neon crée une branche à cet instant ; pointer `DATABASE_URL` dessus (ou la promouvoir).

**Sauvegarde manuelle hebdomadaire** (depuis n'importe quel poste avec `pg_dump` 16, par
exemple via Docker `postgres:16-alpine`) :

```bash
pg_dump "$DATABASE_URL" --format=custom --no-owner --file=trocoin-$(date +%F).dump
```

**Restauration** dans une base vide :

```bash
pg_restore --dbname="$DATABASE_URL_CIBLE" --no-owner --clean --if-exists trocoin-2026-09-13.dump
```

Puis redémarrer l'API (les migrations déjà présentes dans la table `migrations` ne sont pas
rejouées). La migration initiale recrée les 23 tables à partir de zéro ; un dump/restore ne
dépend d'aucune extension autre que `pgcrypto` (fournie par Neon).

**Photos** (`/app/uploads`) : non couvertes par la sauvegarde base — voir §2.

## 7. Monitoring (Sentry, facultatif)

sentry.io → *Create project* → plateforme *Node.js* → copier le DSN → variable `SENTRY_DSN`
sur Render. Sans DSN, le log affiche `Monitoring Sentry : désactivé`. Seules les erreurs 500
sont remontées ; corps de requête et données personnelles sont supprimés avant envoi
(`src/monitoring/sentry.ts`).

## 8. Limite connue : rate limiting et cache en mémoire (Redis)

Le rate limiting (`THROTTLE_LIMIT` requêtes/min/IP, anti-brute-force OTP) et le cache des
suggestions sont stockés **en mémoire de l'instance**. Conséquences :

- avec **une seule instance** (offre gratuite/Starter de Render) : comportement correct ;
- avec plusieurs instances ou un redémarrage : les compteurs sont locaux/réinitialisés
  (un attaquant obtiendrait N × la limite avec N instances).

Aucun Redis n'était disponible ; pour passer à plusieurs instances, ajouter Upstash ou
Render Key Value, puis brancher `@nestjs/throttler` sur un stockage Redis
(`nestjs-throttler-storage-redis`, `REDIS_URL`). Le cooldown OTP, lui, est déjà en base
(table `phone_verifications`) et n'a pas ce problème.

## 9. Intégration continue

`.github/workflows/ci.yml` s'exécute à chaque push sur `main` et sur chaque pull request :
typecheck, 54 tests e2e sur SQLite **et** sur PostgreSQL 16 (schéma créé uniquement par les
migrations), build de production de l'API, `npm audit` (échec si vulnérabilité ≥ haute),
typecheck + `next build` du front avec une URL d'API de production, build de l'image Docker.
Render et Vercel redéploient à chaque push sur `main` : ne fusionner que si la CI est verte.
