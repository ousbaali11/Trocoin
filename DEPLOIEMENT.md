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
   | `REFRESH_TOKEN_TTL_DAYS` | `30` (durée pendant laquelle un utilisateur reste connecté sans revenir ; chaque visite la prolonge) |
   | `REFRESH_REUSE_GRACE_MS` | `30000` (facultatif : tolérance de réutilisation d'un jeton tout juste tourné, onglets concurrents) |
   | `ESCROW_DEFAULT_AUTH_DAYS`, `ESCROW_SAFETY_HOURS`, `ESCROW_AUTO_CONFIRM_DAYS`, `ESCROW_DISPUTE_WINDOW_DAYS`, `ESCROW_ADMIN_ALERT_HOURS` | facultatifs (`5`, `24`, `4`, `7`, `48`) : échéances du séquestre avant l'expiration de l'autorisation bancaire (AUDIT §37) |
   | `CORS_ORIGINS` | `https://<votre-projet>.vercel.app` (puis vos vrais domaines, séparés par des virgules) |
   | `SMS_PROVIDER` | `vonage` ou `twilio` + les clés correspondantes (§5) |
   | `PAYMENT_PROVIDER` | `stripe` + `STRIPE_SECRET_KEY` (`sk_test_…` pour le mode test, `sk_live_…` ensuite) + `STRIPE_WEBHOOK_SECRET` (§5c) ; ou `disabled` (endpoints en 503) |
   | `NOTIFICATION_PROVIDER` | `none` (notifications in-app seulement) |
   | `EMAIL_PROVIDER` | `resend` + `RESEND_API_KEY` + `EMAIL_FROM` (§5b) ; ou `none` (« mot de passe oublié » en 503, l'admin réinitialise depuis le back-office) |
   | `STORAGE_PROVIDER` | `s3` + `S3_ENDPOINT`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (+ `S3_PUBLIC_URL` facultative, voir « Fichiers envoyés ») ; `local` = disque éphémère |
   | `SITE_URL` | `https://www.trocoin.fr` (liens des e-mails) |
   | `SENTRY_DSN` | facultatif (§7) |
   | `APP_VERSION` | facultatif, ex. `1.0.0` (affiché par `/health`) |

5. *Create Web Service*. Le premier build prend ~4 min. Dans les logs vous devez voir :
   `Migration InitialPostgres… has been executed successfully`, puis
   `API Trocoin démarrée … (env=production)` et `CORS autorisé pour : https://…`.
   Si la configuration est incomplète, l'API **refuse de démarrer** et le log indique
   précisément la variable fautive (`Configuration invalide : …`).
6. Notez l'URL : `https://api.trocoin.fr` (à adapter). Vérifiez
   `https://api.trocoin.fr/health` → `{"status":"ok","database":"postgres",…}`.

### 2b. Déploiement automatique à chaque push (à faire une fois)

Le service Render n'a jamais été relié au dépôt GitHub (aucun webhook côté GitHub), d'où
les *Manual Deploy* à répétition. Deux solutions, la première suffit :

**A. Deploy Hook + CI (recommandé, 2 minutes)** — la CI GitHub déclenche Render seulement
quand tout est vert, puis vérifie que `/health` sert la version poussée.
1. Render → service `trocoin` → *Settings* → *Deploy Hook* → *Create* → copier l'URL
   (elle contient un secret : ne la collez nulle part d'autre).
2. GitHub → dépôt → *Settings* → *Secrets and variables* → *Actions* → *New repository secret* :
   nom `RENDER_DEPLOY_HOOK`, valeur = l'URL copiée. (Équivalent en ligne de commande, depuis
   votre poste : `gh secret set RENDER_DEPLOY_HOOK` puis coller l'URL.)
3. C'est tout : le job « Déploiement Render (deploy hook) + preuve /health » de
   `.github/workflows/ci.yml` s'active au prochain push sur `main`. Tant que le secret est
   absent, le job affiche un avertissement et ne fait rien.

**B. Lier le compte GitHub dans Render** (auto-deploy natif) — Account Settings → Git
Providers → GitHub → installer l'app Render avec accès au dépôt ; puis Settings → Build &
Deploy du service : si la ligne *Repository* n'offre pas *Edit/Reconnect*, recréer le service
depuis *New → Web Service → Connect a repository* (variables à recopier, voir §2).

### Fichiers envoyés (photos) — stockage objet

Par défaut (`STORAGE_PROVIDER=local`) les photos sont écrites dans `/app/uploads`, disque
**éphémère** sur l'offre gratuite de Render : perdues à chaque déploiement (plafond
`MAX_PHOTOS_PER_DAY` en plus). Le code supporte un bucket S3 compatible ; **Cloudflare R2**
est recommandé (10 Go et 10 M de lectures/mois gratuits, pas de frais de sortie) :

1. dash.cloudflare.com → *R2 Object Storage* → *Create bucket* → nom `trocoin`, région
   automatique (choisir *EU* dans *Location hint* pour des données en Europe).
2. *Facultatif* — Bucket → *Settings* → *Public access* → *Allow Access* (r2.dev) → noter l'URL
   `https://pub-xxxxxxxx.r2.dev` (ou rattacher un domaine, ex. `media.trocoin.fr`). Sans accès
   public, l'API relaie elle-même les images (`GET /uploads/<uuid>.<ext>`, cache 1 an) : c'est le
   mode actuel ; l'URL publique décharge simplement Render du trafic des images.
3. R2 → *Manage R2 API Tokens* → *Create API token* → permission *Object Read & Write* limitée
   au bucket → noter *Access Key ID*, *Secret Access Key* et l'endpoint
   `https://<account_id>.r2.cloudflarestorage.com`.
4. Render → Environment : `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION=auto`,
   `S3_BUCKET=trocoin-photos`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (+ `S3_PUBLIC_URL` si
   l'étape 2 a été faite). Le démarrage refuse une configuration incomplète (variable nommée).
5. Les photos déjà envoyées sur le disque Render ne sont pas migrées (elles auront de toute
   façon disparu au redéploiement suivant).

Le chemin S3 est testé en e2e contre un faux serveur S3 en mémoire (`test/phase9`, avec et sans URL
publique, vignettes comprises) et **contre le bucket R2 réel `trocoin-photos` le 14 septembre 2026**
(`AUDIT.md` §15 : envoi, relais, suppression avec l'annonce).

## 3. Front (Vercel, 4 min)

1. vercel.com → *Add New… → Project* → importer `ousbaali11/Trocoin`.
2. *Root Directory* : `frontend` (important). Framework détecté : Next.js.
3. *Environment Variables* :
   - `NEXT_PUBLIC_API_URL` = `https://api.trocoin.fr` (l'URL Render, sans slash final)
   - `NEXT_PUBLIC_SITE_URL` = `https://<votre-projet>.vercel.app`
4. *Deploy*. Ces variables sont figées dans le bundle au build : après tout changement,
   *Redeploy*.
5. Revenir sur Render et mettre à jour `CORS_ORIGINS` avec l'URL Vercel définitive
   (l'API redémarre automatiquement).

## 4. Vérification externe après déploiement (3 min)

Depuis un téléphone **hors du réseau du développeur** :

1. `https://api.trocoin.fr/health` → `status: ok`.
2. `https://api.trocoin.fr/dev/last-otp/0612345678` → **404** (endpoint de dev neutralisé).
3. Ouvrir le site Vercel → *Créer un compte* (formulaire, aucun SMS pendant la phase de test,
   voir AUDIT.md §11) → *Déposer une annonce* → l'annonce apparaît dans la recherche.
   Le parcours SMS reste testable sur `/connexion/sms` (consomme du crédit Vonage).
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

## 5b. E-mail (Resend)

Variables, **noms exacts** : `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (clé « sending access »
suffit), `EMAIL_FROM` (ex. `Trocoin <no-reply@votre-domaine.fr>`), `SITE_URL` (lien des
e-mails). Appel : `POST https://api.resend.com/emails` (`src/email/email.service.ts`,
`ResendEmailProvider`), délai 10 s, chaque refus du fournisseur est journalisé avec sa raison et
l'utilisateur reçoit un 503 neutre.

**Restriction du mode bac à sable Resend** : avec l'expéditeur `onboarding@resend.dev`, Resend
n'accepte que l'adresse e-mail du propriétaire du compte Resend (réponse
`403 validation_error : You can only send testing emails to your own email address`). Pour écrire
aux vrais utilisateurs : resend.com/domains → *Add domain* → ajouter les enregistrements DNS
indiqués (SPF/DKIM) → puis `EMAIL_FROM=Trocoin <no-reply@<ce domaine>>`.

Vérifier un envoi réel hors production : `POST /auth/password/forgot` puis
`GET /dev/last-reset-link/:email` (module dev, absent en production) donne le lien envoyé ; le
comparer à l'e-mail reçu.

## 5b bis. Mise en veille de l'API (offre gratuite de Render) — AUDIT §63

Sur l'offre gratuite, Render **met l'API en veille** après 15 minutes sans requête (premier appel suivant : 30 à
60 s). Conséquence constatée en production : la tâche interne des échéances du séquestre (toutes les 15 min :
encaissement sous 24 h, réception présumée, virements, annulations) ne tournait pas, et les autorisations bancaires
expiraient au bout de 7 jours sans être encaissées — l'admin ne pouvait plus libérer les fonds. Deux parades sont en
place : les échéances sont rejouées **à chaque démarrage** de l'API, et le workflow GitHub `keep-alive.yml` appelle
`/health` **toutes les 10 minutes** (GitHub peut décaler ses tâches planifiées de quelques minutes). La solution
propre reste l'instance **Starter** de Render (pas de mise en veille) : dans ce cas le workflow peut être supprimé.

## 5c. Paiement (Stripe)

Modèle : **Stripe Checkout** (page de paiement hébergée, aucune clé publiable ni formulaire de
carte côté front) en « **paiements et transferts distincts** » (AUDIT §39) : l'acheteur autorise le
montant, la transaction passe « Fonds bloqués » (`sequestre`), Trocoin **encaisse sur son propre
solde** au plus tard 24 h après (plus tôt à l'expédition, à la remise ou au litige) ; une annulation
dans ce délai libère l'autorisation (rien n'est débité). Le vendeur (onboarding Stripe Connect
Express, `/compte/paiements`) est payé par un **Transfer** du montant net (prix − commission 8 %) à
la confirmation seulement ; les frais acheteur et la commission restent sur le solde de la
plateforme. Un vendeur sans compte est payé dès qu'il l'a créé (tâche périodique).

**Prérequis côté tableau de bord Stripe (à faire par le titulaire du compte, en mode test comme en mode réel)** :
activer **Connect** (dashboard.stripe.com/connect → *Get started*, type de plateforme « marketplace ») et compléter le
**profil de plateforme** (dashboard.stripe.com/settings/connect/platform-profile : responsabilité des pertes,
description de l'activité). Sans cela Stripe refuse la création des comptes vendeurs : « Configurer mon compte de
versement » répond alors 503 `CONNECT_NOT_READY` avec un message clair (AUDIT §61 — avant : erreur 500), et, avec des
clés de test, la cause exacte donnée par Stripe (`reason`) s'affiche sous le bouton.

Points d'attention trésorerie (le compte plateforme détient temporairement l'argent des acheteurs) :
les transferts sont adossés à la charge d'origine (`source_transaction`) et n'exigent donc pas de
solde disponible ; en revanche un **remboursement** après que les fonds ont été reversés sur le compte
bancaire de Trocoin (virements automatiques Stripe) tire le solde en négatif et Stripe prélève le
compte bancaire. Régler le calendrier des virements Stripe (*Balance → Payout schedule*) avec un
délai ou une réserve couvrant les fonds en séquestre, et tenir un suivi comptable des fonds détenus
pour compte de tiers (sujet comptable / juridique à traiter avec un conseil, non tranché ici). Les
ventes créées avant cette bascule (`escrowModel = destination`) restent des « destination charges »
et se terminent avec l'ancienne logique.

1. Stripe → *Developers* → *API keys* : `STRIPE_SECRET_KEY` (`sk_test_…` tant que l'on teste ;
   `sk_live_…` après activation du compte).
2. Stripe → *Developers* → *Webhooks* → *Add endpoint* :
   URL `https://api.trocoin.fr/transactions/webhook/stripe`, évènements
   `checkout.session.completed`, `checkout.session.expired`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `payment_intent.canceled`, `charge.refunded` → *Signing secret* = `STRIPE_WEBHOOK_SECRET`.
   (Créé le 14 septembre 2026 pour le compte de test : endpoint `we_1UFhaP5YWLqgMw96qQYHFUhZ`.)
3. Render → Environment : `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `SITE_URL` (URL de retour après paiement). Le démarrage refuse une configuration incomplète.
4. Test : carte `4242 4242 4242 4242`, date future, CVC quelconque. Une transaction
   « en_attente » sans paiement est annulée après 30 minutes (relecture au retour de l'acheteur,
   webhook, ou tâche périodique toutes les 10 minutes).

Le retour de l'acheteur (`/compte/transactions/<id>?paiement=retour`) relit la session chez
Stripe : le webhook n'est pas indispensable pour confirmer, mais il l'est pour les annulations
et remboursements faits depuis le tableau de bord Stripe.

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

**Sauvegarde automatisée (GitHub Actions)** : `.github/workflows/backup.yml` fait chaque lundi
(et à la demande, *Actions → Sauvegarde base de données → Run workflow*) un `pg_dump` chiffré
(AES-256, phrase secrète) conservé 90 jours comme artefact, après vérification que l'archive se
déchiffre et se lit. Ne fait rien tant que les deux secrets n'existent pas :
`DATABASE_URL_BACKUP` (l'URL Neon) et `BACKUP_PASSPHRASE` (phrase longue, à conserver hors
GitHub ; sans elle l'archive est illisible). Restauration : télécharger l'artefact, puis
`openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in trocoin-….dump.enc -out trocoin.dump`
et `pg_restore` comme ci-dessus.

**Photos** (`/app/uploads`) : non couvertes par la sauvegarde base — voir §2.

### 6b. Base Neon : passer de la région US à l'Europe (RGPD)

Le nouveau projet Neon **Frankfurt (eu-central-1)** a reçu les 8 migrations le 14 septembre 2026
(`DB_TYPE=postgres DATABASE_URL=<URL EU> npm run migration:run`). La copie des données se fait
sans `pg_dump`, avec le pilote `pg` du projet :

```bash
SOURCE_DATABASE_URL="<URL Neon US>" TARGET_DATABASE_URL="<URL Neon EU>" node scripts/migrer-base.js
```

Le script vérifie que la cible a les migrations, ordonne les tables par clés étrangères, vide la
cible puis copie toutes les tables dans une seule transaction, remet les séquences à niveau et
termine par une preuve d'intégrité : comptage **et** empreinte md5 du contenu de chaque table,
des deux côtés (sortie non nulle à la moindre différence). Il est rejouable : le relancer juste
avant de basculer reprend les écritures survenues entre-temps. Répété à blanc le 14 septembre
(source PGlite → Frankfurt, 23 tables identiques, `AUDIT.md` §15).

Bascule : relancer la copie → Render → `DATABASE_URL` = URL EU → redéployer → vérifier
`/health` (`databaseRegion: eu-central-1` ; `us-east-2` = la bascule n'a pas pris, vérifier qu'aucune
autre `DATABASE_URL` ne subsiste dans un *Environment Group* et que le déploiement a bien suivi
l'enregistrement), se connecter avec un compte existant, relancer
`node scripts/charge.js` pour constater la latence. Ne supprimer le projet US qu'après ces
vérifications (et mettre à jour `DATABASE_URL_BACKUP` du workflow de sauvegarde).

### 8b. Redis pour le rate limiting (quand la deuxième instance arrive)

Le code accepte `REDIS_URL` (`rediss://…`, Upstash gratuit 10 000 commandes/jour ou Render
Key Value) : les compteurs de rate limiting deviennent partagés entre instances ; sans
variable, ils restent en mémoire (correct avec une seule instance). Testé avec un Redis
simulé (`ioredis-mock`) ; pas de compte Redis créé à ce jour.

### 9b. Vérification SIRET

Les comptes professionnels sont vérifiés auprès du registre public
`recherche-entreprises.api.gouv.fr` (sans clé) : SIRET inconnu ou établissement fermé →
inscription refusée ; registre injoignable → compte accepté marqué « SIRET non vérifié »
(visible dans le back-office). `SIRENE_PROVIDER=none` désactive l'appel.

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
