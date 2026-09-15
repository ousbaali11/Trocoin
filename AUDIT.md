# AUDIT.md — Trocoin, état consolidé au 14 septembre 2026

Ce document remplace les sections incrémentales accumulées phase après phase (archivées
dans `AUDIT-HISTORIQUE.md`). Chaque affirmation est étiquetée :
**[exécuté]** vérifié par exécution réelle (tests e2e, appels HTTP sur la production, navigateur) ·
**[lecture]** vérifié par relecture du code · **[non testé]** impossible à tester ici, avec la raison ·
**[différé]** volontairement reporté par choix produit.

Production : API `https://api.trocoin.fr` (Render, Docker, PostgreSQL Neon, SMS Vonage ; alias
`trocoin.onrender.com`), front `https://www.trocoin.fr` (Vercel ; `trocoin.fr` et `trocoin.vercel.app`
y redirigent, §23). Dépôt GitHub `ousbaali11/Trocoin`, branche `main`.

---

## 1. Résumé exécutif — état réel du site aujourd'hui

**Ce qui marche en production, vérifié [exécuté] :** accueil utilitaire (recherche
« QUOI ? / OÙ ? » avec localisation à la leboncoin : Autour de moi, Toute la France, commune +
rayon 0–200 km, 5 km par défaut), recherche par catégorie et filtres spécifiques par famille,
plein texte PostgreSQL, dons/échanges, prix moyen constaté et badge « Fiche complète » au dépôt,
inscription particulier / professionnel par formulaire (mot de passe, e-mail, username, mobile
français, SIRET vérifié au registre public), connexion e-mail ou username + mot de passe, mot de
passe oublié (parcours complet, **envoi d'e-mail non branché**), changement de mot de passe,
réinitialisation par l'admin, œil sur les champs mot de passe, sessions révocables, messagerie,
favoris, alertes, avis, signalements, back-office complet, CMS légal, photos retraitées
(EXIF/GPS supprimés, ≤ 1600 px, plafond par compte), CI GitHub (105 tests sur SQLite et sur
PostgreSQL 16, image Docker). Depuis le tour « polish » du 14 septembre après-midi (§9) : centre
d'aide structuré, partage d'annonce, autres annonces du vendeur, reprise des consultations sur
l'accueil, préférences de notification par famille et canal, navigation compte et console admin
utilisables sur mobile, boîte de confirmation unique.

**Les quatre points de configuration différés sont implémentés et testés contre les vrais services
le 14 septembre au soir (§15) :** stockage des photos sur Cloudflare R2 (envoi, relais, suppression
réels), e-mail Resend (appel réel ; envoi aux vrais utilisateurs conditionné à un domaine vérifié
chez Resend), paiement Stripe en mode test (Checkout hébergé, capture à la réception, annulation,
webhook signé), base Neon Frankfurt migrée (schéma) avec script de copie prouvé. **Activation en
production : variables à saisir dans Render par vous** (liste §15) ; la copie des données US → EU
attend l'URL de l'ancienne base. Redis reste facultatif tant qu'il n'y a qu'une instance.

**Ce qui est volontairement différé (choix produit, §6) :** PayPal (après validation de Stripe),
clés Stripe réelles (`sk_live`), vérification SMS du téléphone à l'inscription (désactivée depuis
le passage au mot de passe ; le badge « téléphone vérifié » n'est affiché nulle part), validation
juridique des textes.

**État de la base :** production sur Neon **Frankfurt** (`eu-central-1`) depuis le 15 septembre,
données copiées et vérifiées, fiche d'annonce passée de 557 ms à 56 ms de p50 (§15.1). L'ancienne
base US est conservée intacte jusqu'à votre suppression.

**Préalable auto-deploy (point 0 du brief) : résolu et prouvé le 14 septembre [exécuté].**
Le service Render n'a jamais été relié au dépôt (0 webhook GitHub) ; la solution retenue est
un *Deploy Hook* Render enregistré comme secret GitHub `RENDER_DEPLOY_HOOK` (créé par vous à
10:10 UTC) et un job de CI « Déploiement Render (deploy hook) + preuve /health » qui ne se
déclenche qu'après une CI entièrement verte sur `main`. Preuve : commit de test `5c64b5c`
(version 1.2.1) poussé à 12:15 → run 34832288508 vert → hook appelé → `/health` est passé de
`1.1.0` à `1.2.1` à 12:20, **sans aucun Manual Deploy**, le job ayant lui-même constaté la
nouvelle version (« Déployé et vérifié »). Chaque push sur `main` suit désormais ce chemin ; un
déploiement qui ne remonte pas en 15 minutes fait échouer la CI.

---

## 2. Sécurité — mesures en place et restes

| Domaine | En place | Preuve | Reste |
|---|---|---|---|
| Authentification | Mot de passe scrypt (N=2^15, sel 16 o), colonne jamais sélectionnée par défaut ; message unique et temps constant à la connexion ; 10 essais / 10 min / IP | [exécuté] tests phase 5 | Pas de double facteur ; pas de vérification que l'e-mail appartient à l'inscrit (aucun envoi d'e-mail) |
| Sessions | Access token JWT 15 min + refresh token 30 j haché en base, rotation à chaque usage, **famille révoquée en cas de réutilisation**, révocation à la déconnexion, au changement/réinitialisation de mot de passe, à la suspension, à la suppression | [exécuté] tests phase 3, 6, 7 ; cycle réel sur Postgres | Un access token volé reste valable ≤ 15 min (compromis documenté) |
| Mot de passe oublié | Jeton aléatoire 32 o, seul le SHA-256 stocké, usage unique, 1 h, réponse neutre (pas d'énumération), 5 demandes / 15 min / IP | [exécuté] tests phase 6 ; prod : 503 explicite tant que `EMAIL_PROVIDER=none` | **Envoi d'e-mail à brancher** (§5) ; en attendant, réinitialisation par l'admin (mot de passe temporaire affiché une fois, journalisé) |
| Téléphone | Mobile français obligatoire (+33 6/7), normalisé et validé serveur, unique | [exécuté] | **Non prouvé par SMS** depuis la phase 5 : un inscrit peut saisir le numéro d'un tiers et le bloquer ; règle « un humain = un compte » affaiblie. Choix produit assumé (§6), réactivable en ~20 lignes (`AuthService.register` → `OtpService`) |
| Comptes pro | SIRET : clé de Luhn **et** existence/activité au registre public (`recherche-entreprises.api.gouv.fr`) ; SIRET fermé ou inconnu refusé ; registre injoignable → compte accepté marqué « non vérifié » (visible admin) ; unicité du SIRET | [exécuté] tests phase 9 (mock + client HTTP simulé) ; appel réel depuis le poste : Google France → actif | L'API publique peut être limitée en débit ; pas de vérification que la personne est mandataire de l'entreprise |
| Entrées | `ValidationPipe` whitelist, DTO stricts, attributs de catégorie validés contre un schéma (types, bornes, listes), longueurs bornées, LIKE échappé, requêtes paramétrées | [exécuté] tests listings, phase 6 | — |
| Fichiers | MIME + signature binaire, ré-encodage `sharp` (orientation appliquée, **EXIF/GPS/ICC purgés**), ≤ 1600 px, fichiers corrompus rejetés, nom = UUID serveur, `nosniff`, 8 Mo max, 10 photos/annonce, **150 photos/compte/24 h** | [exécuté] tests phase 7, 8, 9 | Stockage encore sur disque éphémère Render (§5) ; pas d'antivirus |
| HTTP | Helmet (CSP, HSTS, nosniff, frame-options), CORS restreint à `https://trocoin.vercel.app` (403 sinon), `TRUST_PROXY` pour la vraie IP, rate limiting global 100 req/min/IP + limites par route sensibles | [exécuté] sur la production | Rate limiting en mémoire → une seule instance (Redis prêt, §5) |
| Production | Démarrage refusé si `JWT_SECRET` faible/absent, CORS absent, base ≠ Postgres, fournisseur `mock` (SMS, paiement, notifications, e-mail, Sirene) ou clés manquantes ; `synchronize` désactivé, migrations seules ; `/dev/*` → 404 ; utilisateur Docker non-root ; `npm audit` bloquant en CI | [exécuté] boot de contrôle en mode production ; CI | Sentry non alimenté (pas de DSN) |
| Autorisation | Rôle admin relu en base à chaque requête ; aucune route HTTP ne promeut admin ; audit log des actions admin (dont réinitialisation de mot de passe) ; propriété vérifiée sur annonces/photos/conversations | [exécuté] tests | — |
| Données | Export RGPD, suppression = anonymisation ; profil public sans téléphone/e-mail/SIRET complet | [exécuté] | **Base en région US** (§7) ; photos (`/uploads`) hors sauvegarde |
| Paiement | Stripe Checkout hébergé (aucune donnée de carte chez Trocoin), capture différée, webhook à signature vérifiée (corps brut), URL de paiement visible du seul acheteur ; `disabled` en production tant que les variables ne sont pas saisies | [exécuté] phase 13 + parcours Stripe réel en mode test (§15) | Clés `sk_live` ; PayPal [différé] |

---

## 3. Complétude fonctionnelle face à leboncoin (`analyse-concurrentielle.md`)

Synthèse par domaine (le détail filtre par filtre et famille par famille est en
`analyse-concurrentielle.md` §10, relevé réel sur leboncoin.fr des 14 et 15 septembre 2026).

| Domaine | leboncoin | Trocoin | Écart restant |
|---|---|---|---|
| Compte | SMS/e-mail, pro avec SIRET | Formulaire particulier/pro, SIRET vérifié au registre, mot de passe, username | Pas de connexion sociale ; téléphone non vérifié (différé) |
| Dépôt | Champs par catégorie, exemple de titre, photos, brouillon | Idem : 60 exemples de titre, schémas alignés (voir ci-dessous), 10 photos retraitées, brouillon, import CSV/XML, multi-utilisateurs pro, prix moyen constaté, fiche complète | Listes dépendantes marque → modèle → finition (référentiel constructeur absent) |
| Recherche | Mots-clés, localisation (Autour de moi / Toute la France / commune + rayon), filtres, tri, carte, sauvegarde | Identique, paliers de rayon exacts (0/1/5/10/20/30/50/100/200 km, 5 par défaut), plein texte français, dons/échanges en un clic | Historique des localisations ; arrondissements « toute la ville » |
| Annonce | Galerie, critères, vendeur, similaires, annonces du pro, partage, signalement | Identique + badge « Fiche complète », menu Partager (lien, WhatsApp, e-mail, Facebook, X, natif), « autres annonces de ce vendeur » | — |
| Messagerie / transaction | Messagerie, paiement sécurisé, livraison | Messagerie temps réel, offres de prix, photos ; paiement sécurisé Stripe (Checkout, capture à la réception) | Activation Render (§15) ; pas d'étiquettes transporteur |
| Confiance / modération | Vérifications, modération | Pré-modération mots-clés, file admin, signalements, suspension, audit ; SIRET vérifié | Pas de vérification d'identité ni de téléphone |
| Aide / notifications / RGPD | Centre d'aide structuré, préférences de notification, export | Centre d'aide (6 rubriques, 22 articles, recherche), préférences famille × canal, export JSON | E-mail « mot de passe oublié » via Resend (§15) ; autres e-mails non branchés |
| Pro | Boutique, formules, stats | Vitrine, formules (monétisation off), import, multi-comptes, stats | Facturation réelle (différé) |

**Familles, champs et filtres — état après ce tour** (12 familles) :

| Famille | Relevé leboncoin | Alignement Trocoin |
|---|---|---|
| Immobilier | Filtres ventes + locations relevés ; champs relevés sur annonces | Complet (type de vente, exposition, état du bien, salles d'eau ajoutés) ; manquent « caractéristiques » à cocher et étages de l'immeuble |
| Véhicules | Filtres voitures + motos relevés ; champs relevés | Complet (type de véhicule, puissance DIN, couleur en liste, sellerie ajoutés) ; manquent finition/version constructeur, LOA/LLD |
| Matériel pro | Champs relevés (matériel agricole) ; **panneau de filtres non relevé** (accès restreint par leboncoin après les visites automatisées) | Schémas existants (type, année, heures) cohérents avec les champs vus |
| Emploi | Filtres + champs relevés | Complet (fonction, niveau d'études ajoutés) |
| Mode | Filtres + champs relevés | Complet (couleur en liste) |
| Maison & Jardin | Filtres + champs relevés (ameublement) | Complet (pièce, marque, couleur ajoutés) ; manquent démontable/quantité |
| Famille | Champs relevés (puériculture) ; filtres non relevés | Couleur ajoutée ; univers/produit à deux niveaux non repris |
| Électronique | Filtres + champs relevés (téléphonie, informatique) | Complet (produit, taille d'écran ajoutés) ; « usage » non repris |
| Loisirs | Champs relevés (sport, instruments) ; filtres non relevés | Type de produit (sport) et niveau (instruments) ajoutés ce tour |
| Locations de vacances | Champs relevés ; filtres non relevés | Wifi, climatisation, parking ajoutés ce tour ; étoiles non reprises |
| Services | **Ni filtres ni champs relevés** (identifiant de catégorie non atteint avant le blocage) | Schémas existants (tarif, zone) non confrontés |
| Animaux | Champs relevés ; filtres non relevés | Équivalent (type, race, âge, sexe, identification, vacciné, LOF) |

Ce qui n'a pas pu être relevé l'est pour une raison précise : leboncoin a restreint l'accès
(« Accès temporairement restreint », protection anti-robot) après une quarantaine de pages
ouvertes automatiquement ce soir ; je n'ai pas cherché à contourner cette protection.
Un relevé manuel des 6 panneaux manquants prend 15 minutes depuis un navigateur normal.

---

## 4. Preuves d'exécution de ce tour (14 septembre 2026, soir)

- Tests e2e : **85 sur SQLite** (84 réussis + 1 ignoré, le plein texte étant Postgres seul) et
  **85 sur PostgreSQL** (PGlite, schéma issu des 6 migrations, aucune dérive détectée par
  `migration:generate`). Nouveaux : `test/phase9.e2e-spec.ts` — photo envoyée vers un faux
  serveur S3 en mémoire (clé `uploads/<uuid>.png`, `content-type` correct, URL CDN exposée par
  l'API, suppression = `DELETE` sur le bucket, fichier corrompu jamais envoyé) ; SIRET actif →
  compte pro « vérifié », inconnu → 400 « introuvable dans le registre », fermé → 400, Luhn
  faux → 400 avant appel, registre en panne → compte accepté non vérifié ; interprétation de
  vraies réponses du registre (actif, fermé, inconnu, panne, HTTP 503) ; stockage Redis du
  throttler avec `ioredis-mock` (compte, expire, bloque, isole IP et throttlers, Redis en panne
  → laisse passer).
- Registre des entreprises, appel réel depuis le poste : `44306184100047` → GOOGLE FRANCE,
  état A, siège PARIS ; `88800012300008` (Luhn valide, inexistant) → 0 résultat.
- `tsc` API et front : 0 erreur ; `next build` avec l'URL de production : succès.
- Production avant ce tour : `/connexion`, `/mot-de-passe-oublie`, `/reinitialiser`,
  `/inscription` → 200 ; `POST /auth/password/forgot` → 503 explicite (aucun fournisseur
  d'e-mail) ; `POST /admin/users/:id/reset-password` → 401 sans jeton (route présente).
- CI GitHub et déploiements : voir §8 (complété après le push).

---

## 5. Comptes et clés — état vérifié en production le 15 septembre 2026

Chaque ligne a été contrôlée par une exécution réelle contre `https://trocoin.onrender.com`
(version 1.9.0 au moment du contrôle), pas d'après la configuration déclarée.

| Besoin | Statut | Preuve du 15 septembre | Variables (Render) | Guide |
|---|---|---|---|---|
| Auto-deploy Render | **Fait** (14 septembre) | Chaque `git push` déclenche le déploiement ; `/health` renvoie la version attendue (§8) | secret GitHub `RENDER_DEPLOY_HOOK` | `DEPLOIEMENT.md` §2b |
| Stockage des photos (Cloudflare R2) | **Fait** | Objet déposé dans le bucket, puis `GET /uploads/<nom>.jpg` sur l'API de production → 200 `image/jpeg` ; après suppression de l'objet → 404. Les photos passent donc bien par R2 et non par le disque Render | `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (+ `S3_PUBLIC_URL` facultative) | `DEPLOIEMENT.md` « Fichiers envoyés » |
| Paiement Stripe (mode test) | **Fait** | Événement signé envoyé à `POST /transactions/webhook/stripe` → 200 `{"received":true,"handled":"ignored"}` ; même événement avec une mauvaise signature → 400. Le secret de webhook en place sur Render est donc le bon | `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL` | `DEPLOIEMENT.md` §5c |
| Base Neon en Europe | **Fait, ménage restant** | `/health` → `databaseRegion: "eu-central-1"`, écritures constatées à Frankfurt (§15.1). **L'ancien projet Neon US (us-east-2) existe toujours** : connexion encore possible, 2 comptes dedans (copie figée du 14 septembre). À supprimer depuis le tableau de bord Neon une fois que vous n'en voulez plus : rien ne le lit, mais c'est une copie de données personnelles hors Europe | `DATABASE_URL` (Frankfurt) | `DEPLOIEMENT.md` §6b |
| E-mail transactionnel (Resend) | **Partiel** | Le fournisseur est bien actif (l'API ne répond plus « non configuré ») mais **l'envoi échoue** : `POST /auth/password/forgot` pour une adresse réelle → 503 « L'envoi de l'e-mail a échoué ». Cause vérifiée directement auprès de Resend : l'expéditeur `onboarding@resend.dev` est un bac à sable qui n'accepte qu'une seule adresse de destination (celle du compte Resend, `trocoin2026@gmail.com`). Tant qu'aucun domaine n'est vérifié chez Resend et renseigné dans `EMAIL_FROM` (par exemple `Trocoin <no-reply@votre-domaine>`), aucun autre destinataire ne reçoit d'e-mail. Un envoi réel vers `trocoin2026@gmail.com` a été exécuté (§18) et fonctionne : le code est prêt, c'est la configuration Resend qui bloque | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, `SITE_URL` | `DEPLOIEMENT.md` §5b |
| Sauvegarde chiffrée automatisée | **Pas fait** | `gh secret list` sur le dépôt : seul `RENDER_DEPLOY_HOOK` existe. Les secrets `DATABASE_URL_BACKUP` et `BACKUP_PASSPHRASE` sont absents, le workflow n'a donc jamais tourné et aucune restauration n'a été testée | secrets GitHub `DATABASE_URL_BACKUP`, `BACKUP_PASSPHRASE` | `DEPLOIEMENT.md` §6 |
| Redis (plus tard) | Différé | Dès la 2ᵉ instance | `REDIS_URL` (Upstash gratuit) | `DEPLOIEMENT.md` §8b |
| Sentry (facultatif) | Différé | Erreurs 500 remontées | `SENTRY_DSN` | `DEPLOIEMENT.md` §7 |

---

## 6. Différés par choix produit (à ne pas confondre avec des manques)

**Décision du 14 septembre 2026 (tests entre proches uniquement) — à traiter avant une vraie
ouverture publique :**

- **Fournisseur d'e-mail** : ~~différé~~ **fait le 14 septembre** (§15) : appel Resend réel ;
  reste à vérifier un domaine chez Resend pour écrire à d'autres adresses que celle du compte.
- **Stockage objet des photos** : ~~différé~~ **fait le 14 septembre** (§15) : testé contre le
  bucket R2 réel ; activation par 6 variables dans Render.
- **Région de la base Neon** : ~~différé~~ **préparé le 14 septembre** (§15) : Frankfurt migrée,
  copie prouvée à blanc ; copie réelle et bascule dès réception de l'URL de la base US.
- **Paiement sécurisé réel** : ~~différé~~ **fait le 14 septembre en mode test** (§15) : Stripe
  Checkout + capture différée + webhook signé, parcours complet exécuté contre Stripe. Restent
  différés : clés réelles `sk_live` (activation du compte Stripe), PayPal.
- **Vérification SMS du téléphone à l'inscription** : coupée depuis le passage au mot de
  passe pour ne pas consommer de crédit Vonage pendant les tests. Le badge « téléphone
  vérifié » n'est présenté nulle part ; l'ancien parcours OTP reste disponible sur
  `/connexion/sms` pour les comptes créés avant. Réactivation documentée
  (`AUDIT-HISTORIQUE.md` §11.3).
- **Validation juridique des textes** (CGU, confidentialité, mentions) : hors de portée d'une
  IA ; un avocat doit relire avant ouverture publique.

---

## 7. Ce qu'il reste avant une vraie ouverture publique — priorisé et honnête

**Bloquant pour une bêta fermée (quelques testeurs invités)**
- ~~Auto-deploy Render~~ réglé le 14 septembre (§8). Plus rien de bloquant pour la bêta :
  l'admin dépanne les mots de passe oubliés, les photos sont volatiles en connaissance de cause.

**Non bloquant pour la bêta fermée, à traiter avant l'ouverture publique (différés par choix, §6)**
— état contrôlé en production le 15 septembre 2026 (détail et preuves en §5) :
1. E-mail transactionnel : **partiel**. Fournisseur actif sur Render, mais les envois échouent pour
   tout destinataire autre que l'adresse du compte Resend (expéditeur bac à sable). Reste, entre vos
   mains : vérifier un domaine chez Resend puis mettre `EMAIL_FROM` sur ce domaine. Sans cela, ni le
   mot de passe oublié ni la confirmation d'adresse (§18) n'atteignent les inscrits.
2. ~~Stockage objet des photos~~ **fait** : variables en place, relais R2 prouvé en production.
3. Base Neon en Europe : **fait** (bascule prouvée). Reste : supprimer l'ancien projet US, qui
   existe toujours avec une copie des données du 14 septembre.
4. ~~E-mail de confirmation à l'inscription~~ **fait le 15 septembre (§18)** : lien à usage unique
   (24 h), statut visible dans le compte, renvoi limité. La vérification du téléphone par SMS reste
   différée (§6).
5. Textes légaux validés par un juriste ; information sur la collecte du téléphone non vérifié.
6. Instance Render payante (fin de la mise en veille : premier appel jusqu'à 1 minute) et Redis
   dès la deuxième instance.
7. Sauvegarde automatisée : **pas fait**. Les deux secrets GitHub (`DATABASE_URL_BACKUP`,
   `BACKUP_PASSPHRASE`) sont absents, le workflow n'a jamais tourné, aucune restauration testée
   (`DEPLOIEMENT.md` §6). Sentry non alimenté (DSN).

**Confort / après ouverture** — traités le 15 septembre 2026 (§19)
8. ~~Six panneaux de filtres et menu « Partager »~~ **fait, avec réserve** : les schémas des six
   familles ont été complétés (§19.1) et le menu Partager confirmé, mais le relevé sur leboncoin.fr a
   de nouveau été coupé par la protection anti-robot après quelques pages (« Accès temporairement
   restreint », non contourné) : les listes ajoutées viennent de la connaissance générale du site,
   pas d'une observation du jour, et restent à confirmer en 15 minutes depuis un navigateur normal.
9. ~~Listes marque → modèle, historique des localisations, arrondissements groupés~~ **fait** (§19.2).
10. ~~Modification de l'e-mail avec confirmation ; double facteur~~ **fait** (§19.3).
11. ~~Paiement réel~~ Stripe fait en mode test (§15) ; clés réelles, PayPal, notifications push/e-mail, KYC, DAC7 (différés : décisions et informations non disponibles à ce jour).

---

## 8. CI et déploiement de ce tour

**Suite du 14 septembre (après mise en place du secret)** : auto-deploy prouvé (voir §1). Puis
trois compléments réalisables sans clé : (1) suppression d'un compte à mot de passe revue —
e-mail, username, prénom/nom, raison sociale, hash et statut SIRET effacés, sessions
révoquées, identifiants réutilisables ; test `phase10` (login/refresh refusés, profil
anonymisé, réinscription avec les mêmes identifiants OK) ; (2) « Paris / Lyon / Marseille (toute
la ville) » dans le sélecteur de localisation, arrondissements listés séparément (vérifié sur
l'API adresse.data.gouv.fr : la commune « Lyon » et « Lyon 3e Arrondissement » arrivent en
entrées distinctes) ; (3) sauvegarde hebdomadaire chiffrée par GitHub Actions
(`backup.yml`, secrets `DATABASE_URL_BACKUP` + `BACKUP_PASSPHRASE`, vérification que
l'archive se déchiffre et se lit, artefact 90 jours) — inactif tant que les secrets manquent.
Le SIRET au registre est confirmé actif en production : un SIRET inconnu est refusé par
`trocoin.onrender.com` avec le message attendu.


- Push `99549d4` puis correctifs YAML `3b8c5ef` → `ce7723d` (le nouveau job de déploiement avait deux erreurs de syntaxe YAML, détectées par GitHub puis validées localement avec js-yaml). Run **34830238107 vert** : 5 jobs — API SQLite (85 tests, audit 0 vulnérabilité), API PostgreSQL 16 (85 tests, 6 migrations), front (`next build`), image Docker (sharp/libvips chargés dans l'image), **« Déploiement Render (deploy hook) + preuve /health » exécuté** : il a constaté l'absence du secret `RENDER_DEPLOY_HOOK` et affiché l'avertissement prévu, sans déployer.
- Vercel : déploiement réussi ; `/connexion` (lien « Mot de passe oublié ? », bouton œil), `/inscription` (deux boutons œil de 44 px), `/mot-de-passe-oublie`, `/reinitialiser` vérifiés en ligne dans le navigateur.
- Render : **toujours le build de la phase 8, version 1.1.0** (`/health`), donc ni le SIRET au registre, ni le stockage S3, ni Redis, ni la version 1.2.0 ne sont en ligne. Preuve du point 0 impossible sans l'une des deux actions de votre côté (§5) ; dès que le secret existe, le prochain push déploie et le job CI vérifie `/health` = version du `package.json`. À défaut, un Manual Deploy de `ce7723d` met l'API à jour (la migration `SiretVerified` s'exécutera au démarrage).


---

## 9. Tour « polish » du 14 septembre 2026 (après-midi) — revue page par page

Méthode : chaque page ouverte dans le navigateur, connecté avec un compte administrateur sur des
données locales représentatives (27 annonces, conversation, transaction, favori, historique,
recherche sauvegardée créés pour l'occasion), en **375 px** (mobile) puis à la largeur du panneau
(~800 px) ; mesure automatique du débordement horizontal (`scrollWidth`) sur les 35 pages ;
lecture du code de chaque page pour les états vide / erreur / chargement. Corrections testées
dans le navigateur avant commit ; suites e2e complètes rejouées (SQLite et PostgreSQL) ;
`next build` vert. Les quatre points de configuration différés (paiement réel, e-mail, R2,
région Neon) n'ont pas été touchés.

### 9.1 Site public

| Page | Constat | Correction |
|---|---|---|
| Accueil | Rien à reprendre sur la recherche ; aucun retour vers ce que le membre regardait | Bloc « Vos dernières annonces consultées » (membre connecté, historique non vide) ; lien offre pro vers l'article d'aide |
| Résultats (liste et carte) | États vide / erreur / chargement déjà traités ; pas de débordement à 375 px | — |
| Détail d'une annonce | « Partager » = simple copie du lien ; pas d'autres annonces du vendeur | Menu Partager complet (copier, WhatsApp, e-mail, Facebook, X, partage natif) ; section « Les autres annonces de ce vendeur / de cette boutique » ; lien conseils vers l'article dédié |
| Vitrine vendeur / pro | Badge « Téléphone vérifié » encore affiché (contraire au différé SMS) ; pas de partage | Badge retiré ; bouton « Partager » la boutique |
| Inscription, connexion, mot de passe oublié | Corrects sur mobile et grand écran, messages d'erreur explicites | — |
| CGU, confidentialité, mentions légales, à propos | Textes par défaut périmés : « vérifié par code SMS », données collectées incomplètes, promesse « hébergées dans l'Union européenne » fausse aujourd'hui (Neon us-east-2) | Textes par défaut corrigés ; **resynchronisation automatique au démarrage** tant qu'un administrateur n'a jamais édité la page (`updatedBy` vide) ; test phase 11 |
| Aide / FAQ | Page statique unique, périmée (code SMS, « abonnements dans une prochaine version ») | Centre d'aide structuré : 6 rubriques, 22 articles, recherche instantanée, questions les plus consultées, pages `/aide/<slug>`, fil d'Ariane, articles liés, sitemap ; liens du site mis à jour |
| Pied de page | « numéro de mobile français vérifié », « données hébergées en Union européenne » | Formulations exactes ; liens vers les articles d'aide |
| Page 404 | Correcte | — |
| En-tête | Sous 375 px, le logo repoussait compte et menu à la ligne | Logo réduit sous 400 px |

### 9.2 Espace compte

| Page | Constat | Correction |
|---|---|---|
| Navigation du compte (toutes les pages) | Sur mobile, 13 liens empilés (~700 px) avant le contenu | Bandeau horizontal défilant, lien actif centré ; colonne inchangée sur grand écran |
| Tableau de bord | Compteur « Conversations » plafonné à 4 (liste tronquée) | Compteur exact |
| Mes annonces | Suppression et « Vendue » via `confirm()` natif (un clic suffisait pour retirer une annonce) | Boîte de confirmation du site, texte explicite, bouton rouge pour la suppression |
| Dépôt / modification (Voitures, Locations de vacances, Services testés) | Champs distincts par famille corrects ; listes numérotées non rendues dans l'aide | Rendu des listes numérotées ajouté au Markdown |
| Favoris, Annonces consultées | Corrects (états vides avec action) | — |
| Messagerie (liste) | Correcte | — |
| Conversation | Réponses rapides débordant à 375 px | Retour à la ligne autorisé |
| Achats et ventes | Tableau débordant sur mobile (628 px) ; erreur réseau silencieuse | Cartes sur mobile, tableau sur grand écran ; filtre « En cours / Terminées » ; message d'erreur |
| Détail d'une transaction | Trois `confirm()` natifs (annulation, réception) | Boîtes de confirmation explicites |
| Avis | « Aucun avis » affiché pendant le chargement | État de chargement |
| Paramètres | E-mail, nom d'utilisateur et nom invisibles ; notifications limitées à deux cases ; bouton pro d'une autre couleur | Section « Identifiants » ; **préférences de notification** 5 familles × in-app / push / e-mail / SMS ; boutons harmonisés ; lien vers le profil public ; retours (toast) sur déblocage et export |
| Passage en pro, Ma boutique | Corrects ; lien croisé Paramètres ↔ Boutique | Lien « Équipe et import » ajouté |
| Formule, Paiements, Notifications, Mes recherches | Corrects | Confirmation de résiliation via la boîte du site |

### 9.3 Back-office

| Page | Constat | Correction |
|---|---|---|
| Console (toutes les pages) | Sur mobile, colonne de 8 liens occupant tout l'écran ; page qui défile horizontalement (utilisateurs 716 px, réglages 879 px, fiche utilisateur 523 px) | Bandeau de navigation horizontal collant ; `min-width: 0` sur la zone de contenu ; tableaux défilants dans leur panneau |
| Tableau de bord | Correct | — |
| Utilisateurs (liste, fiche) | Aucun état de chargement ni d'erreur (tableau vide silencieux) ; `confirm()` natifs | « Chargement… », message d'erreur, message vide précis ; boîtes de confirmation (suspension, mot de passe temporaire) |
| Annonces (liste, fiche) | Idem | Idem (retrait d'annonce) |
| Signalements, Litiges | Idem ; « Aucun signalement » ambigu | États ; « la file est vide » / « aucun litige en cours » ; confirmations de décision |
| Journal d'audit | Pas d'état | États |
| Réglages (monétisation, formules) | `confirm()` natif sur l'interrupteur global | Boîte de confirmation ; tableau des formules défilant |
| Pages légales (CMS) | Correct | — |

### 9.4 Cohérence visuelle

- Dix `confirm()` natifs (site et console) remplacés par une boîte de dialogue unique
  (`ConfirmProvider`), même modale et mêmes boutons que le reste du site.
- Boutons d'action principale tous en `btn-primary` (le bouton « Activer le compte
  professionnel » était sombre) ; onglets et filtres inchangés (déjà uniformes).
- Espacements de page réduits sous 720 px ; utilitaires `only-mobile` / `only-desktop`.
- Palette claire conservée sur le site public ; le back-office garde son identité ardoise/indigo.
- Reste connu : les styles en ligne restent nombreux dans les pages du compte ; ils utilisent
  tous les jetons du design system, la dette est de lisibilité, pas d'apparence.

### 9.5 Comparaison fonctionnelle élargie (point 3 du brief)

Détail dans `analyse-concurrentielle.md` §11. Fait : partage (lien, WhatsApp, e-mail,
Facebook, X, natif), annonces similaires **et** autres annonces du vendeur, historique (vérifié,
déjà en place) + reprise sur l'accueil, centre d'aide structuré, préférences de notification par
famille et canal (API testée, 6 tests), export RGPD (déjà en place, complété). Non repris et
documenté : « Voir le numéro » (choix : pas de téléphone public), simulation de crédit, bons
plans, étiquettes transporteur (avec le paiement réel). Limite : les canaux exacts du partage
leboncoin n'ont pas pu être observés (bandeau cookies) ; l'existence du bouton l'a été.

### 9.6 Preuves

- SQLite : 14 suites, 94 tests (93 passés, 1 ignoré — plein texte PostgreSQL). PostgreSQL
  (PGlite, migrations dont `NotificationPrefs`) : 94 tests passés.
- `next build` vert (routes `/aide/[slug]` pré-rendues).
- Navigateur : 35 pages sans débordement horizontal à 375 px après corrections ; menu Partager,
  recherche d'aide, article d'aide, préférences de notification (aller-retour API), boîte de
  confirmation, bloc « autres annonces de ce vendeur » (4 cartes) vérifiés en direct.


---

## 10. Tests navigateur de bout en bout (Playwright) — 14 septembre 2026, soir

**Objectif** : ne plus dépendre de vérifications manuelles à chaque évolution. 22 scénarios
utilisateur (6 fichiers, deux tailles d'écran) tournent dans Chromium contre **l'API compilée**
(`dist/main.js`, SQLite jetable, fournisseurs simulés — aucun des quatre points différés n'est
touché) et **le front construit** (`next build` + `next start`), localement (`npm run e2e`, ≈ 45 s)
et dans la CI GitHub (job `e2e-navigateur`, à chaque push et pull request ; `deploy-render` en
dépend, donc un scénario rouge bloque la mise en production).

| Parcours demandé | Scénario | État |
|---|---|---|
| 1. Inscription particulier complète, doublon refusé | `02-inscription` : formulaire complet, confirmation de mot de passe, doublon e-mail puis téléphone avec les messages exacts | [exécuté] desktop + mobile |
| 2. Inscription pro, SIRET valide et invalide | `02-inscription` : clé de contrôle fausse (bouton inactif), SIRET absent du registre simulé (refus API), SIRET actif (compte pro, badge « vérifié au registre ») | [exécuté] desktop + mobile |
| 3. Connexion, déconnexion, accès refusé après | `03-connexion` : mauvais mot de passe, e-mail puis username, déconnexion → accueil, jeton effacé, `/compte/annonces` et `/admin` renvoient vers la connexion, un membre non admin est renvoyé de la console | [exécuté] |
| 4. Dépôt avec photos, 2 catégories | `04-depot` : Voitures (marque, modèle, année, kilométrage, carburant, boîte obligatoires ; 2 photos ; code postal) et Locations de vacances (type d'hébergement, voyageurs, piscine, prix par semaine ; 1 photo ; commune choisie) | [exécuté] |
| 5. Recherche : mot-clé, catégorie, Toute la France, rayon, tri | `01-recherche` : 5 scénarios, rayon 5 km (3 annonces, ordre par distance) puis 1 km (1 annonce) autour de Lyon 3e, tri prix vérifié sur toute la liste | [exécuté] desktop + mobile |
| 6. Parcours acheteur complet | `05-achat` : deux navigateurs simultanés, contact, message reçu par WebSocket sans rechargement dans les deux sens, achat simulé (395 €), code de remise, réception confirmée, avis 5/5 visible côté vendeur, annonce « vendue » | [exécuté] |
| 7. Back-office | `06-admin` : connexion admin, refus impossible sans motif, refus avec motif → annonce hors résultats, journal alimenté ; signalement déposé par un membre → traité avec retrait de l'annonce → file vide | [exécuté] |
| 8. Mobile 375 px et desktop | projet `mobile` (Pixel 5, 375 px) joué en premier sur inscription et recherche, projet `desktop` (1280 px) sur tout ; contrôle d'absence de défilement horizontal après rendu | [exécuté] |

**Preuve que chaque test teste quelque chose (mutations volontaires, code restauré ensuite)** :

| Mutation | Scénario attendu en échec | Résultat |
|---|---|---|
| M1 message de doublon d'e-mail modifié (API) | 02 particulier | échec détecté |
| M2 SIRET « inconnu » du registre simulé devient vérifié (API) | 02 professionnel | échec détecté |
| M3 plus de redirection des pages protégées vers la connexion (front) | 03 après déconnexion | échec détecté |
| M4 photos en attente jamais envoyées (front) | 04 voiture et vacances | échec détecté |
| M5 rayon des filtres ignoré (front) | 01 rayon, desktop et mobile | échec détecté |
| M5b tri « prix croissant » ignoré (API) | 01 tri | **non détecté au premier essai** (l'annonce la moins chère était aussi la plus récente) → test renforcé : toute la liste doit être ordonnée → détecté |
| M6 messages WebSocket ignorés (front) | 05 temps réel | **non détecté au premier essai** : la resynchronisation « inbox » (rechargement REST à chaque réveil) faisait apparaître le message quand même ; mutation étendue aux deux canaux → détecté. Le comportement testé reste « le message apparaît sans rechargement » |
| M7 refus d'annonce sans effet (API) | 06 refus | échec détecté |
| M8 élément de 600 px sur l'inscription (front) | 02 mobile, contrôle de débordement | **non détecté au premier essai** : (1) le contrôle tournait sur le squelette vide avant l'hydratation, (2) en émulation mobile `window.innerWidth` s'élargit au contenu débordant ; contrôle déplacé après rendu et mesuré sur `clientWidth` → détecté (« la page défile horizontalement (621 > 375) ») |

**Quatre défauts réels trouvés par les tests et corrigés** :
1. Sélecteur de localisation : un **clic réel** sur un palier de rayon (« 1 km ») était perdu — le
   champ perdait le focus au `mousedown`, la liste se réorganisait et le `mouseup` tombait
   ailleurs. Invisible aux vérifications par script des tours précédents. Corrigé
   (`onMouseDown` préventif sur le panneau, fermeture propre par « Valider » ou clic ailleurs).
2. Déconnexion depuis une page du compte : course entre le retour à l'accueil et la garde
   `RequireAuth`, qui renvoyait vers `/connexion?next=…`. Corrigé (état `loggingOut`).
3. Cases « oui/non » des critères de dépôt (piscine, wifi…) sans lien avec leur libellé ; le
   bouton du menu compte sans nom accessible. Corrigés (`id` et `aria-label`).
4. Déconnexion : le jeton local restait lisible jusqu'à la réponse du serveur (vu en CI, où le
   scénario a échoué une fois sur deux). La session locale est désormais effacée avant l'appel.

**CI** : premier passage du job navigateur vert sur Linux (run 34844305559) ; les deux runs suivants
ont été bloqués respectivement par Jest (qui ramassait les fichiers Playwright) puis par le défaut 4,
déploiement Render **ignoré** les deux fois comme prévu ; run 34844951580 entièrement vert, version
1.3.1 déployée et vérifiée par `/health`.

**Limites connues** : un seul navigateur (Chromium) ; scénarios dépendants d'un ordre (un seul
worker, base partagée, le projet mobile passe avant les mutations de données de l'achat et de
l'admin) ; le paiement est simulé (`PAYMENT_PROVIDER=mock`), comme en bêta ; pas de Firefox/WebKit
ni de test de la carte Leaflet.


---

## 11. Accessibilité et performance — 14 septembre 2026, soir

Périmètre : site public et espace compte (le back-office garde son identité, non audité ici). Aucun
des quatre points de configuration différés n'a été touché.

### 11.1 Méthode

- **Automatique** : axe-core (règles WCAG 2.0/2.1 A et AA + bonnes pratiques) sur 28 pages (12
  publiques, 16 du compte), en 1280 px, sur le front construit ; Lighthouse 12 (mobile simulé et
  desktop) sur accueil, résultats et détail d'annonce ; arbre d'accessibilité (ordre de lecture d'un
  lecteur d'écran) des parcours recherche, dépôt et messagerie.
- **Manuel, reproduit dans les tests** : navigation au clavier seul sur les parcours critiques
  (`e2e/08-clavier.spec.ts`), lecture de l'arbre d'accessibilité.
- **Surveillance continue** : `e2e/07-accessibilite.spec.ts` rejoue axe sur 26 pages et états
  (panneau de localisation ouvert, boîte de dialogue, étapes du dépôt) à chaque push, zéro violation
  tolérée ; `08-clavier` vérifie les parcours clavier. Les deux ont **échoué sur du vrai** à leur
  première exécution (rôles ARIA invalides du sélecteur de communes, liens sans nom, `aria-label` sur
  des `span`) avant les corrections : ils détectent bien ce qu'ils surveillent.

### 11.2 Constat initial (axe, avant corrections)

| Règle | Impact | Occurrences | Cause |
|---|---|---|---|
| link-name | sérieux | 72 (3 par page) | liens « Mes recherches / Favoris / Messages » de l'en-tête sans texte visible sous 1400 px |
| button-name | critique | 24 | bouton « Catégories » de l'en-tête (texte masqué) |
| heading-order | modéré | 24 + 12 | h4 du pied de page après un h1 ; sections h3 sous h1 dans le compte et l'annonce |
| document-title, html-has-lang, landmark, region | sérieux / modéré | 3 pages | pages à rendu serveur (annonce, vendeur, CGU) en erreur 500 pendant l'audit (API injoignable depuis le processus Next lancé à la main : diagnostic ajouté, voir 11.4) ; page 404 hors des points de repère |
| color-contrast | — | **0** | la palette (texte #1f2933 / #616e7c sur blanc et #f5f7f9, accent #0f7b5f, pastilles) est conforme AA sans changement |
| image-alt | — | **0** | images décoratives en `alt=""` dans des liens nommés, photo principale décrite |

Après une première passe, axe a encore révélé : boutons imbriqués dans des `role="option"`
(sélecteur de communes et de localisation), champ texte portant des attributs ARIA non permis,
liens-images des cartes « Mes annonces » sans nom, `aria-label` sur un `span` sans rôle (note en
étoiles), vignettes du dépôt dans une liste sans `listitem`, page conversation sans h1, en-tête de
colonne vide dans le tableau des transactions.

### 11.3 Corrections

**Clavier et lecteur d'écran**
- Lien d'évitement « Aller au contenu » (premier élément tabulable, visible au focus) vers
  `<main id="contenu">`.
- En-tête : noms accessibles des liens et du bouton Catégories (avec le nombre de non-lus), Échap
  referme les menus et rend le focus au bouton, `aria-controls` sur les menus.
- Boîte de dialogue commune (`Modal`) : titre relié (`aria-labelledby`), focus placé sur le
  premier champ à l'ouverture, tabulation confinée, Échap, retour du focus à l'élément d'origine.
  Utilisée par toutes les modales du site (contact, achat, signalement, confirmations…).
- Sélecteur de localisation : `combobox` ouvrant une fenêtre (`aria-haspopup="dialog"`,
  `aria-controls`), suggestions en boutons, Échap depuis le champ **ou** le panneau, curseur de rayon
  avec `aria-valuetext` (« 1 km ») réglable aux flèches. Saisie de commune du dépôt : `combobox` +
  `listbox` dont les options sont focusables et se valident à Entrée ou Espace, fermeture au départ
  du focus (plus de `setTimeout` sur le blur).
- Zones vivantes : nombre de résultats (`aria-live="polite"`), journal de conversation
  (`role="log"`), notifications éphémères (`role="status"`), compteur de photos de la galerie.
- Messagerie : h1 (masqué visuellement) « Conversation avec … à propos de … », lien de l'annonce
  nommé, bouton photo nommé (pictogramme masqué), indicateur « en direct » lisible.
- Dépôt : cases « oui/non » reliées à leur libellé, champ fichier atteignable au clavier (rendu
  hors écran au lieu de `hidden`), vignettes en liste avec boutons « Avancer / Reculer la photo n »
  (réordonnancement sans souris, en plus du glisser-déposer), `alt` « Photo n (couverture) ».
- Hiérarchie : sections du compte et de l'annonce en h2 (même taille qu'avant via `.h3`), pied de
  page en h2, Markdown des pages CMS et de l'aide rendu en h2/h3 sous le h1 ; page 404 dans la mise
  en page du site (en-tête, `main`, pied de page) ; note en étoiles en `role="img"`.
- Cartes d'annonce : `alt` = titre, `decoding="async"`, image principale de la galerie en
  `fetchpriority="high"`.

**Performance**
- Vignettes : chaque photo d'annonce est stockée en deux tailles (original ≤ 1600 px, vignette
  480 px, `thumbUrl`, migration `PhotoThumbnails`) ; les listes, l'accueil et les miniatures de la
  galerie chargent la vignette (≈ 10 fois plus légère, test `phase7`). Les photos antérieures
  gardent l'original (champ nul).
- Carte de l'annonce chargée seulement à l'approche de la section (`IntersectionObserver`,
  120 px) : ≈ 270 Ko de tuiles et de code Leaflet en moins au chargement initial.
- Résultats de recherche : squelette de secours à la hauteur de la page, compteur à hauteur
  réservée → décalage cumulé (CLS) de 0,22 à 0.
- Cause technique d'un échec de fetch côté serveur journalisée (`[api] … injoignable : ECONNREFUSED`)
  au lieu d'un message muet.

### 11.4 Scores Lighthouse (front construit, API locale, réseau simulé « 4G lent » en mobile)

| Page | Écran | Avant : perf / a11y / BP / SEO | Après : perf / a11y / BP / SEO | LCP après | CLS avant → après | Poids avant → après |
|---|---|---|---|---|---|---|
| Accueil | mobile | 97 / 100 / 96 / 100 | **99 / 100 / 100 / 100** | 2,2 s | 0 → 0 | 296 → 304 Ko |
| Accueil | desktop | 77 / 100 / 100 / 100 | **83 / 100 / 100 / 100** | 2,9 s | 0,002 → 0,002 | 350 → 362 Ko |
| Résultats | mobile | 86 / 100 / 100 / 100 | **93 / 100 / 100 / 100** | 3,2 s | **0,22 → 0** | 298 → 291 Ko |
| Résultats | desktop | 76 / 100 / 100 / 100 | **77 / 100 / 100 / 100** | 3,2 s | **0,135 → 0,002** | 348 → 343 Ko |
| Annonce | mobile | 96 / 99 / 100 / 100 | **97 / 100 / 100 / 100** | 2,5 s | 0 → 0 | **577 → 305 Ko** |
| Annonce | desktop | 81 / 99 / 100 / 100 | **85 / 100 / 100 / 100** | 2,5 s | 0,019 → 0,019 | **703 → 363 Ko** |

Le score « bonnes pratiques » de l'accueil (96 → 100) tenait à une erreur d'hydratation React
(date relative « à l'instant » calculée à des instants différents côté serveur et client) : corrigée
(`suppressHydrationWarning` sur la date).

**Ce qui reste et pourquoi** : le LCP desktop (2,5–3,2 s en simulation) vient du CSS bloquant
(≈ 300 ms, trois feuilles Next) et du JavaScript de la page ; le gain suivant demande l'inline du CSS
critique ou une réduction du bundle client des pages (composants de recherche et de formulaire en
client), chantier disproportionné pour une bêta entre proches. Les images de production n'étaient
pas mesurables ici (base de test sans photos) ; la vignette 480 px s'applique aux nouveaux envois.

### 11.5 Non couvert et limites

- Lecteur d'écran réel (NVDA, VoiceOver) non lancé : l'arbre d'accessibilité et la navigation
  clavier ont été vérifiés par Playwright, ce qui couvre la structure et les noms, pas la prosodie
  ni les raccourcis propres à chaque lecteur.
- Glisser-déposer des photos non accessible en soi (les boutons Avancer / Reculer le remplacent).
- Carte Leaflet : non utilisable au clavier ni au lecteur d'écran (contenu redondant avec la ville
  affichée en texte).
- Back-office : non audité (identité distincte, usage interne).


---

## 12. Back-office accessible, SEO, ménage, test de charge — 14 septembre 2026, nuit

### 12.1 Accessibilité du back-office

Même méthode que le site public (§11) : axe-core sur les 10 pages de la console, connecté comme
administrateur, avec un signalement et un litige réels dans les files ; navigation au clavier.

| Constat initial (axe) | Occurrences | Correction |
|---|---|---|
| color-contrast | 41 | palette du back-office reprise : texte secondaire #556270 (5,0:1), pastilles ok / warn / danger en texte foncé sur fond pâle (≥ 7:1), boutons verts et rouges assombris, bandeau rouge #b91c1c |
| label (champs sans libellé) | 28 | tableau des formules : chaque champ nommé avec la formule concernée (« Prix mensuel de la formule Pro »…) ; éditeur CMS nommé |
| select-name | 9 | tous les filtres des listes nommés (type de compte, statut, catégorie, action associée…) |
| region (contenu hors point de repère) | 10 | bandeau d'avertissement en `<header>`, colonne de navigation nommée |
| empty-table-header | 5 | colonnes « Photo » et « Actions » nommées pour les lecteurs d'écran |
| heading-order | 4 | sections en h2 sous le h1 de chaque page |

Après corrections : **0 violation** sur les 10 pages. Surveillance : `e2e/09-admin-accessibilite.spec.ts`
(axe sur la console + suspension et réactivation d'un compte **au clavier seul**, boîte de
confirmation comprise, trace vérifiée dans le journal).

### 12.2 Référencement

- **Sitemap** : généré à la demande (il était figé au build, donc vide de catégories quand l'API
  n'était pas joignable au moment du build) ; couvre accueil, recherche, 12 familles et toutes les
  sous-catégories, 22 articles d'aide, CGU, confidentialité, mentions légales (manquaient), à propos,
  50 dernières annonces ; aucune page privée. Vérifié en production : 100+ entrées.
- **robots.txt** : `/admin`, `/compte`, `/connexion`, `/deposer` exclus, sitemap déclaré. Inchangé, vérifié.
- **Titres et descriptions** : les pages de catégorie ont désormais leur propre titre
  (« Vélos : annonces d'occasion (Loisirs) »), description et canonique ; les pages légales
  tirent leur description de leur premier paragraphe ; connexion, inscription, dépôt, mot de passe
  oublié, réinitialisation, SMS ont une description propre (et restent `noindex`) ; les recherches
  par mot-clé sont `noindex` (contenu dupliqué).
- **JSON-LD** : `Product` de l'annonce relu après les changements récents (photos, vendeur, vente) :
  toujours valide, complété par `url`, `sku`, `category`, `offers.url` et `offers.seller`
  (Person ou Organization) ; ajout d'un `BreadcrumbList` (Accueil › famille › catégorie › annonce)
  et, sur l'accueil, `WebSite` avec `SearchAction` + `Organization`.
- Surveillance : `e2e/10-seo.spec.ts` (sitemap, robots, unicité titre + description sur 14 pages,
  `noindex` des pages privées, JSON-LD parsé et contrôlé champ par champ).

### 12.3 Ménage du dépôt

Supprimés : `maquette-premium.html` (maquette d'avant le front Next, jamais référencée),
`public/index.html` (interface de test interne de la phase 1, servie hors production ; le code de
service statique correspondant est retiré de `main.ts`), `test/ws-smoke.js` (vérification manuelle
du temps réel, remplacée par le scénario Playwright `05-achat`), `frontend/README.md` (texte
par défaut de create-next-app). Les scripts `patch-*.js` cités dans le brief n'ont jamais été
dans le dépôt : ils vivaient dans l'espace de travail temporaire de l'assistant. Conservé :
`test/seed-demo.js` (données de démonstration locales, documenté dans le README).
README revu : règle du numéro de mobile (vérification SMS différée, plus « vérifié par SMS »),
production à jour (Vercel en ligne, déploiement automatique), premier administrateur, plus de
mention du parcours OTP comme parcours principal. `AUDIT.md` (état consolidé) et
`AUDIT-HISTORIQUE.md` (journal des phases 1 à 8) restent complémentaires : l'historique
signale les scripts retirés.

### 12.4 Test de charge léger en production

`node scripts/charge.js --api https://trocoin.onrender.com --front https://trocoin.vercel.app --vus 10 --minutes 3`
(script sans dépendance, lectures publiques uniquement, temps de réflexion 0,8–3 s entre pages).
Exécuté le 14 septembre 2026 à 14:36 UTC (16:36 à Paris, aucun utilisateur réel sur le site),
contre les 2 annonces réelles de la base Neon.

| Point d'entrée | Requêtes | Erreurs | p50 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| API /categories/tree | 210 | 0 | 57 ms | 129 ms | 340 ms | 436 ms |
| API /listings?q= | 210 | 0 | 159 ms | 389 ms | 770 ms | 1 007 ms |
| API /listings?category= | 70 | 0 | 358 ms | 455 ms | 710 ms | 710 ms |
| API /listings (récentes) | 156 | 0 | 365 ms | 1 068 ms | 1 648 ms | 2 010 ms |
| API /listings/:id | 210 | 0 | 557 ms | 982 ms | 2 240 ms | 3 004 ms |
| API /listings/:id/similar | 210 | 0 | 555 ms | 980 ms | 1 233 ms | 1 850 ms |
| Front /annonces/:id (rendu serveur) | 210 | 0 | 931 ms | 2 038 ms | 2 376 ms | 2 577 ms |
| Front /recherche | 98 | 0 | 68 ms | 157 ms | 208 ms | 208 ms |

1 374 requêtes en 187 s (7,3 req/s), **0 erreur**, **aucun redémarrage** (uptime passé de 292 à
480 s), aucune erreur de connexion à la base : le pool (`DB_POOL_MAX=5`) suffit largement à
10 utilisateurs simultanés, contrairement à PGlite (1 connexion) rencontré en développement.

**Lecture** : pas de dégradation anormale (les latences n'augmentent pas au fil du test), mais
la fiche d'annonce est lente en absolu (p50 ≈ 0,55 s API, ≈ 0,9 s rendue) : chaque requête vers
Neon traverse l'Atlantique (base en `us-east-2`, API Render en Europe), et une fiche enchaîne
plusieurs requêtes. C'est l'effet direct de la région Neon différée (§6) : la migration vers
Francfort devrait diviser ces temps par 3 à 5 sans autre changement. Deux index composites
(`status, publishedAt` et `rootCategoryId, status, publishedAt`, migration
`ListingsSearchIndex`) ont été ajoutés pour que le tri par date des listes ne dépende plus d'un
tri en mémoire quand le catalogue grossira.

### 12.5 Jugement : ce qui valait encore la peine, et ce qui ne vaut plus

Fait dans ce tour, sans compte externe : index composites de recherche (ci-dessus) et
**Dependabot** (`.github/dependabot.yml` : mises à jour npm de l'API et du front groupées chaque
lundi, actions GitHub chaque mois ; chaque proposition passe la CI complète, tests navigateur
compris, avant fusion).

Ce qui reste et qui **ne dépend que des quatre points différés ou de vrais utilisateurs** :
la latence de la base (région Neon), la persistance des photos (R2), les e-mails (fournisseur),
les paiements réels ; et tout ce qui touche à l'usage réel (quels filtres servent, quelles
catégories manquent, où les testeurs butent). Je n'identifie plus de chantier technique
substantiel qui serait raisonnable sans ces éléments : les suites (94 tests API, 46 scénarios
navigateur, axe, clavier, SEO, charge) couvrent ce qui peut l'être, et ajouter du code sans
retour d'usage produirait des fonctionnalités inventées. Point d'attention pour plus tard,
non urgent : les styles en ligne du compte (lisibilité), et l'inline du CSS critique pour le
LCP desktop (§11.4).

---

## 13. Messagerie : cartes cliquables, « Vu », « en train d'écrire », non-lus en gras — 14 septembre 2026, nuit

- **Soulignement au survol / clic** : la carte de conversation est un lien entier ; le style
  global `a:hover { text-decoration: underline }` soulignait tout son contenu. Règle dédiée
  (`a.card` et descendants sans soulignement), survol par fond gris clair, badge conservé.
  leboncoin fait de même (ligne entière cliquable, aucun soulignement, fond au survol). Vérifié par
  le scénario : survol puis clic dans un coin vide de la carte → conversation ouverte, aucune
  décoration de texte sur aucun descendant.
- **« Vu à HH:MM »** : quand le destinataire affiche la conversation (ouverture de la page ou
  réception d'un message pendant qu'elle est ouverte), les messages reçus sont marqués lus et le
  serveur diffuse un évènement `read` (WebSocket, room de la conversation) ; l'expéditeur voit
  « · Vu à 17:12 » sous son dernier message sans rechargement (« · Envoyé » tant que ce n'est pas
  lu). Aucune interrogation périodique : l'accusé est émis depuis le service quel que soit le canal
  de lecture (HTTP ou WebSocket), une seule fois par lot de messages.
- **« X est en train d'écrire… »** : l'évènement `typing` est relayé aux autres membres de la
  room (jamais stocké, jamais renvoyé à l'émetteur, refusé sans avoir rejoint la room) ; côté
  client, envoi au plus toutes les 1,5 s pendant la frappe, arrêt après 2,5 s sans saisie ou à
  l'envoi ; côté destinataire, l'indicateur (points animés, zone `role="status"`) disparaît après
  4 s sans nouvel évènement ou dès que le message arrive.
- **Non-lus en gras** : dans la boîte, une conversation avec messages non lus affiche nom, titre
  d'annonce, aperçu et heure en gras avec un point vert (modèle Messenger), nom accessible
  « 1 non lu, conversation avec … » ; retour au poids normal dès qu'elle a été ouverte. L'aperçu
  précise « Vous : » quand le dernier message est le vôtre.
- **Mobile** : en-tête de conversation revu (actions sur leur propre ligne sous 600 px, nom sans
  césure) ; captures 375 px et 1280 px vérifiées, aucun débordement.

**Preuves** : `test/phase12` (3 tests, deux clients socket.io : accusé de lecture déclenché par
l'ouverture HTTP et par l'évènement WebSocket, pas d'accusé sans nouveau message, frappe relayée
et jamais renvoyée à soi-même, refus hors room et pour un tiers) ; scénario Playwright
`05-achat` étendu avec deux navigateurs (« Envoyé » → « Vu à », indicateur de frappe qui
apparaît puis disparaît seul, carte en gras puis normale, clic hors texte, absence de soulignement).
46 scénarios navigateur et 97 tests API verts.

---

## 14. Cartes d'annonce : hiérarchie visuelle alignée sur leboncoin — 14 septembre 2026, soir

**Problème signalé** : le prix des cartes (« 8 000 € à débattre ») était affiché en grand
(1,15 rem, police de titre) et en vert, alors que leboncoin le montre foncé, gras et compact.

**Relevé sur leboncoin.fr** (styles calculés dans le DOM, session non connectée ; l'utilisateur
confirme que l'affichage connecté est identique) :

| Élément | leboncoin (cartes en grille, page annonce / carrousels) | leboncoin (liste de résultats, bureau) |
|---|---|---|
| Carte / photo | 130 × 346 px, photo 130 × 163 px (portrait 4/5) | 750 × 192 px, photo 240 × 192 px à gauche |
| Titre | `p` 16 px / 700, foncé rgb(21 34 51), interligne 24 px, 2 lignes max | 16 px / 700 |
| Prix | `span` 16 px / 700, **même foncé que le titre** ; vert + icône flèche uniquement en cas de « Baisse de prix » ; « Don (gratuit) » 14 px / 700 | 16 px / 700 foncé |
| « à débattre » | **n'existe pas** (ni sur carte ni sur fiche : leboncoin propose « Faire une offre ») | — |
| Cœur favori | bouton 32 × 32 px blanc rond, icône 16 px gris rgb(58 71 87), à 8 px du haut et de la droite de la photo | idem |
| Nombre de photos | **absent** des cartes (seulement « 1/2 » sur la fiche) | absent |
| Badge Pro | — | 12 px / 700, angles 4 px, dans le corps de la carte |
| Livraison | icône colis 16 px seule, en bas de carte | ligne 12 px « Livraison à 15 € » avec icône |
| État / description | **absents** des cartes (l'état est sur la fiche, « Les informations clés ») | ligne catégorie 12 px / 400 |
| Bas de carte | « Lyon 69008 » puis date de dépôt, 12 px / 400 gris rgb(58 71 87), chacune sur sa ligne, calées en bas | « Lyon 69002 » 12 px / 400 |
| Date de dépôt | « aujourd'hui à 17:41 », « samedi dernier à 19:11 », puis « 01/09/2026 » | — |
| Urgent / À la une | 12 px / 700, angles 4 px, à 8 px du coin haut gauche de la photo | idem |

**Ce qui a changé** (`ListingCard.tsx` / `.module.css`, `FavoriteButton` compact, `format.ts`),
palette Trocoin conservée :

- Photo en portrait 4/5 (au lieu de 4/3), cœur 32 px blanc rond sans bordure à 8 px du coin,
  étiquettes Urgent / À la une 12 px à angles 4 px, compteur de photos réduit à une icône + nombre
  (12 px, angles 4 px) — conservé car utile, bien qu'absent chez leboncoin.
- Titre 16 px / 700 foncé, 2 lignes max, sans soulignement au survol ; prix 16 px / 700 dans la
  couleur du texte (`--ink`), police de corps, juste sous le titre ; « à débattre » relégué en
  mention 12 px grise à côté du prix (absent chez leboncoin, mais c'est une information de la fiche).
- Ligne secondaire 12 px : badge « Pro » (angles 4 px, bordure), état, « Fiche complète » (coche).
- Bas de carte calé en bas : « Livraison possible » avec icône colis, puis « Ville code postal
  · distance », puis date de dépôt `postedAt()` au format leboncoin (« aujourd'hui à 17:31 »,
  « hier à … », « mardi dernier à … », puis « 01/09/2026 »), toujours en heure de Paris pour un rendu
  identique entre serveur et navigateur.
- Squelette de la page recherche ajusté à la nouvelle proportion.

**Vérification** : le composant étant partagé, mesures relevées par script sur 20 pages × 2 tailles
(accueil, recherche, recherche avec rayon, annonces similaires et annonces du vendeur sur la fiche,
vitrine pro, favoris, historique — connecté et non connecté, 375 px et 1 280 px) : titre 16 px / 700
rgb(31 41 51), prix 16 px / 700 même couleur, mentions 12 px, lieu et date 12 px / 400 gris, cœur
32 × 32 px à 8 px du coin, aucun débordement horizontal. « Mes annonces » garde sa liste dédiée
(pas de carte). La capture d'écran de leboncoin n'a pas pu être prise depuis le navigateur intégré
(page non dessinée tant que la fenêtre est masquée) ; la comparaison repose sur les valeurs
calculées ci-dessus, identiques élément par élément.

**Preuves** : scénario Playwright ajouté dans `01-recherche` (joué en mobile et en bureau) : titre
et prix 16 px / 700 foncés, prix « 890 € », cœur 32 × 32 px à 8 px du coin de la photo, lieu
« Lyon 69003 », date « aujourd'hui à HH:MM » en 12 px gris. 48 scénarios navigateur verts,
97 tests API inchangés.

---

## 15. Les quatre points différés : implémentés et testés contre les vrais services — 14 septembre 2026, nuit

Ordre demandé : base, photos, e-mail, paiement. Chaque volet a été exécuté réellement depuis cette
machine (API compilée, fournisseurs réels) ; ce qui dépend du tableau de bord Render est listé en
fin de section. Aucun secret n'est écrit dans ce dépôt.

### 15.1 Base de données — Neon Frankfurt (eu-central-1)

- **Schéma** [exécuté] : les 8 migrations exécutées sur le nouveau projet (PostgreSQL 18, aller-retour
  23 ms depuis cette machine). Tables présentes, base vide.
- **Copie des données** : `scripts/migrer-base.js` (pilote `pg`, aucun outil externe) : vérifie
  les migrations de la cible, ordonne 23 tables par clés étrangères, vide la cible, copie par lots
  dans une transaction, remet les séquences, puis compare **comptage et empreinte md5 du contenu**
  de chaque table. **Répétition à blanc** [exécuté] : source PGlite remplie par l'API (3 comptes,
  3 annonces avec photos, conversation, transaction complète, avis, signalement, favoris) →
  Frankfurt : 23 tables « identique », sortie 0 ; cible ensuite vidée.
- **Copie réelle US → EU** [exécuté] le 14 septembre à 22:43 UTC (URL US fournie par vous) :
  23 tables, comptages et empreintes md5 identiques (2 comptes, 3 annonces, 9 photos, 1 conversation,
  5 messages, 7 notifications, 18 jetons de session, 71 catégories…). Deux corrections du script au
  passage : les valeurs transitent en texte transtypé (le pilote `pg` arrondissait les dates à la
  milliseconde, `…27.095503` devenait `…27.095`) et les réglages de rendu sont posés dans la
  transaction de chaque empreinte (un pooler en mode transaction ignore les SET de session).
  Aucune écriture n'est survenue sur la base US entre la copie et la bascule, hormis des compteurs
  de vues dus à mes propres tests (non repris : Frankfurt 301 vues sur l'annonce test, US 513).
- **Bascule** [exécuté] le 15 septembre vers 00:55 UTC (variable `DATABASE_URL` changée par vous
  dans Render ; le premier enregistrement n'avait pas pris, le redéploiement suivant oui).
  Preuves : `/health` → `databaseRegion: eu-central-1` (champ ajouté pour cela) ; une
  consultation d'annonce en production incrémente le compteur de vues dans Frankfurt (300 → 301)
  et plus dans la base US (513 → 513) ; les 2 comptes sont présents, le chemin de connexion répond
  401 standard sur un mauvais mot de passe, les 12 catégories sont servies. Vous vous êtes
  reconnecté avec votre compte habituel. La base US n'a pas été touchée (lecture seule).
- **Latence après bascule** [exécuté] : `scripts/charge.js` à 3 utilisateurs virtuels pendant
  3 min (le limiteur de débit, qui voit désormais la vraie IP grâce à `TRUST_PROXY`, bloque à
  100 req/min/IP une charge de 10 utilisateurs depuis une seule machine — 429 constatés puis test
  ramené à 3), 524 requêtes, 0 erreur, aucun redémarrage :

  | Point d'entrée | p50 avant (US, §12.4) | p50 après (Frankfurt) | p95 après |
  |---|---|---|---|
  | API /listings/:id | 557 ms | **56 ms** | 81 ms |
  | API /listings/:id/similar | 555 ms | 56 ms | 74 ms |
  | API /listings (récentes) | 365 ms | 59 ms | 110 ms |
  | API /listings?q= | 159 ms | 53 ms | 63 ms |
  | API /listings?category= | 358 ms | 59 ms | 83 ms |
  | API /categories/tree | 57 ms | 50 ms | 58 ms |
  | Front /annonces/:id (rendu serveur) | 931 ms | 401 ms | 770 ms |

### 15.2 Photos — Cloudflare R2

- Code : `S3_PUBLIC_URL` devient facultative ; sans elle, `GET /uploads/<uuid>[-min].<ext>` relaie
  l'objet depuis le bucket avec cache 1 an (`MediaController`, hors quota de requêtes). Bug corrigé :
  les vignettes `-min` n'étaient jamais supprimées du bucket (motif de clé trop strict).
- Tests : `phase9` +2 (vignette supprimée avec l'annonce ; mode sans URL publique : URL relatives,
  relais 200 `image/png` + cache, 404 après suppression).
- **Réel** [exécuté] sur le bucket `trocoin-photos` via l'API locale : 2 photos envoyées →
  4 objets (photo + vignette ×2) présents dans R2 ; `GET /uploads/…jpg` → 200 `image/jpeg`,
  `cache-control: public, max-age=31536000, immutable`, JPEG 1400×1000 ; vignette 480×343 ;
  `coverUrl` de la carte publique = vignette ; suppression de l'annonce → 0 objet restant, 404.

### 15.3 E-mail — Resend

- Code : `ResendEmailProvider` (`POST https://api.resend.com/emails`, jeton Bearer, délai 10 s,
  raison du refus journalisée, 503 neutre pour l'utilisateur). Hors production, le dernier lien
  envoyé reste lisible par `GET /dev/last-reset-link/:email` pour vérifier un envoi réel.
- Tests : `phase6` +2 (requête exacte vers un faux Resend ; 403 → `EmailDeliveryError`).
- **Réel** [exécuté] : `POST /auth/password/forgot` avec `EMAIL_PROVIDER=resend` → appel réel
  authentifié. Vers `ousbaali11@gmail.com`, Resend répond **403 « You can only send testing
  emails to your own email address (trocoin2026@gmail.com) »** : la clé est celle du compte Resend
  `trocoin2026@gmail.com` et l'expéditeur de test `onboarding@resend.dev` n'autorise que cette
  adresse. **Envoi réel vers l'adresse du compte, autorisé explicitement le 15 septembre** : accepté
  par Resend (identifiant de message `41867516-d468-4476-9633-8e908522c38f`), lien reçu par le
  serveur identique à celui envoyé, page `/reinitialiser` → 200, réinitialisation acceptée,
  connexion avec le nouveau mot de passe réussie, réutilisation du lien refusée (400). **Pour écrire
  à tous les utilisateurs : vérifier un domaine chez Resend et mettre `EMAIL_FROM` sur ce domaine**
  (`DEPLOIEMENT.md` §5b).

### 15.4 Paiement — Stripe (mode test)

- Code : Stripe **Checkout hébergé** (aucune clé publiable, aucune donnée de carte chez Trocoin)
  avec **capture différée** : `POST /transactions` crée la transaction « en_attente » et renvoie
  `checkoutUrl` ; retour de l'acheteur ou webhook → « sequestre » (vendeur prévenu à ce moment
  seulement) ; réception → capture ; annulation avant envoi → autorisation annulée. Session limitée
  à 30 min, transaction abandonnée annulée (retour, webhook ou tâche toutes les 10 min) ; une page de
  paiement ouverte bloque l'annonce (double vente). Webhook `POST /transactions/webhook/stripe` :
  corps brut (`rawBody`), signature vérifiée (`constructEvent`), évènements completed / expired /
  payment_intent.canceled / charge.refunded, idempotent. Front : redirection vers Checkout, page de
  transaction « Paiement en attente » qui se met à jour seule, retour annulé signalé sur l'annonce.
- Tests : `test/phase13` (6 tests : flux complet avec fournisseur hébergé simulé, montants
  40,40 € / part plateforme 5,44 €, URL visible du seul acheteur, double vente refusée, webhook
  sans/mauvaise signature → 400, completed/expired/refunded/canceled, rejeu idempotent, tâche
  d'expiration, annulation → libération ; **signature Stripe réelle** vérifiée sans réseau avec la
  bibliothèque officielle : forgée, altérée, absente, secret manquant → 400).
- **Réel** [exécuté] contre Stripe en mode test (clé `sk_test`, compte FR) : transaction
  → page Checkout (capture d'écran) → paiement carte 4242 (case « I am an AI agent » cochée) →
  retour sur le site → `sequestre` ; Stripe : session `complete`, PaymentIntent
  `requires_capture`, `capture_method=manual`, 4 040 cts capturables → expédition →
  confirmation de réception → PaymentIntent `succeeded`, 4 040 cts reçus. Seconde transaction
  payée puis annulée par le vendeur → PaymentIntent `canceled`, 0 ct reçu. Les **vrais
  évènements Stripe** de ces paiements (`checkout.session.completed` ×2,
  `payment_intent.canceled`) rejoués sur le webhook local, signés avec le secret de l'endpoint
  → 200 traités ; signature fausse → 400.
- Endpoint webhook **créé sur le compte Stripe** pour la production
  (`we_1UFhaP5YWLqgMw96qQYHFUhZ`, 6 évènements). Vendeur sans compte Connect : la plateforme
  encaisse (reversement manuel) ; avec onboarding Express terminé : destination charge automatique
  (chemin non exécuté ici : l'onboarding Connect exige un parcours KYC dans le navigateur).

### 15.5 Ce qui reste entre vos mains (tableau de bord Render, secrets jamais commités)

Variables à saisir puis redéployer (l'API refuse de démarrer si une variable manque et nomme la
fautive) : `STORAGE_PROVIDER=s3` + les 5 variables R2 ; `EMAIL_PROVIDER=resend` +
`RESEND_API_KEY` + `EMAIL_FROM` ; `PAYMENT_PROVIDER=stripe` + `STRIPE_SECRET_KEY` +
`STRIPE_WEBHOOK_SECRET` ; `SITE_URL=https://trocoin.vercel.app` ; et, après la copie des
données, `DATABASE_URL` (Frankfurt). Puis : « mot de passe oublié » depuis le site (vers l'adresse
du compte Resend tant que le domaine n'est pas vérifié), un achat en carte 4242, `/health`,
`scripts/charge.js`.

**Suites** : 97 → 105 tests API (phase 6 +2, phase 9 +2, phase 13 +6), 48 scénarios navigateur.

---

## 16. Interface : « Toute la France » affiché, cartes réduites d'un tiers, en-tête sur une ligne — 15 septembre 2026

- **« Toute la France » dans le champ « OÙ ? »** : le sélecteur ne conservait ce choix qu'en
  interne (valeur `{ mode: "all" }`, champ vide). Il affiche désormais le libellé comme pour une
  commune, avec la croix d'effacement, sans changer la valeur transmise : la recherche nationale
  était déjà correcte (le scénario existant le vérifiait), seul l'affichage manquait. Scénario
  étendu : choix depuis l'accueil → champ « Toute la France » → recherche sans paramètre de lieu →
  les cinq villes du seed listées ; sans choix explicite, le défaut reste national.
- **Cartes** : photo carrée (1/1 au lieu de 4/5), corps plus compact, grille
  `minmax(160px, 1fr)` (18 px → 14 px d'écart), 2 colonnes conservées sur mobile. Mesuré sur la
  recherche à 1280–1920 px : 279 × 484 px en 3 colonnes → **163 × 331 px en 5 colonnes**
  (−42 % / −32 %) ; accueil 6 colonnes. Coins arrondis 10 px inchangés, titre 16 px gras sur deux
  lignes, aucun texte débordant (vérifié par script). Repli « Pas de photo » quand l'image ne se
  charge pas (les photos d'avant R2 n'existent plus : c'était la grande zone grise des captures).
- **Barre « QUOI ? / OÙ ? »** : 960 × 67 px → **720 × 52 px** (−25 % / −22 %), invites lisibles
  (champs 326 et 203 px, 15 px), empilée sur mobile (335 × 154 px).
- **En-tête bureau sur une ligne** : la navigation compactée (libellés 0,86 rem, boutons 36 px,
  avatar 28 px) et la recherche compacte réduite (36 px, invite « Rechercher ») font tenir logo,
  Catégories, recherche, Mes recherches, Favoris, Messages, compte et Déposer sur **65 px de haut
  à 1280, 1440 et 1920 px**, centres alignés (écart < 4 px). Entre 1100 et 1200 px : icônes seules ;
  sous 1100 px : recherche sur une seconde ligne ; sous 900 px : menu mobile inchangé.
- **Preuves** : `01-recherche` +2 scénarios (en-tête sur une ligne aux trois largeurs + barre
  réduite ; cartes ≤ 215 px de large, ≤ 340 px de haut, ≥ 4 colonnes, 2 sur mobile, sans
  débordement), 51 scénarios navigateur verts. Captures avant/après à 1280, 1440, 1920 px et
  375 px comparées.

---

## 17. Refonte mobile-first en sept sections — 15 septembre 2026

Brief : espacements mobiles, textes, connexion par e-mail, comparatif leboncoin, fluidité, palette,
audit bugs et sécurité. Traité dans l'ordre recommandé, un commit par section, testé à 360, 375,
390 et 414 px.

1. **Espacements mobiles** [exécuté] — cause unique : `.page { padding: 28px 0 64px }` écrasait le
   remplissage horizontal de `.container` (les deux classes sur le même élément), d'où titres,
   cartes, champs et boutons collés aux bords sur toutes les pages « page ». Correction : variable
   globale `--page-padding-x` (20 px, 16 px sous 720 px) appliquée au conteneur, `.page` en
   `padding-block`. Bandeau d'onglets du compte : pleine largeur avec remplissage et espace de fin
   (`::after`), `scroll-padding-inline`. Tableau « Mes dernières annonces » et matrice des
   notifications remplacés par des listes empilables. Preuve : scénario `11-marges-mobile` (pages
   publiques aux quatre largeurs, pages du compte à 375 px : aucun élément à moins de 12 px du bord,
   aucun défilement horizontal, premier et dernier onglets à distance des bords) ; captures
   avant/après envoyées.
2. **Textes** [exécuté] — grep sur `IA|claude|chatgpt|openai|anthropic|généré|lorem|placeholder|
   TODO` : aucune occurrence visible (le seul « todo » est une variable de l'admin). Retiré des
   pages légales les notes de travail (« Modèle à faire valider… », « Modèle à compléter… ») ;
   centre d'aide remis à jour (e-mail actif, connexion par mobile, plus de « back-office ») ;
   « sans friction » → « sans complication » ; « jeton » → « lien incomplet » ; réponse 429 en
   français. Passe exhaustive : pages, centre d'aide (22 articles), textes légaux, 24 textes d'invite
   des champs (tous en français), e-mail de réinitialisation, notifications, messages d'erreur de
   l'API — les messages par défaut de NestJS et de class-validator (anglais) sont désormais traduits
   globalement (`src/common/validation.ts`, filtre d'exceptions), y compris pour un client qui
   contournerait le formulaire. Les mentions légales gardent des champs entre crochets : ce sont vos données
   d'éditeur, à saisir depuis Admin → Pages (aucune valeur inventée).
3. **Connexion** [exécuté] — la connexion par e-mail fonctionnait déjà (insensible à la casse et aux
   espaces, tests phase 5 et scénario 03 verts avant ce tour) ; le brief demandait aussi le mobile.
   `findForLogin` accepte désormais le numéro du compte sous toutes ses écritures ; le formulaire
   signale avant envoi un e-mail incomplet ou un numéro non français ; le message serveur reste
   unique (« Identifiant ou mot de passe incorrect ») pour ne pas révéler l'existence d'un compte.
   Tests : phase 5 (e-mail majuscule, espaces, mobile +33 / 06 / espacé, mauvais mot de passe),
   scénario 03 (e-mail, nom d'utilisateur, mobile dicté, e-mail incomplet).
4. **Comparatif leboncoin** [exécuté] — `docs/comparatif-leboncoin.md` : parcours connecté et
   non connecté, fonctionnalités fines, statut présent / ajouté / non pertinent / différé. Ajouté :
   tri par **pertinence** (score plein texte PostgreSQL puis mises en avant puis fraîcheur).
5. **Fluidité** [exécuté] — apparition douce des cartes et blocs (0,22 s, décalée), enfoncement des
   boutons au clic, rebond du cœur favori, fondu des boîtes de dialogue et menus, transitions
   homogènes ; squelettes de chargement ajoutés au tableau de bord et à la page Formule (les autres
   pages du compte en avaient déjà) ; images déjà en chargement paresseux ; tout est coupé par
   `prefers-reduced-motion`.
6. **Palette et cohérence** [exécuté] — fond `#f6f8f7`, texte `#1f2937`, gris `#5f6b78`
   (contraste ≥ 4,9:1), accent vert inchangé (5,5:1 sur blanc) ; titres en graisse 700 ; sur
   mobile, boutons ≥ 44 px, champs ≥ 46 px avec police 16 px (pas de zoom iOS), texte courant
   ≥ 14 px. Aucun fond sombre. axe : 0 violation (scénario 07).
7. **Audit bugs et sécurité** [exécuté] — `docs/audit-bugs.md` : 11 bugs corrigés dont une
   **injection possible via le JSON-LD** (titre contenant `</script>`), relevé console sur 29 pages
   (0 exception, 0 erreur hors 404 attendus), revue sécurité (secrets côté client, validation
   serveur, routes protégées, messages d'erreur, en-têtes).

**Suites** : 105 tests API, 56 scénarios navigateur (11-marges-mobile +5, 01 +0). Déploiement
vérifié par la CI (`/health`) et Vercel.

---

## 18. Confirmation de l'adresse e-mail à l'inscription — 15 septembre 2026

**Objectif** : prouver qu'une adresse appartient bien à la personne qui s'inscrit, avec le même
mécanisme que le mot de passe oublié (jeton aléatoire envoyé par e-mail, seul son hash en base,
usage unique). Le téléphone reste non vérifié (SMS différé, §6).

**Fonctionnement**
- `POST /auth/register` crée le compte avec `emailVerified = false`, puis envoie un e-mail
  « Trocoin — confirmez votre adresse e-mail » contenant `SITE_URL/confirmer-email?token=…`.
  Jeton : 32 octets aléatoires en base64url (43 caractères, non devinable) ; la table
  `email_verification_tokens` ne stocke que son SHA-256, l'adresse visée, l'expiration (**24 h**)
  et la date d'utilisation. Un échec d'envoi est journalisé et **ne bloque pas l'inscription**
  (`verificationEmailSent: false` dans la réponse) : la personne peut redemander l'e-mail plus tard.
- `POST /auth/email/verify { token }` (sans session : le lien peut être ouvert sur un autre appareil)
  refuse tout jeton inconnu, déjà utilisé, expiré, ou dont l'adresse n'est plus celle du compte,
  avec un seul message : « Ce lien de confirmation est invalide ou expiré. Demandez un nouvel e-mail
  depuis vos paramètres. » Sinon : jeton consommé, `emailVerified = true`, `emailVerifiedAt` renseigné.
- `POST /auth/email/resend` (connecté) : refusé si l'adresse est déjà confirmée, **60 s minimum
  entre deux envois par compte**, et 3 demandes par heure et par IP (throttler). `verify` est
  limité à 10 essais par 15 min et par IP.
- Le statut est exposé dans la réponse d'inscription / connexion et sur `GET /users/me`
  (`emailVerified`, `emailVerifiedAt`). Migration Postgres `1789420000000-EmailVerification`.

**Politique pour les comptes non confirmés (choix le moins bloquant)** : usage normal du site
(déposer, chercher, écrire, acheter) sans aucune restriction ; un rappel visible dans tout l'espace
compte (« Confirmez votre adresse e-mail. Un lien vous a été envoyé à … ») avec le bouton
« Renvoyer l'e-mail de confirmation », et dans Paramètres → Identifiants une étiquette « Adresse
confirmée » / « Adresse non confirmée ». Raison : l'e-mail n'est pas l'identifiant du compte (c'est le
mobile), et bloquer des fonctions au lancement ferait perdre des inscrits alors que Resend n'atteint
pas encore tous les destinataires (§5). Si vous souhaitez plus tard conditionner une action (par
exemple le dépôt d'annonce) à l'adresse confirmée, le champ `emailVerified` est déjà là.

**Écrans** : page `/confirmer-email` (vérification automatique à l'ouverture, message de succès avec
retour au compte, message d'erreur avec renvoi vers les paramètres, « Lien incomplet » sans jeton) ;
rappel dans `compte/layout` ; statut + bouton dans Paramètres (le bouton se met en attente 60 s
après un envoi, comme le serveur).

**Tests**
- API `test/phase14.e2e-spec.ts` (+2, fournisseur d'e-mail simulé) : inscription → lien exposé par
  `/dev/last-verification-link` → jeton de 43 caractères, hash en base ≠ jeton, expiration ≈ 24 h →
  jetons inconnu / trop court refusés → validation sans session → `/users/me.emailVerified = true`
  → réutilisation refusée → renvoi refusé (déjà confirmée) → connexion expose le statut ; second
  test : jeton expiré (expiration reculée en base) refusé, renvoi trop rapproché refusé, renvoi après
  délai émet un nouveau jeton différent qui fonctionne, renvoi sans session → 401.
- Navigateur `e2e/02-inscription.spec.ts` (desktop et mobile 375 px) : après inscription, rappel
  visible avec l'adresse, statut « Adresse non confirmée », bouton « Renvoyer » → message
  « Patientez une minute » et bouton en attente, ouverture du lien reçu → « Votre adresse … est
  confirmée », rappel disparu, statut « Adresse confirmée », bouton absent, second passage sur le lien
  → « invalide ou expiré ».

**Preuves d'exécution (15 septembre 2026)**
- `npm test` : **107 tests réussis, 1 ignoré** (105 → 107, phase 14 +2). `tsc` API et front : 0 erreur.
- Playwright `02-inscription` : **4 réussis** (2 scénarios × desktop 1280 px et mobile 375 px) avec
  le parcours de confirmation ci-dessus.
- **Envoi réel via Resend** (API locale, fournisseur `resend`, expéditeur bac à sable, destinataire
  autorisé `trocoin2026@gmail.com`) : `POST /auth/register` → 201 avec `emailVerified: false` et
  `verificationEmailSent: true` ; journal `Email(resend) Envoyé à tr…@gmail.com (id
  893441ba-0de2-42ff-9858-d699f93ae9e1)` ; lien reçu par le serveur identique à celui envoyé ; ouverture
  du lien dans le navigateur → « Votre adresse trocoin2026@gmail.com est confirmée » ; `/users/me`
  passe de `emailVerified: false` à `true` avec `emailVerifiedAt: 2026-09-15T10:02:20Z` ; second
  `POST /auth/email/verify` avec le même jeton → 400 « invalide ou expiré ». La réception dans la
  boîte `trocoin2026@gmail.com` reste à confirmer de votre côté (la clé Resend est « envoi seul », elle
  ne permet pas de relire les e-mails) ; Resend a accepté le message (id ci-dessus).
- **Limite en production** : avec l'expéditeur bac à sable, seul `trocoin2026@gmail.com` peut recevoir
  ces e-mails (§5). Pour toute autre adresse, l'inscription réussit quand même mais avec
  `verificationEmailSent: false` (journal d'erreur côté serveur) : vérifier un domaine chez Resend et
  mettre `EMAIL_FROM` dessus est la seule action restante pour que tous les inscrits reçoivent le lien.
- **Déploiement** : CI verte (run 34956652354 : typecheck, 107 tests SQLite et PostgreSQL 16, image
  Docker, 56 scénarios navigateur, déploiement Render) ; `/health` en production →
  `version 1.10.0`, `databaseRegion eu-central-1` ; `POST /auth/email/verify` avec un jeton inconnu →
  400 « invalide ou expiré » (la migration `email_verification_tokens` est passée : la table est
  interrogée sans erreur) ; `POST /auth/email/resend` sans session → 401 ; page
  `https://trocoin.vercel.app/confirmer-email` → 200. Un premier passage CI avait échoué sur trois
  scénarios navigateur (débordement horizontal du rappel avec une adresse longue à 375 px, bloc
  Identifiants trop large, sélecteur « Envoyer » qui attrapait aussi « Renvoyer l'e-mail… ») :
  corrigé (retours à la ligne, bouton sous la liste, sélecteurs exacts) au commit suivant.

---

## 19. Items « confort » avant ouverture publique — 15 septembre 2026 (après-midi)

Trois chantiers du §7 (points 8, 9 et 10), livrés en une version (1.11.0). Le domaine Resend
n'étant pas encore acheté, rien n'a été changé côté e-mail de production (§5).

### 19.1 Filtres des six familles restantes et menu « Partager »

- **Relevé leboncoin** : la protection anti-robot a de nouveau coupé l'accès (« Accès
  temporairement restreint ») dès le premier choix d'une sous-catégorie, après l'ouverture du
  menu « Tous les filtres » et de la liste des sous-catégories de Matériel professionnel ; toujours
  bloqué une heure plus tard. Rien n'a été contourné. Les compléments ci-dessous viennent donc de
  la connaissance générale du site, **pas d'une observation du jour** — c'est écrit tel quel dans
  `docs/comparatif-leboncoin.md` §5, avec ce qui reste à confirmer manuellement (≈ 15 min).
  Seule exception : le panneau de filtres de la famille **Animaux** a pu être lu deux heures plus
  tard (Type d'animal : Chiens, Chats, Nouveaux animaux de compagnie, Equidés, Animaux de la
  ferme, Oiseaux, Poissons ; Offres / Demandes) avant un nouveau blocage ; la liste « Animal » de
  Trocoin a été alignée sur ces valeurs.
- **Schémas complétés** (`src/categories/category-schemas.ts`, 30 champs ajoutés ou rendus
  filtrables) : Matériel pro (marque, année, heures et puissance sur BTP / Agricole, types étendus,
  Fournitures de bureau avec ses propres champs) ; Famille (types de puériculture, mobilier avec
  marque et couleur, vêtements bébé avec type et fille / garçon / mixte) ; Loisirs (activité
  sportive en liste de 19 entrées + univers, vélos avec taille de cadre, roues et matériau, livres
  avec format, jouets et collection filtrables) ; Vacances (mobil-homes, hôtels, insolites,
  environnement, classement en étoiles, TV, lave-linge, barbecue, équipements filtrables) ;
  Services (matières de cours en liste de 17 entrées, schémas propres pour Services animaux et
  Entraide entre voisins) ; Animaux (âge en tranches, race et sexe filtrables, accessoires par
  animal concerné). Le système de champs dynamiques existant est inchangé.
- **Menu « Partager »** : non observable (même blocage). Trocoin propose partage natif, copier le
  lien, WhatsApp, e-mail, Facebook, X ; d'après la connaissance du site, leboncoin propose en plus
  Messenger (clé d'application Facebook requise : non repris). Jugé équivalent, aucun changement.

### 19.2 Marque → modèle, historique des localisations, arrondissements groupés

- **Véhicules** : `src/categories/vehicle-models.ts`, fichier statique maintenu à la main (57
  marques de voitures dont les sans-permis, 31 de motos, 17 d'utilitaires ; « Autre » en fin de
  chaque liste). Le schéma déclare `marque` en liste et `modele` en **liste dépendante**
  (`dependsOn: 'marque'`, `optionsByParent`) ; le serveur refuse un modèle qui n'appartient pas à
  la marque choisie (« Peugeot / Clio » → 400) ; au dépôt et dans les filtres, le champ Modèle
  reste inactif tant que la marque n'est pas choisie et se vide si la marque change.
- **Historique des localisations** : hook `useRecentLocations` (`frontend/src/lib/recent-locations.ts`) ;
  5 entrées au plus, sans doublon ; conservées dans le navigateur et, si la personne est
  connectée, sur son compte (`PATCH /users/me { recentLocations }`, colonne `users.recentLocations`,
  nettoyage serveur : ville obligatoire, code postal à 5 chiffres, coordonnées valides, 5 max) ; les
  deux listes sont fusionnées. Proposées sous « Récents » avant toute saisie, dans la recherche
  (`LocationPicker`) comme au dépôt (`CityInput`).
- **Arrondissements** : l'API adresse renvoie les arrondissements comme des communes à part
  (`city: "Paris 11e Arrondissement"`). `frontend/src/lib/geo.ts` les rattache à leur ville, les
  libelle « Paris 11e (75011) », n'affiche qu'une entrée « Paris (toute la ville) » avec un bouton
  « Arrondissements de Paris » qui déplie la liste complète triée (chargée à la demande). Même
  chose pour Lyon et Marseille. Le mock e2e a été aligné sur la vraie forme de l'API.

### 19.3 Changement d'e-mail confirmé et double authentification

- **Changement d'adresse** (`POST /auth/email/change`, 5 demandes / h / IP) : mot de passe
  vérifié, nouvelle adresse libre, jeton du même type que la confirmation d'inscription (§18,
  24 h, hash seul en base) envoyé **à la nouvelle adresse** ; l'ancienne reçoit un avertissement à
  la demande (« si ce n'est pas vous, changez votre mot de passe ») et à la confirmation. Le
  changement n'est effectif qu'au clic (`POST /auth/email/verify` → `changed: true`) ; à ce moment
  tous les autres liens en attente du compte sont invalidés (un lien d'inscription de l'ancienne
  adresse ne peut pas la rétablir). Paramètres → Identifiants : bouton « Changer d'adresse
  e-mail » (nouvelle adresse + mot de passe), message tant que le lien n'est pas ouvert.
- **Double authentification** (facultative, Paramètres → « Double authentification ») : TOTP
  RFC 6238 implémenté localement (`src/auth/totp.ts`, HMAC-SHA1, 6 chiffres, 30 s, tolérance
  ± 1 pas), QR code généré par `qrcode`. Activation en deux temps (`/auth/2fa/setup` → secret en
  attente + QR ; `/auth/2fa/enable { code }` → activation + **8 codes de récupération** affichés
  une seule fois, stockés hachés). Connexion : `POST /auth/login` (ou `/auth/otp/verify`) renvoie
  `{ twoFactorRequired: true, challengeToken }` — un JWT de 5 minutes marqué `purpose`, que la
  stratégie JWT refuse comme session — puis `POST /auth/login/2fa { challengeToken, code }`
  (10 essais / 10 min / IP). Un code TOTP déjà accepté ne peut pas être rejoué (`totpLastStep`),
  un code de récupération est consommé. Désactivation : mot de passe + code. Les secrets
  (`totpSecret`, `totpRecoveryCodes`, `totpLastStep`) sont en `select: false`, jamais sérialisés.
  Pour qui n'active rien, la connexion est strictement inchangée.
- **Migration** `1789430000000-ConfortAvantOuverture` (colonnes `users.recentLocations`,
  `twoFactorEnabled`, `twoFactorEnabledAt`, `totpSecret`, `totpRecoveryCodes`, `totpLastStep`).

### 19.4 Preuves d'exécution (15 septembre 2026, après-midi)

- `npm test` : **112 tests réussis, 1 ignoré** (107 → 112 ; `test/phase15.e2e-spec.ts` +5 :
  changement d'adresse complet avec avertissements et lien d'inscription invalidé, double
  authentification de bout en bout — jeton intermédiaire refusé comme session, mauvais code 401,
  rejeu du même code 401, pas suivant accepté, code de récupération à usage unique, désactivation —
  localisations récentes nettoyées, listes marque → modèle validées et filtrées). Deux tests
  existants ont été mis à jour pour les nouvelles valeurs (types d'hébergement, réponse
  `changed: false` de la confirmation) et un modèle de véhicule aligné sur la liste (« Clio »).
- Playwright : **60 scénarios réussis** (56 → 60 : `01-recherche` +1 arrondissements groupés et
  « Récents » sur desktop et mobile, `12-securite` +2). Les scénarios 01, 04, 07, 08 ont été
  adaptés aux listes (marque et modèle choisis dans une liste, sous-menu « Arrondissements de
  Lyon ») ; un premier passage a révélé un message de connexion réécrit par erreur et un contraste
  insuffisant de l'étiquette « Désactivée », corrigés avant la livraison.
- Captures (API et front construits, base locale) : arrondissements de Paris dépliés sous
  « Paris (toute la ville) », « Récents » avant saisie, Modèle inactif tant que la marque n'est pas
  choisie puis liste Peugeot (35 modèles), formulaire de changement d'adresse, QR code et clé de la
  double authentification, codes de récupération, écran « Double authentification » à la
  connexion, sous-menu Marseille à 375 px.
- **Déploiement** : CI verte (run 34964221761 : typecheck, 112 tests SQLite et PostgreSQL 16 avec
  la migration `ConfortAvantOuverture`, image Docker, 60 scénarios navigateur, déploiement Render).
  Production : `/health` → `version 1.11.0`, `databaseRegion eu-central-1` ;
  `GET /categories/voitures/schema` → `marque` en liste (57 marques + Autre), `modele` avec
  `dependsOn: marque` (Peugeot → 35 modèles) ; `GET /categories/animaux-vente-don/schema` → les
  valeurs observées sur leboncoin ; `POST /auth/login` avec un identifiant inconnu → 401 (la
  requête lit les nouvelles colonnes sans erreur, donc la migration est passée) ;
  `POST /auth/login/2fa` avec un jeton bidon → 401 « Délai dépassé » ; `POST /auth/2fa/setup` et
  `POST /auth/email/change` sans session → 401 ; `trocoin.vercel.app/connexion` → 200.

### 19.5 Contrôle qualité des nouveaux écrans — 15 septembre 2026 (fin d'après-midi)

Passage sur les écrans ajoutés (QR code et codes de récupération, désactivation, connexion en
deux temps, changement d'adresse, sous-menu des arrondissements, « Récents », champ Modèle
dépendant, page de confirmation en erreur) à **360, 375 et 414 px**, avec la même règle que le
premier brief : aucun texte, bloc, champ, bouton, image ou code à moins de 12 px du bord, pas de
défilement horizontal ; couleurs de fond et de texte relevées par script (33 contrôles, tous
conformes après corrections).
- **Marges** : deux défauts trouvés et corrigés — dans la boîte de dialogue « Activer la double
  authentification », le titre long rejetait le bouton ✕ sous lui sur mobile (en-tête des boîtes
  de dialogue : titre sur deux lignes, bouton toujours à droite, valable pour toutes les boîtes du
  site) ; dans Paramètres → Identifiants, l'adresse e-mail était coupée au milieu à 360 px
  (libellés au-dessus des valeurs sous 480 px, l'adresse garde toute la largeur).
- **Vocabulaire** : phrases raccourcies et concrètes (« Ouvrez l'application sur votre téléphone
  et scannez ce QR code pour ajouter Trocoin », « Notez ces codes et gardez-les en lieu sûr. Si
  vous perdez votre téléphone… », présentation de la double authentification en deux phrases).
  Aucun terme technique (jeton, TOTP, HMAC, challenge) n'apparaît à l'écran ni dans les e-mails.
- **Couleurs** : panneaux et boîtes de dialogue blancs, texte `#1f2937`, texte secondaire
  `#5f6b78`, fond des blocs de code `#f6f8f7`, étiquettes et encarts dans les teintes claires déjà
  utilisées (ocre, vert, bleu clair) ; aucun fond sombre. Le voile derrière une boîte de dialogue
  est le même qu'ailleurs sur le site.
- Suites rejouées après corrections : 26 scénarios navigateur (05, 07 axe, 08, 11 marges, 12)
  verts ; contrôle des marges à 360 / 375 / 414 px : 33 / 33.

---

## 20. Filtres généralisés, suppression de conversations, mega-menu, découverte, pied de page — 15 septembre 2026 (soir)

Dix points relevés par vos captures d'écran leboncoin (statut point par point dans
`docs/comparatif-leboncoin.md` §6). Version 1.12.0.

- **Panneau « Tous les filtres »** (`frontend/src/components/search/SearchPage.tsx`) : un seul
  panneau pour toutes les catégories, dans l'ordre observé — Catégories (catégorie active rappelée,
  modifiable), Localisation, Étendre à la livraison, Prix, Dons uniquement, Tri (choix unique, cinq
  libellés dont le nouveau tri « Plus anciennes »), Type de vendeurs (cases à cocher avec le nombre
  d'annonces de chaque type), Annonces urgentes uniquement, puis les filtres propres à Trocoin.
  Barre fixe en bas : « Tout effacer » (le mot-clé est gardé) et « Rechercher (N) » avec N en
  direct. Bureau : colonne ; mobile : volet glissant depuis la droite (`role="dialog"`, Échap,
  défilement de la page bloqué). API : paramètre `delivery_anywhere` (le critère de lieu laisse aussi
  passer les annonces livrables, les proches restent triées en premier), tri `oldest`,
  `GET /listings/facets` (compteurs par type de vendeur avec les mêmes critères, sans le filtre
  vendeur). « Offres / Demandes » non repris : Trocoin ne publie que des offres.
- **Suppression de conversations** : colonnes `hiddenForBuyerAt` / `hiddenForSellerAt`
  (migration `ConversationsMasquees`), `DELETE /conversations/:id` et
  `POST /conversations/bulk-delete { ids }` (100 max). Règle documentée dans
  `conversation.entity.ts` : la suppression masque la conversation **pour celui qui supprime
  seulement** ; l'autre participant garde l'échange (et la modération / les litiges aussi, rien
  n'est effacé) ; elle réapparaît chez lui si l'autre écrit ou le recontacte depuis l'annonce ; les
  compteurs de non-lus l'ignorent tant qu'elle est masquée. Page Messages : bouton « Sélectionner »
  ou appui long (600 ms), cases à cocher, « Tout sélectionner / désélectionner », « Supprimer (n) »
  avec confirmation « Supprimer n conversations ? … Cette action est irréversible ».
- **Barre des familles** (`CategoryBar.tsx`, bureau ≥ 1024 px avec survol) : chaque famille ouvre
  un panneau avec ses sous-catégories en colonnes de huit et un lien « Tout {famille} » ; survol ou
  clic, fermeture par Échap (focus rendu) ou clic ailleurs. Mobile : accordéon du menu principal
  inchangé. Aucun encart promotionnel.
- **Découverte en bas des pages de catégorie** (`GET /listings/discover`, `DiscoverSections.tsx`) :
  « Les utilisateurs recherchent aussi… » (sous-catégories, valeurs des critères filtrables, 12
  marques pour les véhicules ; jamais « Autre »), « Localisations les plus demandées… » (villes des
  annonces en ligne de la catégorie avec leur nombre, complétées par les grandes villes INSEE
  jusqu'à 24, chacune lançant la recherche filtrée sur la ville), fil d'Ariane. Trocoin n'enregistre
  aucun historique de recherches : les suggestions viennent des données du site.
- **Pagination** : déjà numérotée avec Précédent / Suivant, aucun changement.
- **Sans connexion** : rien ne bloque la consultation ; ajouté la note du vendeur et le nombre
  d'avis sur les cartes (`seller.ratingAvg` / `ratingCount` renvoyés par l'API, sans donnée
  personnelle). Le coût de livraison n'existe pas comme concept (mention « Livraison possible »).
- **Badge « À la une »** : déjà en haut à gauche de la photo, inchangé.
- **Livraison** : bandeau explicatif quand le filtre est actif, puce « Livraison acceptée ✕ »
  retirable, périmètre « Autour de {commune} / France » relié à « Étendre à la livraison ».
- **Pied de page** : quatre colonnes (À propos, Informations légales, Nos solutions pros, Des
  questions ?), 16 liens vers des pages existantes, nouvelle page `/accessibilite` (uniquement ce
  qui est en place et vérifié ; pas de déclaration RGAA inventée), copyright « © 2026 ». Omis
  volontairement : applications, réseaux sociaux, avis externes, fond sombre.
- **Encarts sponsorisés** : aucune régie tierce ; rien à faire.

**Preuves d'exécution (15 septembre 2026, soir)**
- `npm test` : **117 tests réussis, 1 ignoré** (112 → 117 ; `test/phase16.e2e-spec.ts` +5 :
  étendre à la livraison par commune et par rayon avec les proches en premier, tri « plus
  anciennes », compteurs `/listings/facets` insensibles au filtre vendeur, découverte d'une
  catégorie et d'une famille, note du vendeur sur les cartes sans donnée personnelle, suppression
  de conversations masquée pour un seul participant avec retour au premier message de l'autre,
  compteurs de non-lus, tiers ignoré, validations).
- Playwright : **73 scénarios, 67 réussis et 6 passés volontairement** (60 → 73 ;
  `13-messagerie` +1, `14-filtres-decouverte` +6 sur bureau et +6 sur mobile dont la barre des
  familles passée sur mobile). Un premier passage avait révélé deux ancres « Fil d'Ariane » en
  double, un contraste insuffisant de la note du vendeur, un clic qui refermait le panneau ouvert
  au survol et des cases pilotées par l'adresse de la page : corrigés avant la livraison.
- Captures (API et front construits, seed e2e) : panneau « Tous les filtres » sur bureau avec le
  bandeau livraison et le périmètre « Autour de Lyon / France », volet mobile à 375 px avec la
  barre « Tout effacer / Rechercher (N) », barre des familles ouverte sur Services (deux colonnes),
  messagerie en mode sélection avec « Supprimer (2) » et la boîte de confirmation, bas de page
  Vélos (suggestions, villes, chemin), pied de page en quatre colonnes sous la page Accessibilité.
- **Déploiement** : CI verte (run 34977192106 : typecheck, 117 tests SQLite et PostgreSQL 16 avec
  la migration `ConversationsMasquees`, image Docker, 73 scénarios navigateur, déploiement
  Render). Production : `/health` → `version 1.12.0` ; `GET /listings/facets?category=vehicules`
  → compteurs ; `GET /listings/discover?category=velos` → fil d'Ariane Loisirs › Vélos, 22
  suggestions, 24 villes ; `GET /listings?sort=oldest&city=Lyon&delivery_anywhere=true` → 200 ;
  `POST /conversations/bulk-delete` sans session → 401 ; `trocoin.vercel.app/accessibilite` et
  `/recherche?category=velos` → 200, barre des familles présente dans les fichiers servis par Vercel.

## 21. Confirmation de parité et différenciation du design — 15 septembre 2026 (nuit)

Brief en six points : re-vérifier la parité page par page avec un résultat chiffré, puis rendre
Trocoin visuellement et structurellement distinct de leboncoin (direction artistique documentée),
plus dynamique, plus clair, avec ses fonctions « intelligentes » mises en avant et des outils
groupés pour les pros. Version 1.13.0. Référence des décisions visuelles : `docs/design-system.md`.

### 21.1 Parité re-vérifiée (point 1)

- Le contrôle est un script rejouable, `scripts/audit-parite.js`, qui lit chaque ligne du comparatif
  et la vérifie contre **la production publique sans connexion** (routes API et pages servies par
  Vercel, plus Chromium pour ce qui se rend côté navigateur : barre des familles, menu
  « Catégories », bouton « Plus de filtres ») et, pour les parcours connectés, contre **la pile
  locale construite à partir du même commit** avec le seed e2e (aucun compte de test ne doit écrire
  en production). Il produit `docs/parite-resultats.md` (tableau numéroté avec la preuve et la
  source de chaque ligne) ; le bilan chiffré est repris dans `docs/comparatif-leboncoin.md` §7.
- Le premier passage a mis un écart au jour : la ligne « appareils connectés » du comparatif
  était marquée présente alors que l'API (`GET/DELETE /auth/sessions`) n'avait aucun écran. Ajouté
  ce tour : section « Appareils connectés » des paramètres (`SessionsSection.tsx`, navigateur et
  système déduits de l'agent utilisateur, « Déconnecter tous les appareils » avec confirmation).
- Restent en écart, et le disent : badge « Réactif » (taux de réponse calculé, pas affiché) et
  étiquettes transporteur intégrées (différées, pas de partenaire) ; les cartes ne peuvent pas être
  vérifiées en production tant qu'aucune annonce n'y est en ligne (vérifiées sur la pile locale).

### 21.2 Direction artistique et différenciation (point 2)

- **En-tête sur deux rangées** (`Header.tsx`) : logo et liens personnels (icône au-dessus du
  libellé) avec le seul bouton vert « Déposer une annonce » sur la première ; bouton « Catégories »
  (menu complet) et **recherche large en pilule** sur la seconde ; barre des familles en dessous
  sur bureau. Plus aucune barre « recherche à gauche, actions à droite » sur une ligne.
- **Cartes « fiche »** (`ListingCard.tsx`) : cadre blanc 16 px avec 6 px autour d'une photo
  carrée à coins 12 px, **prix en pilule Fraunces posée sur la photo**, **cœur rond à cheval sur le
  bas du cadre**, étiquettes « À la une » / « Urgent » en blanc avec point coloré, titre Public Sans
  15 px sur deux lignes, ligne Pro / état / note, pied « lieu · date » (date entière, lieu tronqué)
  avec l'icône livraison.
- **Système de design** (`docs/design-system.md`) : palette avec usage de chaque teinte,
  typographie (Fraunces pour les titres et les prix, Public Sans pour le reste, tailles et
  graisses), rayons (6 / 10 / 16 / pilule), ombres (aucune au repos), grille de 4 px, composants
  (boutons en pilule, une seule action verte par écran, `btn-dark` encre pour l'action forte
  secondaire, étiquettes, champs, icônes en traits, pas d'illustration figurative), en-tête,
  mouvements (durées, courbes, ce qui n'est jamais animé), action dominante écran par écran.
- Retouches issues des captures : `pill-accent` passée au vert foncé (7,6:1) et étiquettes sans
  transition de couleur (axe relevait une teinte intermédiaire) ; cadre de carte à 5 px + bordure
  1 px pour un cadre visible de 6 px ; boutons « Tout effacer / Rechercher (N) » qui se partagent
  la colonne des filtres sans déborder ; boîtes de dialogue rendues dans `<body>` par portail (une
  boîte `fixed` ouverte depuis une carte survolée, donc transformée, restait confinée à la carte).

### 21.3 Interface plus dynamique (point 3)

- **Accordéons de filtres** (`FilterSection.tsx`) : ouverture par `grid-template-rows` (0fr → 1fr,
  220 ms), en-tête bouton avec chevron et compteur d'actifs, état mémorisé pour la session
  (`sessionStorage`), invisibilité et non-focus une fois replié (axe `aria-hidden-focus`).
- **Menus animés** : `usePresence` garde un menu monté le temps de sa sortie ; entrée / sortie
  par translation et léger agrandissement (`menu-in` / `menu-out`), volet mobile et menu mobile
  (`drawer-in/out`, `slide-down-in/out`). Jamais d'opacité à l'ouverture (les mesures d'axe et de
  Playwright ne doivent pas tomber sur un état intermédiaire). Réduits à zéro avec
  `prefers-reduced-motion`.
- **Suggestions pendant la frappe** (`SearchBox.tsx`) : annonces et catégories (`/listings/suggest`),
  communes (référentiel local, sans arrondissements), et **recherches récentes** du navigateur
  (`localStorage`, six au plus) proposées avant même de taper.
- **Cartes** : élévation au survol, zoom léger de la photo, **aperçu rapide** au clic long à la
  souris (500 ms, `QuickPreview.tsx` : couverture, prix, lieu, quatre critères, extrait de la
  description, « Voir l'annonce ») sans quitter la liste ; le clic simple ouvre la fiche.
- **États intermédiaires** : filet vert en haut de l'écran pendant un changement de page
  (`RouteProgress.tsx`), squelettes dans l'aperçu rapide, boutons « Envoi… » déjà en place.

### 21.4 Boutons et champs plus clairs (point 4)

- Une seule action verte par écran (tableau dans `docs/design-system.md` §8) : « Acheter » passe
  en encre à côté de « Contacter », « Publier / Remettre en ligne » en encre dans Mes annonces.
- Panneau de filtres : seuls **Catégories, Localisation, Prix, Tri** sont visibles ; « Plus de
  filtres (n actifs) » déplie Livraison, Dons et type d'annonce, Type de vendeurs, Annonces
  urgentes, État et photos, Date de publication, puis les caractéristiques de la catégorie
  (ouvertes par défaut). Ouverture automatique si un filtre avancé est actif.
- Dépôt en **cinq étapes nommées** avec barre de progression (`role="progressbar"`, étape n sur 5,
  pourcentage, pilules cliquables pour revenir) : Titre et catégorie → Description → Photos →
  Localisation → Aperçu.

### 21.5 Fonctions intelligentes mises en avant (point 5)

- **Estimation de prix en direct** (`PriceEstimate.tsx`) : jauge fourchette basse — médiane —
  haute des annonces comparables, curseur du prix tapé qui se déplace, verdict en une phrase
  (`bas`, `un-peu-bas`, `ok`, `un-peu-haut`, `haut`).
- **Score de complétude actionnable** (`CompletenessHint.tsx`) : anneau de progression et, pour
  chaque manque, un bouton « Faire → » qui ouvre le sélecteur de photos ou ramène au champ concerné.
- **Catégorie suggérée d'après le titre** (`src/categories/category-suggest.ts`, `GET
  /categories/suggest?q=`) : dictionnaire de mots-clés par sous-catégorie (mots décisifs « louer »
  / « vendre » pondérés), trois propositions cliquables sous le titre.
- **Raccourcis** : recherches récentes et localisations récentes proposées en premier.

### 21.6 Simple pour les particuliers, puissant pour les pros (point 6)

- Mes annonces : avec une seule annonce, aucune complexité (ni onglets ni sélection). À partir de
  deux : onglets par statut avec compteurs, « Sélectionner » → cases, « Tout sélectionner »,
  « Mettre en pause (n) », « Remettre en ligne (n) », « Renouveler (n) » sur `POST /listings/bulk`
  (100 identifiants au plus, réponse `{ done, failed: [{ id, reason }] }`, une annonce qui n'est
  pas à soi est refusée sans faire échouer les autres).

**Preuves d'exécution (15 septembre 2026, nuit)**
- `npm test` : **120 tests réussis, 1 ignoré** (117 → 120 ; `test/phase17.e2e-spec.ts` +3 :
  dix titres → catégorie attendue dont « Appartement T3 à louer » → Locations et « à vendre » →
  Ventes immobilières, actions groupées avec une annonce étrangère en `failed`, validations 400 et
  401, liste des sessions puis déconnexion générale qui invalide le refresh).
- Playwright : **93 scénarios, 83 réussis et 10 passés volontairement** (73 → 93 ;
  `15-experience` +7 sur bureau et +7 sur mobile, et le projet mobile joue enfin `14-filtres-decouverte`
  (+6, dont le volet de filtres à 375 px, qui n'avait jamais été exécuté : il supposait que « Tout
  effacer » refermait le volet) ; `01-recherche` réécrit pour la carte « fiche »,
  l'en-tête sur deux rangées et la grille ; `04`, `07`, `08` adaptés au titre saisi en première
  étape ; `14` à l'accordéon). Le premier passage complet avait relevé : cadre de carte de 7 px au
  lieu de 6, cartes qui élargissaient la grille mobile (`min-width: 0`), `#more-filters` masqué
  mais focusable, titres de sections h3 sous un h1, contraste des pilules pris pendant une
  transition, animation `appear` du module qui écrasait `menu-in`, estimation absente faute de
  trois annonces comparables, libellé « Type » ambigu, clic dans un panneau encore en mouvement
  (Playwright fait alors défiler la page sous l'en-tête fixe) : tous corrigés, dernier passage vert.
- Captures « après » (bureau 1280 px et mobile 375 px, pile locale) : en-tête et cartes, menu
  « Catégories », suggestions pendant la frappe (annonce, catégorie, commune), carte survolée et
  aperçu rapide, filtres essentiels puis accordéon, dépôt (suggestion de catégorie, jauge de prix
  « un peu haut » puis « dans la fourchette », checklist), Mes annonces en sélection groupée,
  appareils connectés, menu mobile, volet de filtres mobile. Les captures « avant » du tour
  précédent (§20) servent de comparaison.
- **Déploiement** : CI verte (run 34989038250 : typecheck, 120 tests SQLite et PostgreSQL 16,
  image Docker, 93 scénarios navigateur dont les specs 14 et 15 sur mobile, déploiement Render).
  Production : `/health` → `version 1.13.0` (postgres, eu-central-1) ; `GET
  /categories/suggest?q=Appartement T3 à louer Lyon` → Locations (8,11) devant Ventes
  immobilières (2,11) ; `POST /listings/bulk` et `GET /auth/sessions` sans session → 401 ; les
  fichiers servis par Vercel contiennent « Plus de filtres », « Appareils connectés », « Que
  proposez-vous », « Mettre en pause », « Vos recherches récentes » et l'aperçu rapide.
- **Parité rejouée sur la production 1.13.0** (`node scripts/audit-parite.js`) : 36 points,
  **32 équivalents, 2 partiels** (cartes non vérifiables en production faute d'annonce en ligne ;
  badge « Réactif »), **1 manquant** (étiquettes transporteur, différé), **1 non pertinent**
  (services partenaires et régie). Détail ligne par ligne dans `docs/parite-resultats.md`.

## 22. Étiquettes transporteur, phase 1 : comparatif et mode simulation — 15 septembre 2026 (nuit)

Le domaine `trocoin.fr` est acheté (Resend / `EMAIL_FROM` : étape séparée). L'impression
d'étiquettes dépend d'un compte prestataire que Trocoin n'a pas encore : cette phase prépare tout
sans clé externe ; la phase 2 (intégration réelle, écrans, tests navigateur) attend les clés de
test. Version 1.14.0. Référence : `docs/etiquettes-transporteur.md`.

- **Comparatif** (Boxtal, Sendcloud, Colissimo + Mondial Relay en direct) : coût d'usage,
  simplicité d'intégration, transporteurs couverts, délai d'activation, avec la distinction entre
  ce qui a été observé sur les pages consultées et ce qui vient de la documentation publique (le
  portail développeur Boxtal se charge en JavaScript et n'a pas pu être lu automatiquement).
  **Recommandation : Boxtal** — sans abonnement ni frais par étiquette, une seule intégration pour
  Colissimo et Mondial Relay, compte et environnement de test gratuits ouverts en ligne.
- **Liste des démarches** pour obtenir des clés de test (compte, clé v3, identifiants v1,
  environnement de test, codes d'offre, variables Render à renseigner sans jamais les coller).
- **Architecture en simulation** : `IShippingProvider` (cotation, points relais, étiquette, suivi ;
  erreurs typées) ; `MockShippingProvider` avec tarifs indicatifs par poids, points relais fictifs,
  étiquette PDF 10 × 15 cm marquée « SIMULATION » générée sans dépendance, numéro `SIM…`, suivi qui
  progresse dans le temps, pannes simulées (`SHIPPING_MOCK_FAIL`) ; `UnconfiguredShippingProvider`
  pour `SHIPPING_PROVIDER=none` (503 explicite ; `mock` interdit en production). Entité `Shipment`
  (table `shipments`, migration `Expeditions`), six routes sous `/transactions/:id/shipment`
  (vendeur : cotation, points relais, achat de l'étiquette, PDF ; vendeur et acheteur : état et
  suivi). Une étiquette achetée reporte son numéro sur la transaction : « Confirmer l'expédition »
  n'exige plus de saisie ; un refus du prestataire laisse l'expédition en `echec` avec la raison et
  ne bloque rien.
- **Rien d'exposé aux utilisateurs** : aucun écran en phase 1, la production reste en `none`
  (saisie manuelle du numéro de suivi, comme avant).

**Preuves d'exécution (15 septembre 2026, nuit)**
- `npm test` : **124 tests réussis, 1 ignoré** (120 → 124 ; `test/phase18.e2e-spec.ts` +4 :
  cotation par tranche de poids et droits vendeur / acheteur / tiers, étiquette PDF (en-tête
  `%PDF-`, mention SIMULATION, numéro, `%%EOF`) téléchargeable par le vendeur seul, suivi côté
  acheteur, expédition confirmée sans ressaisie puis statut `expediee`, panne du prestataire →
  502 + `echec` + transaction intacte, adresse refusée → 400, nouvel essai réussi sur la même
  ligne, remise en main propre sans étiquette, numéro saisi à la main → suivi minimal).
- Capture : étiquette simulée rendue en image (Colissimo point relais, 900 g, expéditeur Lyon,
  destinataire Paris, référence, valeur déclarée, code-barres et numéro `SIM…`).
- **Déploiement** : CI verte (run 34995199471 : typecheck, 124 tests SQLite et PostgreSQL 16 avec
  la migration `Expeditions`, image Docker, 93 scénarios navigateur, déploiement Render). Production :
  `/health` → `version 1.14.0` ; `POST /transactions/:id/shipment/quote`, `GET …/shipment` et
  `GET …/shipment/label.pdf` sans session → 401 ; `SHIPPING_PROVIDER` absent en production →
  fournisseur `none` (503 explicite pour un vendeur, saisie manuelle inchangée).

## 23. Bascule vers le domaine trocoin.fr — 15 septembre 2026 (soir)

Le site est servi par Vercel sur `https://www.trocoin.fr` (`trocoin.fr` y redirige en 308, choix
fait au niveau du domaine chez Vercel) et l'API par Render sur `https://api.trocoin.fr`
(`trocoin.onrender.com` reste un alias). État constaté avant ce tour : l'API refusait les deux
nouvelles origines (CORS 403, seule l'adresse Vercel était listée), et le front publiait encore
`trocoin.vercel.app` dans `robots.txt`, le sitemap et les canoniques. Les deux dépendaient de
variables d'hébergeur restées à l'ancienne valeur : corrigé dans le code pour ne plus en dépendre.

1. **CORS** (`src/config/env.validation.ts`) : `https://www.trocoin.fr` et `https://trocoin.fr`
   toujours autorisés en production, en plus de `CORS_ORIGINS` (l'origine Vercel y reste en
   secours tant que la variable la contient). Origine étrangère → 403 inchangé.
2. **Liens des e-mails** : `resolveSiteUrl` renvoie `https://www.trocoin.fr` quand `SITE_URL` est
   absente ou pointe encore vers `vercel.app` / `onrender.com` ; `/health` expose désormais
   `siteUrl` pour le prouver de l'extérieur. Tous les e-mails (confirmation d'inscription, mot de
   passe oublié, changement d'adresse, avertissement à l'ancienne adresse) passent par cette base.
3. **Sitemap et robots** (`frontend/src/lib/api.ts`) : en production, une `NEXT_PUBLIC_SITE_URL`
   absente ou sur un ancien hébergeur est ignorée au profit du domaine canonique.
4. **Canoniques et Open Graph** : même base (`metadataBase`) ; l'accueil, qui n'avait ni
   canonique ni `og:url`, en a maintenant.
5. **Cookies** : aucun cookie n'est posé par l'API ni par le front (session en `localStorage`,
   refresh par en-tête) : rien à ajuster.
6. **Redirections** : `trocoin.fr` → `www.trocoin.fr` (Vercel, 308), `http` → `https` (308),
   et `trocoin.vercel.app` → `www.trocoin.fr` ajoutée dans `next.config.ts` (308, chemin conservé).
7. **Passage complet en production sur www.trocoin.fr** (script Playwright, comptes de test
   supprimés à la fin) : inscription d'un vendeur (e-mail de confirmation envoyé à une adresse
   Gmail de l'utilisateur), statut « Adresse non confirmée » dans les paramètres, dépôt d'une
   annonce avec photo (POST /listings 201, photo 201, fiche sur `/annonces/:id` avec canonique sur
   le domaine), inscription d'un acheteur, message au vendeur depuis la fiche et lecture côté
   vendeur, puis suppression de l'annonce (fiche → 404) et des deux comptes (204, reconnexion →
   401). Hôtes appelés par le navigateur : `www.trocoin.fr` et `api.trocoin.fr` seulement ;
   aucune erreur console.

Deux constats faits en passant, corrigés : « Lampe de bureau » était suggérée en Bureaux &
commerces (le mot « bureau » seul l'emportait ; l'expression complète est maintenant reconnue,
cas ajouté à `phase17`) ; le test 2FA recalculait le code TOTP entre la connexion et le rejeu et
pouvait échouer au changement de fenêtre de 30 s (pas figé). Les autres références aux anciennes
adresses (README, DEPLOIEMENT, `.env.example`, scripts, sonde `/health` de la CI) sont passées au
domaine ; l'historique de cet audit garde les anciennes adresses telles qu'elles étaient.

À faire côté hébergeurs, sans urgence puisque le code n'en dépend plus : `CORS_ORIGINS` et
`SITE_URL` sur Render, `NEXT_PUBLIC_SITE_URL` sur Vercel, à passer sur `https://www.trocoin.fr`
(l'origine Vercel peut être retirée de `CORS_ORIGINS` une fois la redirection constatée).

**Preuves d'exécution (15 septembre 2026, soir)**
- `npm test` : **127 tests réussis, 1 ignoré** (124 → 127 ; `test/phase19.e2e-spec.ts` +3 :
  origines de production intégrées avec `CORS_ORIGINS` conservée, URL canonique face à une
  `SITE_URL` absente, sur `vercel.app`, sur `onrender.com` ou invalide, `/health` avec `siteUrl`
  et sans clé de configuration).
- CI verte (runs 35002043850 et 35003525296 : typecheck, tests SQLite et PostgreSQL 16, image
  Docker, 93 scénarios navigateur, déploiement Render avec sonde sur `api.trocoin.fr`).
- Production : `GET https://api.trocoin.fr/health` → `version 1.14.0`, `siteUrl
  https://www.trocoin.fr` ; préflight CORS avec `Origin: https://www.trocoin.fr` → 204 et en-tête
  renvoyé, idem `https://trocoin.fr` et `https://trocoin.vercel.app`, `https://evil.example` →
  403 ; `www.trocoin.fr/robots.txt` → `Sitemap: https://www.trocoin.fr/sitemap.xml`, sitemap sans
  aucune adresse `vercel.app`, canonique de `/recherche?category=velos` et de l'accueil sur le
  domaine ; `trocoin.fr/recherche?category=velos` et `trocoin.vercel.app/recherche?category=velos`
  → 308 vers `www.trocoin.fr` avec le chemin ; `GET /categories/suggest?q=Lampe de bureau` →
  Décoration en premier.
- Captures : inscription avec le bandeau de confirmation, paramètres (adresse non confirmée),
  fiche publiée avec « Votre annonce est en ligne ! », messagerie côté acheteur et côté vendeur.

## 24. E-mail de confirmation encore sur l'ancien domaine ; phrase d'exemple retirée — 15 septembre 2026 (nuit)

**Symptôme** (test réel de l'utilisateur, après la bascule du §23) : le lien de l'e-mail de
confirmation d'inscription pointait encore vers `https://trocoin.vercel.app/confirmer-email?token=…`,
alors que `/health` annonçait déjà `siteUrl https://www.trocoin.fr`.

**Cause, vérifiée dans le code** : le service d'e-mail n'utilisait pas `resolveSiteUrl()`. Il gardait
sa propre copie de la règle, écrite avant la bascule, qui lisait `SITE_URL` telle quelle :

```ts
// src/email/email.service.ts (avant)
siteUrl(): string {
  const explicit = this.config.get<string>('SITE_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  const cors = (this.config.get<string>('CORS_ORIGINS') || '').split(',')…;
  return (cors[0] || 'http://localhost:3001')…;
}
```

Les trois liens envoyés par e-mail (confirmation d'inscription, réinitialisation de mot de passe,
changement d'adresse) passent par cette méthode. Sur Render, `SITE_URL` vaut encore
`https://trocoin.vercel.app` : le repli vers le domaine canonique existait bien dans
`resolveSiteUrl()` (§23) mais n'était jamais appelé ici. Ce n'était donc pas un e-mail mis en file
avant le déploiement (les envois sont immédiats, pas de file) : le défaut était persistant.

**Correctif** : `EmailService.siteUrl()` délègue à `resolveSiteUrl()` ; un test de `phase19` instancie
le service avec `SITE_URL=https://trocoin.vercel.app` en production et vérifie que le lien part de
`https://www.trocoin.fr`, identique à `/health`. La détection des anciens hébergeurs n'était pas en
cause ; elle est inchangée.

**Page de connexion** : la phrase « Le numéro de mobile de votre compte fonctionne aussi
(06 12 34 56 78). » sous le champ identifiant est supprimée, sans remplacement.

**Preuves d'exécution (15 septembre 2026, nuit)**
- `npm test` : `phase19` +1 (5 tests), `phase6` inchangé ; CI verte (run 35022685715 après un
  nouveau passage du job navigateur : le scénario 09 avait échoué une première fois sur le toast
  « Compte suspendu. », puis sa reprise butait sur un signalement déjà déposé ; `beforeAll` du
  scénario rendu rejouable).
- Test réel après déploiement : inscription sur `api.trocoin.fr` d'un compte avec une boîte
  jetable lisible par API (`trocoin-test-967115@uberip.com`) et d'un compte avec une adresse
  Gmail « + » de l'utilisateur. E-mail reçu de `no-reply@trocoin.fr`, objet « Trocoin — confirmez
  votre adresse e-mail », seul lien : `https://www.trocoin.fr/confirmer-email?token=…` (page → 200),
  aucune occurrence de `vercel.app` ni `onrender.com` ; capture de l'e-mail tel que reçu. Les deux
  comptes ont été supprimés (204). `www.trocoin.fr/connexion` ne contient plus la phrase d'exemple.

## 25. Favicon du site ; « Envoyé par : rsend.trocoin.fr » dans Gmail — 15 septembre 2026 (nuit)

### 25.1 Favicon

`frontend/src/app/favicon.ico` était l'icône par défaut de Next.js. `scripts/make-icons.js` produit
à partir du logo de l'en-tête (carré vert `#0f7b5f` arrondi, « T » blanc, `Logo.tsx`) :
`icon.svg` (vectoriel, navigateurs récents), `favicon.ico` (16, 32 et 48 px en PNG dans le
conteneur ICO, sans dépendance nouvelle : `sharp` était déjà là) et `apple-icon.png` (180 px, iOS).
Next.js ajoute lui-même les trois balises `<link rel="icon">` / `apple-touch-icon`.

Preuves : `www.trocoin.fr` sert les trois balises (`favicon.ico` 48×48 `image/x-icon`, `icon.svg`
`image/svg+xml`, `apple-icon.png` 180×180) et les trois fichiers (200 ; le `.ico` téléchargé de
production contient bien les trois images PNG 16/32/48). Rendu vérifié à 16, 32, 48, 64 et 180 px.
Limite : aucun outil ne permettait de photographier la barre d'onglets d'un navigateur (Chrome non
connecté ; la fenêtre de prévisualisation n'a pas d'onglets) : la preuve est le rendu des fichiers
tels que servis, pas une capture d'onglet.

### 25.2 « Envoyé par : rsend.trocoin.fr » (Gmail)

Constat sur un e-mail réel reçu de Trocoin (en-têtes bruts récupérés via une boîte de test lisible
par API, compte supprimé ensuite) :

```
From:        Trocoin <no-reply@trocoin.fr>
Return-Path: <0102…-000000@rsend.trocoin.fr>
DKIM:        d=trocoin.fr ; s=resend
```

DNS public de `trocoin.fr` (résolveur 1.1.1.1) : `resend._domainkey.trocoin.fr` TXT (clé DKIM,
domaine racine) ; `send.trocoin.fr` CNAME → `send.forge.rmta.net` et `rsend.trocoin.fr` CNAME →
`rsend-euw1.forge.rmta.net` (chacun portant, par la cible, un MX de retour et un SPF) ; racine :
MX OVH et `v=spf1 include:mx.ovh.com -all` ; `_dmarc.trocoin.fr` : `p=none`.

Ce que cela signifie :
- Gmail affiche « Envoyé par » avec le domaine de l'**enveloppe** (Return-Path, vérifié par SPF) et
  « Signé par » avec le domaine DKIM (`d=`). Ces deux lignes apparaissent dès qu'un message est
  authentifié ; elles ne disparaissent pas quand tout est aligné (Gmail les montre aussi pour
  `trocoin.fr` = `trocoin.fr`). Le « via » à côté du nom, lui, n'apparaît pas : le From et le DKIM
  sont déjà sur `trocoin.fr`.
- Le DKIM est **déjà aligné** (`d=trocoin.fr`) : une action sur le DKIM ne changerait rien.
- `rsend` n'est pas un nom choisi : c'est l'installation « CNAME » de Resend, qui crée le
  sous-domaine de retour (`send`, valeur par défaut) et un jumeau préfixé `r` ; le Return-Path est
  émis sur le jumeau, d'où `rsend.trocoin.fr` dans Gmail.
- Le sous-domaine de retour est personnalisable chez Resend (« custom return path », à l'ajout du
  domaine dans les options avancées, ou par l'API), avec la même construction : `mail` donnerait
  `mail` + `rmail`, et Gmail afficherait vraisemblablement `rmail.trocoin.fr`. Il doit rester un
  sous-domaine (règles : lettres, chiffres, tirets) ; le domaine racine est de toute façon pris par
  la messagerie OVH (MX et SPF `-all`). « Envoyé par : trocoin.fr » n'est donc pas atteignable avec
  Resend, et la ligne elle-même ne peut pas être retirée.

Conclusion transmise à l'utilisateur : rien à corriger côté code ; seule option, refaire le domaine
chez Resend avec un sous-domaine de retour choisi (action sur Resend et sur les DNS), pour changer
le libellé sans le faire disparaître ; à vérifier ensuite sur un envoi réel, comme ici.

## 26. Connexion sans mention du code SMS — 16 septembre 2026

La page de connexion affichait « Compte créé par SMS avant l'inscription par formulaire ? » et un
lien « Connexion par code SMS » vers `/connexion/sms`. La vérification par SMS étant désactivée
pendant la bêta (inscription par e-mail et mot de passe), ce parcours n'avait plus de sens :
- phrase et lien retirés de `LoginForm.tsx` ;
- `/connexion/sms` conservée comme adresse (anciens liens) mais redirige en 307 vers `/connexion`
  en gardant `next` ; le formulaire OTP du front (`OtpLoginForm.tsx`) est supprimé, il n'est plus
  accessible par URL directe ;
- les routes OTP de l'API (`/auth/register/phone`, `/auth/otp/verify`) restent : les tests s'en
  servent pour créer des comptes, et elles seraient le point de départ d'une réactivation du SMS.

Preuves : scénarios 03, 07 et 08 verts en local (21 réussis), CI run 35028403061 verte ;
`www.trocoin.fr/connexion/sms?next=/deposer` → 307 vers `/connexion?next=/deposer` ;
`www.trocoin.fr/connexion` sans le mot « SMS » ni lien vers `/connexion/sms` (capture).

## 27. « Renvoyer l'e-mail de confirmation » : rien reçu — 16 septembre 2026

Vérifications dans l'ordre demandé.

1. **Faux succès côté interface ?** Non : le bouton n'affiche « E-mail envoyé » qu'après une réponse
   200 de `POST /auth/email/resend`, et toute erreur donne un message d'erreur. Côté API, un envoi
   refusé par Resend ou expiré (10 s) lève une 503 : `resendEmailVerification` ne répond jamais
   `ok` sans que le fournisseur ait accepté le message.
2. **Refus serveur invisible ?** Les refus (déjà confirmée, moins de 60 s depuis le dernier
   envoi, 3 par heure et par IP) renvoient un message en français, mais l'interface ne le montrait
   que dans un message furtif en bas à droite, effacé au bout de 4,5 s ; seul « Renvoyer dans
   59 s » subsistait sur le bouton. Le message de la limite horaire disait de surcroît « patientez
   une minute ». Les journaux Render et le tableau de bord Resend n'ont pas pu être consultés
   (aucun accès depuis cet environnement) : ce point reste à lire par l'utilisateur.
3. **Accepté par Resend mais non délivré ?** Non vérifiable dans le tableau de bord (même raison).
   Sur une boîte de test lisible par API, chaque envoi (inscription puis renvoi) est arrivé en
   moins de dix secondes, de `no-reply@trocoin.fr`.
4. **Reproduction réelle, par l'interface** (compte créé sur `www.trocoin.fr`, supprimé ensuite) :
   clic 3 s après l'inscription → 400 « Un e-mail vient de vous être envoyé. Patientez une
   minute… », bouton « Renvoyer dans 59 s » ; clic après 60 s → 200, second e-mail reçu en 4 s ;
   nouveau clic dans la minute → 400 avec le même message. Aucun envoi perdu.

**Conclusion** : le mécanisme fonctionne ; ce que l'utilisateur a vécu correspond soit à un clic
dans la minute qui suit l'inscription ou un envoi précédent (refus signalé seulement par un message
furtif), soit à l'e-mail arrivé dans les indésirables (cf. §25, « Envoyé par : rsend.trocoin.fr »),
soit à la limite de 3 envois par heure après plusieurs essais. À défaut d'accès aux journaux, le
diagnostic exact de son cas est à lire dans Resend (Emails, filtrer sur son adresse) et dans les
logs Render (« E-mail de confirmation envoyé pour … » ou « Envoi e-mail impossible … »).

**Correctifs** : le résultat du dernier clic reste affiché sous le bouton (`data-testid=
"resend-status"`) : « E-mail envoyé à … à HH:MM. Ouvrez le lien… regardez vos courriers
indésirables » ou la raison du refus ; la limite horaire renvoie « Trop de demandes : au plus
3 e-mails de confirmation par heure… » (filtre d'exceptions, route `/auth/email/resend`) et le front
affiche ce message sur une 429. Scénario 02 : la raison du refus doit rester visible après la
disparition du message furtif.

**Preuves** : scénarios 02 et 12 verts (bureau et mobile), CI run 35029639412 verte ; rejeu réel
après déploiement : mêmes trois clics, message inline « Patientez une minute » puis « E-mail envoyé
à … à 00:19 … » sous le bouton, second e-mail reçu ; captures avant / après.

## 28. Aide « Se connecter » : plus de renvoi vers la connexion par code SMS — 16 septembre 2026

L'article d'aide `se-connecter` (section « Compte créé par SMS, sans mot de passe ») citait encore
« la page Connexion par code SMS (lien en bas du formulaire) », supprimée au §26. Il n'indique plus
que « Mot de passe oublié » (lien sous le champ du mot de passe), en précisant qu'une adresse e-mail
doit être rattachée au compte et que la connexion par code SMS n'est plus proposée. Recherche des
autres mentions : le message d'erreur de connexion de l'API pour un compte sans mot de passe disait
« utilisez la connexion par SMS » → « utilisez « Mot de passe oublié » pour en définir un » ; la page
Paramètres renvoyait déjà vers Mot de passe oublié ; les autres occurrences (CGU : « Trocoin peut
demander une vérification par code SMS », inscription : « aucun SMS n'est envoyé ») restent exactes.

Preuve : CI run 35030640853 verte ; `www.trocoin.fr/aide/se-connecter` contient le nouveau texte et
plus « Connexion par code SMS » (capture).

## 29. Préparation à Google Search Console ; profils en sections repliables — 16 septembre 2026

### 29.1 Exploration par Google (`docs/seo-checklist.md`, 20 points)

État avant ce tour, vérifié en production : sitemap de 101 URL sans aucune date et limité à 50
annonces ; `robots.txt` correct mais sans les écrans de mot de passe et de confirmation ; titres et
descriptions déjà uniques par catégorie et par fiche ; `Product`/`Offer` et `BreadcrumbList` déjà sur
les fiches, `Organization` et `WebSite` sur l'accueil ; 404 réels (annonce inconnue, page inconnue) ;
redirections sans boucle (au plus deux sauts, `http` → `https` → `www`).

Ajouté : sitemap avec **toutes les annonces en ligne** (pagination par 50, jusqu'à 2 000) et leur
`lastmod`, page Accessibilité ; `robots.txt` bloque aussi `/mot-de-passe-oublie`, `/reinitialiser`,
`/confirmer-email` (pas de panier sur Trocoin) ; `BreadcrumbList` sur les pages de catégorie ; titre
de fiche coupé à 60 caractères avant le prix. Rien à signaler sur la vitesse et l'affichage mobile
(scénario 11 à chaque CI). Reste à l'utilisateur : vérification DNS, envoi du sitemap, lecture des
rapports Pages et Données structurées.

### 29.2 Profils en sections repliables

`FilterSection` (accordéon des filtres) prend une clé de session dédiée et une taille d'en-tête de
section (`size="lg"`) ; les pages `/vendeurs/:id` gardent l'identité en tête puis empilent
« Annonces en ligne (n) » (ouverte), « Informations de la boutique » (pro seulement : description,
adresse, horaires, site ; repliée) et « Avis reçus (n) » (repliée). En-têtes = boutons dans un `h2`
avec `aria-expanded` / `aria-controls`, chevron tourné, contenu masqué non focusable, état mémorisé
pour la session (`sessionStorage`, clé `trocoin_profile_sections`).

**Preuves** : `e2e/16-profils.spec.ts` (+2 scénarios, bureau et mobile : ouverture au clavier
Entrée / Espace, état conservé après rechargement, boutique pro créée pour le scénario avec un SIRET
du registre simulé, axe sans violation avec sections ouvertes et repliées) ; scénarios 07 et 10 verts
(22 réussis en local) ; captures avant / après des profils particulier et professionnel, bureau et
375 px ; sitemap local 107 URL avec `lastmod` sur les annonces, `BreadcrumbList` servi sur
`/recherche?category=velos`.
- **Déploiement** : CI run 35033327433 verte (129 tests API SQLite et PostgreSQL, 97 scénarios
  navigateur dont 87 réussis et 10 passés volontairement, image Docker, Render). Production :
  `robots.txt` avec les trois nouvelles exclusions, sitemap 102 URL avec `/accessibilite` (aucune
  annonce en ligne en production à cet instant), `BreadcrumbList` servi sur
  `/recherche?category=velos`, annonce inconnue → 404. Un premier passage CI avait échoué sur le
  scénario 16 : joué après le scénario 05, le vendeur a déjà un avis ; l'assertion porte
  maintenant sur la visibilité du contenu replié, pas sur le texte « Pas encore d'avis ».
