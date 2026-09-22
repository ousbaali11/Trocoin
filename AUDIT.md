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
| Fichiers | MIME + signature binaire, ré-encodage `sharp` (orientation appliquée, **EXIF/GPS/ICC purgés**), ≤ 1600 px, fichiers corrompus rejetés, nom = UUID serveur, `nosniff`, 8 Mo max, photos sans plafond par annonce depuis §56 (10 fichiers par envoi), **150 photos/compte/24 h** | [exécuté] tests phase 7, 8, 9 | Stockage encore sur disque éphémère Render (§5) ; pas d'antivirus |
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
| Dépôt | Champs par catégorie, exemple de titre, photos, brouillon | Idem : 60 exemples de titre, schémas alignés (voir ci-dessous), photos retraitées (sans plafond par annonce, §56), brouillon, import CSV/XML, multi-utilisateurs pro, prix moyen constaté, fiche complète | Listes dépendantes marque → modèle → finition (référentiel constructeur absent) |
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

## 30. Barre des familles : panneau des sous-catégories aligné et en colonnes — 16 septembre 2026

Constat (capture de l'utilisateur, reproduit en production) : au survol ou au clic d'une famille,
le panneau des sous-catégories occupait toute la largeur de la page avec la liste collée au bord
gauche, loin de l'onglet ouvert (par exemple Électronique, quatre sous-catégories perdues dans un
bandeau vide). Le découpage en colonnes de 8 existait déjà, mais l'espace vide le rendait illisible.

Fait (`CategoryBar.tsx`, `CategoryBar.module.css`) : le panneau est large comme son contenu
(240 px au moins), **posé sous l'onglet ouvert** (bord gauche aligné, calcul au montage), et
ramené vers la gauche seulement s'il dépassait le bord droit de la barre (cas de Services, en bout
de barre) ; sous-catégories en **colonnes de 8 au plus**, sans retour à la ligne (une colonne jusqu'à
8, deux pour Services : 8 + 7). Menu mobile : les catégories passent d'une grille de deux colonnes
étroites à une seule colonne pleine largeur. Règle consignée dans `docs/design-system.md` §6.

**Preuves** : scénarios 14 (bord gauche du panneau = bord gauche de l'onglet à 2 px près, largeur
< 500 px, une colonne pour Véhicules, 8 + 7 pour Services, panneau contenu dans la page) et 15
(liens des catégories du menu mobile tous au même bord gauche) étendus, 07 vert ; CI run
35034817807 verte ; production : Électronique → panneau x = 666 = onglet x, largeur 240, 1 colonne ;
Services → 2 colonnes (8 + 7), bord droit 1264 ≤ 1280, ramené à gauche de l'onglet ; mobile → un
seul bord gauche (16 px) pour tous les liens. Captures avant / après bureau (deux familles) et mobile.

## 31. Étiquettes transporteur, phase 2 : Boxtal, adresse au paiement, parcours complet — 16 septembre 2026

- **Fournisseur réel** `BoxtalShippingProvider` derrière `IShippingProvider` (cotation v1 en GET +
  XML, jeton v3 en cache, commande, document PDF, suivi, points relais, annulation), erreurs typées
  (`non_configure`, `adresse_invalide`, `etiquette_impossible`, `transporteur_indisponible`,
  `reseau`) rendues 503 / 400 / 502 sans toucher à la vente ; `mock` conservé.
- **Adresse de livraison** saisie par l'acheteur au paiement pour un envoi (bouton « Payer » inactif
  tant qu'elle est incomplète), enregistrée sur la vente, vue des deux parties seulement, transmise
  au prestataire ; **facultative pour l'API** : les ventes antérieures et les anciens clients
  continuent sans étiquette, le vendeur saisit l'adresse ou son numéro de suivi comme avant.
  **Colis déclaré au dépôt** (poids, dimensions, facultatifs) prérempli dans le panneau vendeur.
  Migration `AdresseLivraisonEtColis` (colonnes toutes facultatives).
- **Parcours** : vendeur (mode domicile / point relais, colis, adresses, « Calculer le tarif »,
  choix du relais, « Acheter l'étiquette (x €) », PDF, numéro repris) ; acheteur (« Suivi de
  l'envoi » : transporteur, mode, numéro, lien, état, historique).
- **Diagnostic sandbox** `GET /shipping/diagnostic` pour vérifier la connexion avec les clés qui
  vivent sur Render, sans les copier.

**Preuves d'exécution (16 septembre 2026)**
- `npm test` : **135 tests réussis, 1 ignoré** (`phase20` +6 : faux Boxtal v1/v3 — cotation par
  transporteur et par mode avec prix TTC en centimes et code d'offre, points relais filtrés par
  réseau, commande → document → PDF → suivi → annulation, identifiants refusés, adresse refusée,
  indisponibilité ; adresse au paiement validée et ignorée en main propre ; colis au dépôt borné).
- Playwright : **99 scénarios** (`17-expedition` +2 : parcours complet avec téléchargement du PDF et
  suivi côté acheteur ; refus d'adresse → message, nouvel essai, saisie manuelle acceptée) ; 04, 05,
  07 verts ; CI runs 35037532126, 35038188268 et 35038904859 vertes (PostgreSQL avec la migration).
- **Test réel** (`GET https://api.trocoin.fr/shipping/diagnostic`, clés Render) : sandbox → 401 sur
  les deux API ; **hôte de production** → jeton v3 200, cotation v1 200 avec 27 offres (Mondial
  Relay relais 4,21 €, Colissimo retrait 9,14 €, Colissimo domicile 11,04 €), points relais réels
  autour de 75017. **Achat d'étiquette non tenté** : les applications sont dans le compte de
  production ; le bac à sable Boxtal est un compte séparé (`shipping.boxtal.build`). Détail et
  marche à suivre : `docs/etiquettes-transporteur.md` §8.
- Captures (pile locale, fournisseur simulé) : adresse au paiement, panneau vendeur avec tarif et
  point relais, étiquette prête avec PDF, suivi côté acheteur.

## 32. Recherche Google sur le nom « Trocoin » — 16 septembre 2026

Ce qui n'est pas activable par le code, consigné dans `docs/seo-checklist.md` pour ne pas être
redemandé : les liens de site (générés par Google selon la popularité et la structure) et l'encadré
de connaissance (graphe de connaissances alimenté par des sources externes).

Fait : `SearchAction` du `WebSite` déjà en place (cible `/recherche?q={search_term_string}`) ;
`Organization` avec logo **PNG 512 × 512** (`/logo.png`, généré à partir de l'icône ; le `.ico` ne
convenait pas), description, et **sans `sameAs`** (aucun profil public sur un réseau social n'existe,
rien d'inventé) ; titre de l'accueil « Trocoin — Les petites annonces entre voisins, en France »
(55 caractères) et description de 149 caractères fidèle au site. CI run 35040280613 verte ;
production : titre, description, Open Graph, JSON-LD et `/logo.png` (200, image/png) vérifiés.

## 33. Fiche annonce complète (inspirée de leboncoin), prix sous la photo, carte zoomée — 16 septembre 2026

Brief : « Fiche annonce complète (inspirée de leboncoin) + prix hors photo + zoom carte ».
Le statut de chaque élément de l'inventaire leboncoin est dans `docs/comparatif-leboncoin.md` §8
(14 lignes : 1 en place, 7 complétés, 4 ajoutés, 2 écartés avec la raison).

### Ce qui a été livré

**1. Carte de localisation** (`ListingsMap.tsx`, `DynamicMap.tsx`) : zoom 11 → **13** (rues et
quartiers lisibles) ; cercle de rayon réel inchangé (1,5 km, cohérent avec l'arrondi des
coordonnées publiques à 0,01°) mais **≈ 226 px de diamètre à l'écran au lieu de ≈ 58 px** (× 3,9),
trait de 3 px, fond teinté ; carte de 320 px de haut. La même carte est **ajoutée à l'aperçu avant
publication** du dépôt (`ListingForm.tsx`, `data-testid="preview-map"`, coordonnées arrondies comme
pour les visiteurs). Vérifié par le scénario 18 (tuiles `/13/` et cercle entre 150 et 320 px) et par
les captures.

**2. Fiche annonce** (`annonces/[id]/page.tsx` réécrite, nouveaux composants dans
`components/listing/`) :
- fil d'Ariane **Accueil › Famille › Catégorie › Région › Département › Ville › Titre** ; région et
  département dérivés du code postal côté API (`src/common/geo/france-admin.ts`, `location` sur le
  détail d'annonce) ; nouveau filtre de recherche `region=<identifiant>` (préfixes de code postal),
  département via `postal_code=69`, ville via `city=` ; `BreadcrumbList` aligné (scénario 10 mis à jour) ;
- galerie : cœur + **nombre de favoris**, menu **Partager**, bouton **« Voir les photos »** (plein
  écran avec flèches, compteur, clavier) ;
- bloc prix : ligne de repères selon la catégorie (**année · kilométrage · carburant**, surface ·
  pièces, marque · modèle), prix, **position par rapport au marché** (`MarketPosition.tsx` : jauge
  « Prix dans la fourchette / Bonne affaire / Au-dessus du marché » sur l'estimation existante
  `/listings/price-estimate`, rien sous trois annonces comparables), **« Publiée aujourd'hui / hier /
  il y a N jours »** (`daysAgo`) ;
- bloc vendeur (`SellerCard.tsx`) : **« Suivre »** (`FollowSellerButton.tsx` = recherche sauvegardée
  sur le critère `seller`, nouveau dans `SavedSearchQueryDto`, alerte à chaque nouvelle annonce,
  gérable dans « Mes recherches »), repères de confiance calculés uniquement (« Répond à X % des
  messages » dès 80 %, « N annonces en ligne ») ; pas de téléphone (jamais public) ;
- **« Les + de cette annonce »** (`ListingHighlights.tsx`) : récente, fiche complète, N photos,
  neuf, livraison, urgente, identité vérifiée, pro, options cochées ;
- **« Les informations clés »** (`KeyInfo.tsx`) : grille à deux colonnes, six visibles, « Voir les
  critères supplémentaires (n) » ; **« Équipements »** : options cochées à coches, dépliant ;
- **description** tronquée (8 lignes / 500 caractères) avec « Voir plus / Voir moins »
  (`ExpandableText.tsx`) ;
- **« Signaler l'annonce »** aussi en bas de fiche (`ReportListingButton.tsx`, partagé avec le
  bloc d'actions) ;
- **« Ces annonces peuvent vous intéresser »** : carrousel à accroche de défilement avec flèches
  (`CardCarousel.tsx`) et « Voir plus d'annonces » vers la catégorie ;
- badge **« Déjà vu »** sur les cartes (`lib/viewed.ts` : 100 derniers identifiants dans le
  navigateur + `GET /listings/history/ids` pour un membre, fusionnés ; jamais sur ses propres annonces).

**3. Exclus** (brief §3) : simulateur de crédit, assurance / garantie payante, publicités et
carrousels sponsorisés. Le paiement sécurisé Trocoin est inchangé.

**4. Prix hors photo** (`ListingCard.tsx` / `.module.css`) : la pilule sur la photo est retirée ; le
prix est **sous la photo, après le titre** (Fraunces 1,05 rem, encre) sur toutes les cartes. La
fiche affiche le prix une seule fois, sous le titre (aucune incrustation ailleurs).
`docs/design-system.md` §1, §3 et §5 mis à jour.

### Vérification

| Contrôle | Résultat |
|---|---|
| `npm test` (API, SQLite) | 135 réussis, 1 ignoré (tests étendus : `region=`, `location` du détail, `history/ids`, recherche sauvegardée `seller`) |
| `npx playwright test` (bureau + mobile, pile locale reconstruite) | 102 scénarios : 91 réussis, 10 ignorés, 1 échec ponctuel (14 « livraison » : bandeau rendu en double, aléa déjà connu de la diffusion Next) ; relance de 01 + 14 + 18 sur pile fraîche : 31 réussis, 2 ignorés |
| Nouveau scénario `e2e/18-fiche.spec.ts` (3 tests) | fil d'Ariane, galerie, bloc prix, informations clés, équipements, description, carte (tuiles zoom 13, cercle 150–320 px), signalement, carrousel ; « Déjà vu » visiteur puis membre ; « Suivre » aller-retour |
| Scénarios adaptés | 01 (prix sous la photo, hors de l'image, après le titre), 04 (« Les informations clés », équipements), 10 (`BreadcrumbList` à 7 niveaux) |
| Captures | `avant-fiche-complete.png` / `apres-fiche-complete.png` (fiche entière), `apres-carte-zoomee.png`, `apres-resultats-prix-sous-photo.png` (avec « Déjà vu »), `apres-depot-apercu-carte.png`, `apres-bloc-vendeur.png` |

### Limites connues

- La position par rapport au marché dépend du nombre d'annonces comparables en ligne : en
  production, tant qu'une catégorie compte moins de trois annonces, la jauge n'apparaît pas.
- Le badge « Déjà vu » d'un visiteur est propre à son navigateur (stockage local) ; il n'y a pas
  de suivi entre appareils sans compte.
- Le filtre `region=` n'a pas de commande dans le panneau de filtres : il est atteint par le fil
  d'Ariane et gardé dans l'adresse ; son libellé apparaît dans le sous-titre des résultats.

Déploiement : CI verte sur les deux commits, API Render en **1.15.0** (`/health`), front Vercel servant les nouveaux styles (`card-carousel` dans la feuille de style de `/recherche`) et le libellé de région sur `/recherche?region=ile-de-france`, vérifiés le 16 septembre 2026.

## 34. Rester connecté après la fermeture du navigateur — 16 septembre 2026

### Cause constatée

La session était bien en stockage local (jeton d'accès JWT de 15 min + jeton de renouvellement de
30 jours, tourné à chaque usage), mais **le chargement du compte au retour ne renouvelait jamais le
jeton d'accès** : `loadUser` (`frontend/src/lib/auth-context.tsx`) appelait `/users/me` en passant le
jeton explicitement, et le client HTTP ne tentait la rotation que pour les appels *sans* jeton
explicite. Résultat : après 15 minutes d'absence, `/users/me` répondait 401, le front effaçait la
session et l'utilisateur se retrouvait déconnecté, sur mobile comme sur PC — alors que son jeton de
renouvellement était encore valable 30 jours. Deux causes secondaires : une panne réseau pendant la
rotation effaçait aussi la session ; et deux onglets renouvelant en même temps faisaient passer le
second pour un vol de jeton (famille révoquée, déconnexion forcée).

### Mécanisme retenu (architecture inchangée : localStorage, pas de cookie)

- **Jeton d'accès court (15 min) + jeton de renouvellement long (30 jours glissants)**, comme avant,
  mais réellement utilisés : `ensureFreshToken()` (`frontend/src/lib/api.ts`) renouvelle d'abord le jeton
  d'accès s'il a expiré ou expire dans la minute (marge plafonnée au quart de sa durée de vie), au
  chargement du compte et avant tout appel ; un 401 déclenche encore une rotation puis un rejeu.
- **La session locale n'est effacée que sur un refus définitif du serveur** (401/403/400 : jeton
  révoqué, inconnu ou plus de 30 jours sans visite) ; jamais sur une panne réseau ou une erreur 5xx.
- **Onglets** : rotation sérialisée par un verrou navigateur (Web Locks) avec relecture du stockage
  (si un autre onglet vient de renouveler, on réutilise son jeton) ; évènement `storage` pour
  répercuter une déconnexion faite ailleurs. Côté API, un jeton tourné depuis moins de 30 s
  (`REFRESH_REUSE_GRACE_MS`) qui est représenté est refusé **sans** révoquer la session ; au-delà,
  la réutilisation reste traitée comme un vol (famille révoquée).
- **« Se déconnecter »** efface les deux jetons localement et révoque la famille côté serveur
  (`POST /auth/logout`) ; l'ancien jeton de renouvellement est ensuite refusé (401). Le jeton d'accès
  déjà émis expire de lui-même sous 15 min (sans état côté serveur, comme avant).
- **Double authentification** : demandée uniquement à la connexion par mot de passe (jeton
  intermédiaire de 5 min) ; le renouvellement n'y touche pas.

Cookie httpOnly : non retenu. Il serait un peu plus sûr contre un script injecté (XSS) et échapperait
à la limite de 7 jours que Safari applique au stockage local des sites sans interaction, mais il
impose CORS avec identifiants, une protection CSRF et une gestion de domaine entre `www.trocoin.fr`
et `api.trocoin.fr`. À reconsidérer si Safari iOS pose problème en pratique (la limite ne joue que
si l'utilisateur n'ouvre pas le site pendant 7 jours de navigation).

### Vérification

| Contrôle | Résultat |
|---|---|
| `npm test` (phase 3 étendue) | 135 réussis, 1 ignoré ; nouveau cas : réutilisation dans les 30 s → 401 « Jeton déjà renouvelé » sans révocation, réutilisation tardive → famille révoquée |
| `npx playwright test` (bureau + mobile, pile locale reconstruite) | 108 scénarios : 97 réussis, 11 ignorés, 0 échec |
| Nouveau `e2e/19-session.spec.ts` (bureau **et mobile**) | fermeture du navigateur puis retour avec un jeton d'accès expiré → toujours connecté, jeton tourné, ancien jeton toléré ; « Se déconnecter » → stockage vide, retour redemande la connexion, `/auth/refresh` avec l'ancien jeton → 401 ; 2FA : code à la connexion seulement |
| Preuve avec **vrai délai** (`preuve-session-5s.log`) : API locale démarrée avec `JWT_EXPIRES_IN=5s`, bureau puis mobile (Pixel 5) | connexion par le formulaire, **navigateur fermé, attente 8 s**, jeton seul refusé par l'API (401), réouverture avec le seul stockage local → `/compte` chargé, jeton tourné ; second retour après 7 s → toujours connecté ; « Se déconnecter » → stockage vide ; réouverture avec les anciens jetons → `/connexion`, `/auth/refresh` → 401 |
| Scénarios 19 et 03 rejoués contre cette API à jeton de 5 s | 8 réussis, 1 ignoré (aucune boucle de renouvellement) |
| Captures | `bureau-1-retour-connecte.png`, `mobile-1-retour-connecte.png`, `*-2-deconnecte.png`, `*-3-connexion-redemandee.png` |

### Limites connues

- Après « Se déconnecter », un jeton d'accès copié ailleurs reste valable jusqu'à 15 min (JWT sans
  état) ; le jeton de renouvellement, lui, est refusé immédiatement.
- Un utilisateur qui ne revient pas pendant 30 jours doit se reconnecter (`REFRESH_TOKEN_TTL_DAYS`,
  à augmenter dans Render si l'on veut plus long).
- Safari : stockage local purgé après 7 jours de navigation sans visite du site (limite du navigateur).

Déploiement : CI verte, API Render en **1.15.1** (`/health`), front Vercel servant le nouveau client de session (verrou `trocoin-refresh` présent dans le bundle), vérifiés le 16 septembre 2026.

## 35. Numéro de téléphone au dépôt, « Voir le numéro », statistiques par annonce — 16 septembre 2026

### Où est stocké le numéro

**Au niveau du compte, pas par annonce.** `users.phoneNumber` est déjà obligatoire et unique à
l'inscription (règle « un compte = un numéro de mobile français », normalisé `+33 6/7…`, validateur
`src/common/validators/french-phone.ts` réutilisé). Toutes les annonces d'un compte partagent donc ce
numéro ; il n'y a rien à ressaisir au dépôt et aucune colonne par annonce. Ce qui a été ajouté :

- **Garde-fou à la publication** : `POST /listings` (hors brouillon) et le passage d'une annonce en
  ligne refusent (400) un compte sans numéro valide — cas d'un compte importé ou d'une donnée
  corrompue, pas d'un compte créé par le formulaire. Le dépôt affiche alors, à l'étape « Aperçu »,
  un champ **Numéro de mobile (obligatoire pour publier)** ; le bouton « Publier » reste désactivé
  tant qu'un mobile français n'est pas saisi (06/07, formes courantes acceptées, même règle que
  l'API), puis le numéro est enregistré sur le compte (`PATCH /users/me { phoneNumber }`, accepté
  seulement si le compte n'en a pas encore ; unicité vérifiée) et réutilisé pour les annonces
  suivantes. Les brouillons restent possibles sans numéro.
- **Masquage** : `users.phonePublic` (vrai par défaut, migration `1789470000000-TelephoneEtStatistiques`).
  Au dépôt, un compte avec numéro voit « Afficher mon numéro sur cette annonce » (case cochée,
  réglage valable pour toutes ses annonces) ; le même interrupteur existe dans Paramètres › « Numéro
  sur mes annonces ».
- **« Voir le numéro »** sur la fiche (bloc d'actions, sous « Contacter le vendeur ») : proposé si
  le vendeur affiche son numéro et l'annonce est en ligne (`phoneAvailable` sur le détail) ; le
  numéro n'est **jamais dans le HTML** ni sur les cartes : il est délivré par
  `POST /listings/:id/phone` à un membre connecté (visiteur → connexion avec retour), puis affiché
  en lien `tel:`. Chaque clic incrémente `listings.phoneClicksCount` (sauf le propriétaire).

### Statistiques par annonce (« Mes annonces »)

Ligne sous chaque annonce publiée (pas sur les brouillons) : **vues · favoris · messages · appels**
(icônes œil, cœur, bulle, téléphone), fournie par `GET /listings/mine` (`stats`) au propriétaire seul.
- **Vues** : le compteur existait (`viewsCount`, agrégé sur le tableau de bord) mais il était
  incrémenté par la lecture API `GET /listings/:id`, donc par le rendu serveur (deux fois par
  affichage : métadonnées + page), les préchargements, l'aperçu rapide et les robots. Il est
  maintenant alimenté par `POST /listings/:id/view`, envoyé par le navigateur une fois la fiche
  affichée (`ViewedMarker`) : **une vue par affichage réel**, jamais pour le propriétaire, seulement
  pour une annonce en ligne. Le même appel alimente l'historique « Annonces consultées » d'un membre
  (la page étant rendue sans jeton, l'API ne le savait pas autrement : le badge « Déjà vu » et
  l'historique reposaient jusque-là sur des lectures API directes).
- **Messages** : nombre de conversations sur cette annonce (`conversations.listingId`), pas le total
  de la messagerie.
- **Appels** : clics sur « Voir le numéro » (`phoneClicksCount`).
- **Favoris** : nombre de membres l'ayant en favori.
- Jamais publiques : `phoneClicksCount` est retiré des cartes et de la fiche (`Omit` sur
  `ListingCard`), `stats` n'existe que sur `/listings/mine` ; vérifié par les tests.
- À jour à chaque chargement et **au retour sur l'onglet** (`visibilitychange` / `focus`
  rechargent la liste), sans WebSocket.

### Vérification

| Contrôle | Résultat |
|---|---|
| `npm test` | 138 réussis, 1 ignoré ; nouveau `test/phase21.e2e-spec.ts` (3 tests : garde-fou et numéro normalisé / unique / non modifiable, « Voir le numéro » réservé et masquable, statistiques exactes et privées) ; `listings` adapté (vues via `POST view`, numéro non modifiable) |
| `npx playwright test` (bureau + mobile) | 110 scénarios : 99 réussis, 11 ignorés, 0 échec |
| Nouveau `e2e/20-telephone-stats.spec.ts` | dépôt bloqué sans numéro (champ obligatoire, numéro invalide refusé, capture `depot-sans-numero.png`) puis accepté avec un mobile français enregistré sur le compte (`depot-avec-numero.png`) ; compte avec numéro : rien à ressaisir, case « Afficher » ; « Mes annonces » : 4 compteurs exacts après consultation, favori, message et deux « Voir le numéro » d'un membre (`mes-annonces-statistiques.png`, `fiche-voir-le-numero.png`), mise à jour au retour sur l'onglet, rien de public, bouton absent une fois le numéro masqué |
| Migration Postgres | jouée par le job CI Postgres 16 (`phonePublic`, `phoneClicksCount`) avant le déploiement Render |

### Choix et limites

- **Numéro visible par défaut** (`phonePublic = true`, y compris pour les comptes existants) : c'est
  ce que le brief demande (« Voir le numéro » sur les annonces, avec possibilité de masquer) ; la
  case du dépôt et le réglage des paramètres rendent le choix explicite. Passer le défaut à « masqué »
  tient en une valeur (`default: false` dans l'entité + migration).
- Le numéro n'est délivré qu'aux membres connectés (comme sur leboncoin), ce qui limite le
  moissonnage ; il reste joignable par les membres tant que l'annonce est en ligne.
- Les vues d'avant ce tour (comptées par lecture API) restent dans le compteur ; les nouvelles sont
  comptées par affichage réel, donc plus basses à trafic égal.

Déploiement : CI verte (migration `TelephoneEtStatistiques` jouée par le job Postgres 16, puis Render), API en **1.16.0** (`/health`) avec `POST /listings/:id/view` (200) et `POST /listings/:id/phone` / `GET /listings/mine` réservés aux membres (401), front Vercel servant la ligne de statistiques de « Mes annonces », vérifiés le 16 septembre 2026.

## 36. Test réel d'achat d'étiquette sur le sandbox Boxtal — 16 septembre 2026

Clés d'un compte `shipping.boxtal.build` sur Render (`BOXTAL_ENV=sandbox`, `SHIPPING_PROVIDER=boxtal`).
Détail, tableau par étape et cause de l'échec initial : `docs/etiquettes-transporteur.md` §8
« Deuxième test réel ».

- **Hôte de test confirmé** : jeton v3 sur `api.boxtal.build` (200), cotation v1 sur
  `test.envoimoinscher.com` (200, 23 offres), points relais v3 (200). Plus aucun appel n'est
  nécessaire sur l'hôte de production.
- **Premier essai d'étiquette refusé** (`422 NoShippingOfferException`) : le code d'offre v3 dérivé de
  la cotation v1 utilisait un tiret bas (`MONR_DomicileFrance`) ; l'API v3 attend un tiret
  (`MONR-DomicileFrance`). Diagnostic étendu (sonde en lecture seule des codes via
  `parcel-point-by-shipping-offer`, essais successifs, PDF renvoyé en base64) et **correction** du
  code dérivé (`OPÉRATEUR-Service`). Les codes `BOXTAL_OFFER_*` restent prioritaires.
- **Achat de test complet réussi** : commande `2609161233MONR50HZFR` (Mondial Relay domicile,
  9,72 € TTC sandbox), PDF de 3 508 octets (« Test Carrier / Test Service », code-barres), suivi
  « étiquette créée », **commande annulée** dans la foulée. Preuves : `diagnostic-sandbox-resultat.json`,
  `etiquette-test-sandbox.pdf`.
- **Parcours utilisateur réel** : préparé en production (comptes de test vendeur / acheteur sur
  `ousbaali11+vendeur-…@gmail.com` / `+acheteur-…`, annonce livrable, achat Colissimo avec adresse de
  livraison). Bloqué au paiement : Stripe Checkout (mode test) exige la saisie d'une carte, que
  l'assistant ne fait pas. Une fois la transaction `5b87cd20…` payée, le panneau du vendeur achète
  l'étiquette sur le sandbox et l'acheteur voit le suivi ; les comptes de test seront supprimés
  après ce dernier passage. Le parcours est couvert par `e2e/17-expedition.spec.ts` (simulé).
- Tests : `npm test` phase 20 adapté aux codes à tiret ; CI verte.

## 37. Expiration de l'autorisation bancaire pendant le séquestre — 16 septembre 2026

### Le délai réel (documentation Stripe, page « Bloquer une somme sur un moyen de paiement », lue le 16 septembre 2026)

- Carte en ligne, transaction initiée par le client (notre cas : Checkout) : **7 jours** pour Visa,
  Mastercard, American Express, Discover. Transaction initiée par le marchand : **5 jours** pour Visa
  (fenêtre exacte 4 jours 18 h). Passé ce délai, la retenue est levée et le paiement passe `canceled` :
  **le vendeur ne peut plus être payé**.
- La date exacte est fournie par Stripe pour chaque paiement (`payment_method_details.card.capture_before`
  sur le paiement) : c'est elle qui fait foi, pas une estimation.
- Autorisation prolongée (jusqu'à 30 jours, 29 j 18 h pour Visa) : réservée à la tarification IC+,
  +0,08 % par transaction hors hôtellerie / location, réseau par réseau. Trocoin la **demande « si
  disponible »** (`request_extended_authorization: if_available`) et lit le résultat, mais ne compte
  pas dessus. Klarna 28 jours, PayPal 10 + 10 jours (fournisseur PayPal différé).
- Constat sur le code : la seule gestion d'expiration existante (`expirePendingCheckouts`, statut
  `en_attente`) concernait la page de paiement non finalisée (30 min). Rien ne surveillait l'attente
  après autorisation : une réception confirmée au 8e jour aurait appelé `capture` sur un paiement
  déjà annulé, et le vendeur n'aurait rien touché.

### Solutions évaluées

| Piste | Verdict |
|---|---|
| Ré-autorisation automatique (annuler puis recréer une autorisation sur la carte enregistrée) | **écartée** : nouvelle transaction initiée par le marchand (fenêtre Visa réduite à 5 jours), soumise à un refus possible (plafond, carte bloquée, authentification forte hors session), double retenue visible par l'acheteur, et complexité forte (client Stripe, moyen de paiement enregistré) pour un bénéfice incertain |
| Séquestre sur le solde de la plateforme (capture immédiate, virement au vendeur à la confirmation, modèle « paiements et transferts distincts ») | **la plus robuste à terme** : plus aucune expiration, litiges sans limite de durée ; mais c'est un changement d'architecture Connect (transferts, annulations de transfert, responsabilité des soldes négatifs, entité de règlement) qui touche directement l'argent des utilisateurs : proposé, pas appliqué sans décision (voir « Recommandation ») |
| Réception présumée + capture avant expiration + action par défaut | **retenue** : reste dans le modèle actuel (capture manuelle, destination charges), garantit qu'aucune autorisation n'expire, protège l'acheteur par des rappels, une fenêtre de litige après capture et le remboursement possible après capture (`reverse_transfer`) |

### Mécanisme mis en place (`src/payments/payments.service.ts`, tâche toutes les 15 minutes)

1. **Date limite réelle** : à l'entrée en séquestre, `paidAt` et `captureBefore` sont enregistrés
   (Stripe `capture_before` relu dans `syncCheckout` ; sinon fenêtre la plus courte,
   `ESCROW_DEFAULT_AUTH_DAYS` = 5). L'action automatique a lieu `ESCROW_SAFETY_HOURS` (24 h) avant.
2. **Réception présumée** (article expédié) : confirmation automatique `ESCROW_AUTO_CONFIRM_DAYS`
   (4) jours après l'expédition, jamais après la marge de sécurité ; l'acheteur est prévenu à
   l'expédition (« confirmez ou signalez un problème avant le … »), 48 h avant et 24 h avant.
   Après capture, il garde `ESCROW_DISPUTE_WINDOW_DAYS` (7) jours pour ouvrir un litige, que
   l'admin peut trancher par remboursement (paiement capturé → remboursement avec annulation du
   transfert au vendeur).
3. **Échéance de l'autorisation** (action par défaut, rappels aux deux parties 48 h et 24 h avant) :
   - article expédié ou **litige ouvert** → **capture** (les fonds ne peuvent plus être perdus ; en litige
     ils restent bloqués jusqu'à la décision, remboursement possible) ;
   - ni expédié ni remis (colis non parti, remise en main propre sans code) → **annulation et
     remboursement** de l'acheteur, l'annonce reste en ligne.
   Aucune transaction ne dépasse donc l'échéance sans résolution.
4. **Filet de sécurité** : compteur « Séquestres à échéance (48 h) » sur le tableau de bord admin
   (lien vers la liste filtrée `?due=1`), avertissement dans les logs à chaque calcul, colonnes
   « Échéance » et « Automatique » dans la liste des transactions.
5. **Interface** : chronologie de la transaction (date limite, réception présumée), bandeau à
   l'acheteur « Confirmez la réception ou signalez un problème avant le … », bouton « Ouvrir un
   litige » encore proposé après une capture automatique tant que la fenêtre est ouverte.

### Compromis choisi et recommandation

Le mécanisme retenu garde l'argent en sécurité **dans les deux sens** : le vendeur qui a expédié est
payé au plus tard la veille de l'expiration, l'acheteur silencieux est relancé trois fois, et un
acheteur qui n'a rien reçu conserve sept jours de litige après la capture (remboursement avec
annulation du transfert). Le prix de ce compromis : un paiement peut être capturé avant que
l'acheteur ait confirmé (au plus 6 jours après l'autorisation), donc un remboursement après capture
dépend du solde Connect du vendeur — Stripe débite le compte connecté, la plateforme répond des
soldes négatifs (montants plafonnés à 2 500 €, fenêtre de litige courte, virements Stripe Express
différés de plusieurs jours en France).

**Recommandation pour la suite** : passer au séquestre sur le solde de la plateforme (paiements et
transferts distincts, capture immédiate, transfert au vendeur à la confirmation). C'est le modèle des
grandes places de marché, il supprime toute notion d'expiration et rend les litiges longs possibles
sans risque ; il demande une décision (Trocoin devient entité de règlement, responsable des
remboursements sur son solde) et un test Connect complet en mode test avant bascule. Le mécanisme
livré aujourd'hui reste valable tel quel jusque-là et la plupart de ses règles (réception présumée,
rappels, action par défaut) resteraient identiques après la bascule.

### Vérification

| Contrôle | Résultat |
|---|---|
| `test/phase22.e2e-spec.ts` (7 tests, fournisseur simulé, temps simulé) | date limite enregistrée et exposée ; rappels J-2 / J-1 puis réception présumée avec capture ; **cas limite** : expédition au 5e jour, réception présumée voulue au 9e → capture au 6e jour (avant l'expiration au 7e), vendeur payé ; non expédié → annulation + remboursement ; remise en main propre non confirmée → annulation, confirmée → rien ; litige à l'échéance → capture puis remboursement admin ; filet admin (`?due=1`, compteur) |
| `npm test` | 145 réussis, 1 ignoré (suite complète, SQLite) |
| Migration `SequestreEcheances` | jouée par le job CI Postgres 16 puis Render |

### Limites connues

- Les transactions en séquestre antérieures à ce déploiement reçoivent une date limite estimée
  (autorisation + 5 jours) au premier passage de la tâche : celles déjà au-delà seront traitées au
  passage suivant (capture si expédiées, annulation sinon), avec les notifications correspondantes.
- Stripe Checkout n'accepte pas d'autres moyens à capture différée que la carte dans cette
  intégration ; PayPal (10 + 10 jours) est différé et suivrait la même règle via `captureBefore`.
- Un remboursement après capture automatique suppose un solde suffisant sur le compte Connect du
  vendeur, sinon la plateforme avance les fonds (cf. compromis). Le passage au séquestre sur solde
  de plateforme lève cette limite.

Déploiement : CI verte (migration `SequestreEcheances` jouée sur Postgres 16 puis Render), API en **1.17.0** (`/health`), tâche `runEscrowSchedule` active toutes les 15 minutes, `GET /admin/transactions?due=1` réservé aux administrateurs (401 anonyme), vérifiés le 16 septembre 2026.

## 38. PayPal (phase 1 : conception) et audit-renforcement du panneau admin — 16 septembre 2026

### Partie A — PayPal, phase 1 (documentation seule, aucun code de paiement)

`docs/paypal-integration.md` (sources PayPal et Stripe lues le jour même) :

- **Faits relevés** : Orders API v2 en `intent=AUTHORIZE` → autorisation valable 29 jours, capture
  garantie 3 jours (« honor period »), ré-autorisation possible ; PayPal Commerce Platform (multiparty)
  → approbation de la plateforme par PayPal + onboarding de chaque vendeur (Partner Referrals) ;
  Payouts → compte professionnel, approbation, solde à alimenter ; politique d'utilisation acceptable
  : encaisser pour des tiers sans ce cadre est interdit. Côté Stripe : PayPal disponible pour les
  comptes français, compatible Connect en destination charges (notre modèle), capture différée
  10 + 10 jours, activation sur candidature dans le Dashboard Stripe.
- **Options** : 0 = PayPal *via Stripe* (recommandée : même séquestre, mêmes versements Connect, même
  fiche transaction, `captureBefore` déjà lu chez le fournisseur) ; A = Commerce Platform (chaque
  vendeur connecte son PayPal, solide mais double onboarding) ; B = PayPal propre + Stripe Connect
  (**déconseillée** : contraire aux conditions PayPal, fonds hors Stripe) ; C = Payouts (déconseillée).
- **Recommandation** : option 0 d'abord, puis A seulement si PayPal-via-Stripe n'est pas accordé ou
  si les frais l'exigent. **Décision laissée à l'utilisateur** (compromis expliqué dans le document).
- **À faire par l'utilisateur** : demander l'activation de PayPal dans le Dashboard Stripe (option 0)
  ou créer l'application sandbox PayPal (client ID / secret, comptes sandbox acheteur / vendeur,
  webhooks) pour l'option A. Les identifiants ne sont jamais à me transmettre : variables Render.
- **Architecture préparée** : `paymentProvider` par transaction, `PAYMENT_PROVIDERS` (plusieurs
  fournisseurs actifs), `paymentMethod` choisi au paiement, contrat `IPaymentProvider` conservé
  (`MockPaymentProvider` et Stripe intacts), point d'extension `reauthorize`, tests sur faux serveur.
  Rien de tout cela n'est codé tant que les identifiants n'existent pas.

### Partie B — panneau admin

**Étape 1, audit réel** (`docs/audit-admin.md`) : chaque écran et chaque route exercés sur la pile
locale par un script qui vérifie l'effet réel côté membre. **29 fonctions OK sur 32, 3 absentes** :
pas de suppression définitive d'un compte par l'admin, confirmation faible pour supprimer une annonce,
décisions impossibles hors litige, pas de fiche détaillée de transaction ; navigation à plat (8
entrées). Observation annexe : « urgent » et « whatsapp » ne déclenchent pas la pré-modération.

**Étape 2, droits ajoutés** (API + console) :

| Droit | Route | Garde-fous | Journal |
|---|---|---|---|
| Suppression définitive d'un compte | `DELETE /admin/users/:id` `{ reason, confirm: 'SUPPRIMER' }` | motif ≥ 5 car., mot exact, refusé pour soi-même et pour un admin ; transactions ouvertes annulées + remboursées, sessions révoquées, annonces retirées, données personnelles effacées (routine RGPD forcée) | `user.delete` + `transaction.force_refund` par transaction |
| Suppression définitive d'une annonce | `DELETE /admin/listings/:id` (même corps ; l'ancien `?reason=` est refusé 400) | annonce liée à une vente : seulement mise en pause | `listing.delete` (`hardDeleted`, `keptForTransactions`) |
| Décision sur toute vente ouverte | `POST /admin/transactions/:id/resolve` `rembourser \| liberer \| annuler` | note ≥ 5 car. transmise aux deux parties ; `annuler` impossible après capture ; remboursement possible après capture automatique tant que la fenêtre de litige est ouverte | `transaction.resolve` (litige) sinon `transaction.force_refund` / `force_capture` / `cancel` |
| Fiche détaillée | `GET /admin/transactions/:id` + page `/admin/litiges/:id` | parties, annonce, adresse, étiquette, échéances, journal lié, `decisions` calculées par l'API ; code de remise jamais renvoyé | — |
| Suspension (réversible) | inchangée, liée depuis la fiche transaction | connexion bloquée, annonces en pause, motif transmis, réactivable | `user.update` |

Dialogue commun `HardDeleteDialog` (composant `Modal` du site) : motif obligatoire + saisie de
**SUPPRIMER** (casse exacte), bouton inactif sinon. Journal : filtre `?target=` pré-rempli depuis les
fiches ; journal lié affiché sur la fiche transaction.

**Étape 3, réorganisation** : menu par domaine — Vue d'ensemble · Comptes · Annonces (annonces,
signalements) · Transactions (compteur litiges + séquestres à échéance) · Configuration (monétisation,
pages légales) · Traçabilité (journal). URL et thème inchangés (`docs/design-system.md` §9).

### Preuves

| Contrôle | Résultat |
|---|---|
| Script d'audit rejoué après livraison (pile locale neuve) | **34 OK / 34** (refus testés : sans mot, sans motif, soi-même) |
| `test/phase23.e2e-spec.ts` | 3 tests (suppression de compte : garde-fous, remboursements, effets, journal ; suppression d'annonce : corps obligatoire, 404, notification ; décisions hors litige et fiche détaillée, 403 / 404) |
| `npm test` | **148 réussis, 1 ignoré** (le test historique de suppression d'annonce mis au nouveau corps) |
| `e2e/21-admin-droits.spec.ts` | 3 scénarios réussis (menu groupé, dialogue annonce, fiche transaction + suppression de compte + journal) |
| Suite Playwright complète (113 scénarios) | 101 réussis, 11 ignorés, 1 échec sur le seul scénario du menu : compteur « Signalements 1 » laissé par les scénarios précédents — assertion rendue tolérante aux badges, scénario rejoué 3/3 ; suite complète rejouée par la CI |
| Captures « après » | menu groupé (tableau de bord), fiche transaction annulée avec journal lié, fiche utilisateur avec bloc « Suppression définitive », dialogue de suppression de compte, dialogue annonce (bouton inactif sans le mot), journal filtré par cible, liste des transactions avec « Fiche détaillée » |
| Lint / typecheck | API et front sans erreur (règle `react-hooks` : les décisions possibles sont calculées par l'API, plus de `Date.now()` au rendu) |

### Compromis et questions à trancher

1. **PayPal** : option 0 (via Stripe) recommandée ; option A si PayPal refuse ou pour des frais plus
   bas. Sans identifiants, rien n'est codé. À décider : laquelle demander.
2. **Suppression d'un compte avec ventes en cours** : implémenté comme « rembourser d'office les
   transactions ouvertes puis effacer » (un compte frauduleux ne reste pas vivant grâce à une vente).
   L'alternative (refuser la suppression tant qu'une vente est ouverte, comme l'auto-suppression) est
   plus prudente pour un acheteur honnête qui attend un colis déjà expédié : à confirmer, ou à
   restreindre aux ventes non expédiées.
3. **Réactivation d'un compte suspendu** : les annonces restent en pause (le membre les remet en
   ligne) — à documenter dans l'interface ou à automatiser.
4. Pré-modération : ajouter « urgent », « whatsapp » à la liste surveillée (tour dédié).

Déploiement : CI verte (typecheck, tests API SQLite et PostgreSQL 16, image Docker, Playwright, Render), API en **1.18.0** (`/health` : postgres ok), `DELETE /admin/users/:id`, `DELETE /admin/listings/:id` et `GET /admin/transactions/:id` répondent 401 sans jeton, front Vercel à jour (menu regroupé `admin-nav-title` présent dans le bundle, `/admin/litiges/:id` servi). Aucun compte de test créé en production pour ce tour.

## 39. Séquestre robuste : les fonds restent chez Trocoin jusqu'à la confirmation — 16 septembre 2026

### Décision appliquée

Passage du modèle Stripe « destination charge » (capture à la confirmation, fonds versés au vendeur
à la capture) au modèle « **paiements et transferts distincts** » : la capture met l'argent sur le
solde de Trocoin, qui n'expire pas ; le vendeur est payé par un **Transfer** séparé à la
confirmation. Le risque d'expiration de l'autorisation (§37) disparaît, un litige peut durer sans
limite, et un remboursement avant virement ne dépend plus du solde du vendeur.

### Choix faits (et pourquoi)

| Point | Choix | Raison |
|---|---|---|
| **Moment de la capture** | au plus tard **24 h** après l'autorisation (`ESCROW_CAPTURE_AFTER_HOURS`), **immédiatement** dès que le vendeur expédie ou se déclare prêt, ou qu'un litige s'ouvre ; garde-fou : jamais après la marge de sécurité de l'autorisation | pendant ces 24 h, une annulation (acheteur qui se ravise, vendeur indisponible, alerte fraude Radar) **libère l'autorisation** : aucun débit, aucun remboursement, et les frais Stripe de la charge ne sont pas perdus (Stripe ne les restitue pas sur un remboursement). Au-delà, l'argent est en sécurité chez Trocoin bien avant les 7 jours |
| **Transfert au vendeur** | à la confirmation seulement : réception confirmée, code de remise, décision admin « libérer », réception présumée ; montant net = prix − commission 8 % (frais acheteur et commission restent chez Trocoin) ; `source_transaction` = charge de l'acheteur, `transfer_group` = identifiant de la vente | adossé à la charge, le virement ne dépend pas du solde disponible global de la plateforme (sinon refusé pendant ~7 jours de règlement) ; traçable côté Stripe |
| **Vendeur sans compte de versement** | vente confirmée quand même, virement **en attente**, retenté toutes les 15 minutes dès que le compte existe, notification « Versement effectué » | avant : « la plateforme encaisse et reverse manuellement » ; maintenant automatique et journalisé |
| **Remboursement avant virement** | `refund` depuis le solde de Trocoin (autorisation non capturée : simple libération) | plus simple et plus sûr qu'avant |
| **Remboursement après virement** | annulation du virement (`transfers.createReversal`, compte du vendeur débité, solde négatif possible dont la plateforme répond) **puis** remboursement de l'acheteur ; si l'annulation échoue, l'acheteur est quand même remboursé et l'erreur journalisée pour récupération manuelle | l'acheteur d'abord ; c'est le même point faible qu'avant, mais limité à la fenêtre de 7 jours après une confirmation automatique |
| **Réception présumée** | **7 jours** après l'expédition (`ESCROW_AUTO_CONFIRM_DAYS`, avant : 4 plafonnés par l'autorisation), rappels 48 h et 24 h avant, litige encore possible 7 jours après | plus de pression de capture ; 7 jours couvrent l'acheminement et le retrait en point relais ; sert seulement à décider quand payer le vendeur |
| **Délai d'expédition / remise** | **7 jours** après le paiement (`ESCROW_SHIP_DEADLINE_DAYS`, avant : ~6 jours imposés par l'autorisation), rappels 48 h et 24 h avant, puis annulation et remboursement ; remise en main propre : le code saisi est la seule preuve, un vendeur « prêt » sans code est annulé à l'échéance | l'acheteur n'attend pas indéfiniment ; le vendeur n'est jamais payé sans preuve de remise |
| **Litige** | capture immédiate à l'ouverture, aucune action automatique ensuite | les fonds n'expirent pas ; le médiateur décide sans contrainte de délai |
| **Transition** | colonne `escrowModel` : `destination` pour toutes les ventes existantes à la migration, `platform` pour les nouvelles ; l'ancienne logique (§37) reste entière pour les premières (tests phase 22 conservés, modèle forcé) | aucune migration forcée d'une vente en cours ; les deux modèles cohabitent dans la tâche, l'admin voit le modèle sur la fiche |

### Code

- `src/payments/payment-provider.interface.ts` : `transfer(params)` et `reverseTransfer(id)` sur tous les
  fournisseurs ; `transferGroup` à la création ; `sellerConnectedAccountId` ne sert plus qu'à l'ancien modèle.
- `src/payments/stripe-payment.provider.ts` : charge plateforme (`transfer_group`), `transfers.create`
  (`source_transaction`, `transfer_group`, métadonnées), `transfers.createReversal` ; `refund` inchangé
  (libération ou remboursement ; `reverse_transfer` seulement pour une ancienne destination charge).
- `src/payments/payments.service.ts` : `ensureCaptured`, `payoutSeller`, `settle`, `refundBuyer`,
  `settleAutomatically` ; `runEscrowSchedule` par modèle (capture à 24 h, réception présumée, délai
  d'expédition, virements en attente) ; `escrowDueSoon` et la liste admin `?due=1` sur les deux modèles.
- `src/payments/transaction.entity.ts` + migration `SequestrePlateforme` : `escrowModel`, `capturedAt`,
  `shipBy`, `transferId`, `transferredAt`.
- Interface : chronologie de la transaction (« Paiement encaissé par Trocoin le … », « Expédition à faire
  avant le … », « Fonds versés au vendeur le … », versement en attente pour un vendeur sans compte), fiche
  admin (modèle, encaissement, virement, échéance), aide « Comment fonctionne le paiement sécurisé ».

### Vérification

| Contrôle | Résultat |
|---|---|
| `test/phase24.e2e-spec.ts` (8 tests, fournisseur simulé instrumenté, temps simulé) | création (modèle platform, `shipBy`, pas de capture avant 24 h, capture après, idempotente, annulation avant capture = simple libération) ; parcours nominal (capture à l'expédition, virement de 92 € sur 100 € à la confirmation, rien ensuite) ; vendeur sans compte (virement en attente puis effectué par la tâche, notification) ; remboursement avant virement (litige, `refund` seul) ; remboursement après virement (réception présumée au 12e jour, au-delà de l'ancienne autorisation, puis `reverse` + `refund`) ; non expédié (rappels puis annulation, `capture` puis `refund`) et remise sans code ; litige avant capture (capture à l'ouverture, aucune action à J+45, « libérer » → virement) ; filet admin `?due=1` sur les deux échéances, litige exclu |
| `test/phase22.e2e-spec.ts` (ancien modèle forcé) | 7 tests inchangés : l'ancienne logique reste entière pour les ventes antérieures |
| `npm test` | 156 réussis, 1 ignoré |
| Playwright | scénarios achat, expédition et console admin rejoués sur la pile locale ; suite complète par la CI |
| Migration `SequestrePlateforme` | jouée par le job CI Postgres 16 puis Render ; les lignes existantes passent en `destination` |

### Plafond de 2 500 € et fenêtre de litige de 7 jours : recommandation

**Les garder pour l'instant, sans les changer.** Le plafond protège désormais Trocoin lui-même : dans
ce modèle la plateforme est le marchand de la charge, donc responsable des contestations bancaires
(chargebacks) et des remboursements après virement. La fenêtre de 7 jours après une confirmation
automatique borne le seul cas où un remboursement dépend encore du compte du vendeur. À reconsidérer
avec des données réelles (taux de litiges, délais moyens), pas avant.

### Points d'attention signalés (non résolus ici)

1. **Fonds détenus pour compte de tiers** : le solde Stripe de Trocoin porte l'argent des acheteurs
   entre la capture et le virement ; suivi comptable dédié et qualification juridique (exemption
   d'agent commercial / statut PSP) à voir avec un conseil.
2. **Calendrier des virements Stripe vers la banque de Trocoin** : un remboursement après que Stripe a
   reversé le solde sur le compte bancaire tire le solde en négatif (prélèvement bancaire par Stripe) ;
   régler un délai ou une réserve (`DEPLOIEMENT.md` §5c).
3. **Pas de clé Stripe de test disponible localement** : les appels Transfer / reversal sont vérifiés
   par la forme (documentation Stripe) et par le fournisseur simulé, pas contre l'API réelle. Un achat
   de test en mode test Stripe (carte de test saisie par vous), puis confirmation, permettra de voir le
   Transfer dans le Dashboard Stripe (Connect → Transfers) et sa réversion après un remboursement admin.
4. Les notifications de l'ancien modèle (« encaissé avant l'expiration de l'autorisation ») ne
   s'affichent plus que pour les ventes antérieures.

Déploiement : CI verte (migration `SequestrePlateforme` jouée sur Postgres 16 puis Render : les ventes existantes passent en `destination`, les nouvelles naissent en `platform`), API en **1.19.0** (`/health` : postgres ok), front Vercel à jour (aide « encaisse et conserve » présente dans le bundle). Aucun compte de test créé en production pour ce tour ; la première vente réelle en mode test Stripe (carte de test saisie par vous) doit faire apparaître un Transfer dans Connect → Transfers à la confirmation.

## 40. PayPal via Stripe, suppression bloquée par une vente expédiée, réactivation et pré-modération — 16 septembre 2026

### 1. PayPal via Stripe (option 0 retenue)

- **Constat sur le code** : la session Stripe Checkout ne fixait déjà aucun `payment_method_types`
  (Stripe propose les moyens activés dans le Dashboard et compatibles avec la capture différée) ; il n'y
  avait donc pas de restriction à la carte à retirer. L'intention est maintenant écrite dans le
  fournisseur, et le moyen réellement utilisé (`payment_method_details.type` : `card`, `paypal`, …) est
  relu à l'autorisation et mémorisé (`transactions.paymentMethod`, migration `MoyenDePaiement`), affiché
  au membre (« Paiement sécurisé via PayPal ») et à l'admin. Aucun libellé, e-mail ou notification ne
  parlait « de carte » : les textes disent « paiement », « autorisation », « moyen de paiement ».
- **Rien de câblé sur des identifiants PayPal** : `paypal-payment.provider.ts` (simulé) et les variables
  `PAYPAL_*` restent déclarés mais inutilisés, réservés à l'option Commerce Platform si elle devenait
  utile ; `docs/paypal-integration.md` §7 documente l'option retenue et mise en œuvre.
- **Découverte en testant en production** : la création de la page Checkout répondait **503** depuis le
  tour §37. Cause : `payment_method_options.card.request_extended_authorization` (autorisation prolongée,
  §37) n'existe pas dans les types Checkout du SDK Stripe 16 (le code le masquait par un `as unknown as`)
  et l'API le refuse (« unknown parameter »). Le paramètre est retiré — il n'a plus d'objet depuis le
  séquestre sur le solde (§39, capture sous 24 h). Le message 503 porte désormais le type et le code
  d'erreur du fournisseur (jamais de secret) pour diagnostiquer sans accès aux logs.
- **Test en mode test Stripe** : voir « Vérification » (page Checkout réelle ouverte depuis une transaction
  de production, sans paiement).

### 2. Suppression définitive bloquée par une vente expédiée ou un litige

`AdminService.deleteUser` : une vente **expédiée** (ou remise en main propre déclarée prête, en attente du
code) ou un **litige** en cours, où le compte est acheteur ou vendeur, fait refuser la suppression (400)
avec le décompte et la marche à suivre : attendre la confirmation de réception ou trancher le litige, et
**suspendre** en attendant (réversible, disponible sans condition). Une vente **non expédiée** est toujours
annulée et remboursée d'office avant la suppression (comportement §38 conservé pour ce seul cas). Textes
de la fiche utilisateur et du dialogue mis à jour.

### 3. Corrections annexes

- **Réactivation** : les annonces mises en pause **par la suspension** (marquées « Compte suspendu »)
  reviennent en ligne ; celles dont la durée de vie s'est écoulée entre-temps passent « expirée » (le
  membre les renouvelle) ; une annonce mise en pause par le membre lui-même reste en pause. Le journal
  d'audit de la réactivation porte `listingsRestored { republished, expired }`.
- **Pré-modération** : nouvelle règle « signaux d'arnaque (urgence, messagerie externe) » —
  `urgent(e)(s)`, `urgence`, `whatsapp`, `whats app`, `wa.me`, `telegram` — l'annonce passe « à
  vérifier » comme pour les autres mots surveillés. Un « urgent » légitime coûte une revue humaine
  (philosophie du fichier `moderation.ts`).

### Vérification

| Contrôle | Résultat |
|---|---|
| `test/phase25.e2e-spec.ts` (5 tests) | suppression refusée pour vente expédiée (vendeur et acheteur), message avec décompte, rien remboursé, suspension immédiate possible, suppression acceptée après confirmation ; refus pour remise en attente du code et pour litige, vente non expédiée encore remboursée d'office ; réactivation (en ligne / expirée / pause du membre conservée, journal) ; « urgent » et « WhatsApp » en vérification, annonce ordinaire publiée ; moyen `paypal` relu et mémorisé via un faux Checkout, charge plateforme sans restriction de moyen |
| `npm test` | 161 réussis, 1 ignoré |
| Playwright (achat, console admin, accessibilité admin) | rejoués sur la pile locale ; suite complète par la CI |
| Migration `MoyenDePaiement` | jouée par le job CI Postgres 16 puis Render |

**Test en production (mode test Stripe, 16 septembre 2026, ~15 h 25)** : après le déploiement 1.20.0, la création de la page Checkout fonctionne de nouveau (avant : 503 sur le paramètre d'autorisation prolongée). Page ouverte sans rien payer : moyens proposés **Carte, Klarna, Satispay** — **PayPal absent** : l'activation « place de marché » côté Dashboard Stripe n'est pas encore approuvée. Aucun déploiement ne sera nécessaire quand elle le sera : le bouton apparaîtra de lui-même (aucune restriction dans la session). Comptes et annonce de ce test supprimés (auto-suppression RGPD, 204). **Reste à nettoyer par vous** (console admin) : le premier essai, tombé sur le 503 avant que le script n'ait sauvegardé ses identifiants, a laissé un compte vendeur `7f7b0b44-8bce-4adc-8140-6747a440242a` (« Test V. », e-mail `ousbaali11+trocoin-paypal-vendeur-<6 chiffres>@gmail.com`, le numéro est dans votre boîte Gmail) avec l'annonce `6385ab24-70ca-43e9-a3b4-ebb42b69e910` « Enceinte de test PayPal (ne pas acheter) », et un compte acheteur `…+trocoin-paypal-acheteur-<mêmes chiffres>@gmail.com` sans transaction.

Déploiement : CI verte (migration `MoyenDePaiement` sur Postgres 16 puis Render), API en **1.20.0** (`/health` : postgres ok), front Vercel à jour.

## 41. Suppression réellement définitive (trace comptable conservée) et bug de la page Traçabilité — 16 septembre 2026

### 1. Bug Traçabilité : cause exacte

Pas d'accès aux logs Render depuis cette machine (aucune clé ni CLI) ; la cause a été établie par lecture
du code puis **reproduite par un test** que la CI joue sur Postgres 16. La page appelle
`GET /admin/audit-log` ; le service cherche ensuite les noms des administrateurs avec
`users.id IN (…adminId…)`. Or le script `create-admin` (celui qui a promu votre compte le 15 septembre,
contre la base Frankfurt) écrit une entrée avec **`adminId = 'cli'`**. Sur SQLite (tests locaux) la
comparaison passe ; sur Postgres, `users.id` est de type `uuid` et `'cli'` déclenche « invalid input
syntax for type uuid » → 500 → « Erreur interne. Réessayez plus tard. ». Correction : seuls les
identifiants de forme uuid sont recherchés ; l'entrée CLI s'affiche « Script d'administration (CLI) »,
un admin effacé « Compte administrateur supprimé ». Test `phase26` : une entrée `cli` insérée puis le
journal lu (200) — le job CI Postgres l'exécute.

### 2. Suppression réelle, règle de conservation (`src/retention/retention.service.ts`)

| Objet supprimé | Ce qui est effacé de la base | Ce qui est conservé |
|---|---|---|
| **Annonce** (par le membre ou l'admin) | la ligne, ses photos (fichiers compris), favoris, historique de consultation, transactions **jamais payées** (page de paiement abandonnée) | **ventes payées** (`paidAt` renseigné, quel que soit leur sort ensuite) : montant, dates, références de paiement et de virement, **titre de l'annonce** (`transactions.listingTitle`, rétro-rempli par la migration) — affichées « *titre* (annonce supprimée) » ; conversations et messages (l'autre partie voit « Cette annonce n'existe plus ») ; signalements ; journal d'audit |
| **Compte** (auto-suppression RGPD ou admin) | la ligne utilisateur (identifiants libérés : numéro, e-mail, pseudo), ses annonces (règle ci-dessus), transactions jamais payées, avis reçus, favoris, historique, blocages, recherches sauvegardées, notifications, abonnements, jetons de session et de vérification, avatar et logo | **ventes payées** où il est partie : conservées sans données personnelles (adresse de livraison de l'acheteur, code de remise et adresses des étiquettes effacés), partie affichée « Compte supprimé » (membre, admin) ; avis rédigés (la note des autres ne change pas, auteur « Compte supprimé ») ; conversations et messages de l'autre partie ; signalements ; journal d'audit |

Fondement de l'exception : obligation de conserver les pièces comptables des ventes (code de commerce,
art. L123-22, 10 ans). Le journal d'audit conserve « qui a supprimé quoi, quand, pourquoi » : entrée
séparée (identifiants, motif, pseudo au moment de la suppression, décomptes), pas une copie du contenu.
Plus aucune ligne « Supprimé » dans les listes Annonces et Comptes (filtre « supprimés » retiré) ; une
fiche d'un objet effacé répond 404.

Comportements dérivés vérifiés : `findPublicSummary` renvoie un libellé « Compte supprimé » pour tout
identifiant absent (ventes, conversations, avis, signalements ne cassent pas) ; suppression admin d'un
compte : toujours refusée si une vente expédiée ou un litige est en cours (§40), vente non expédiée
remboursée avant l'effacement ; réponse `{ deleted, refundedTransactions, listings, keptTransactions,
deletedTransactions }`.

### Vérification

| Contrôle | Résultat |
|---|---|
| `test/phase26.e2e-spec.ts` (5 tests) | journal avec entrée `cli` (200, libellé) ; annonce supprimée : base, fiche et liste admin, public, photos, favoris, historique, transaction non payée effacés, conversation de l'autre membre lisible avec annonce absente, journal conservé ; annonce liée à une vente payée : annonce effacée, vente conservée (montant, dates, références, titre) et affichée « (annonce supprimée) » au membre et à l'admin ; compte supprimé : ligne, fiche, liste, profil, annonces, favoris, notifications, avis reçus effacés, vente payée conservée sans adresse ni code, « Compte supprimé » côté vendeur et admin, avis rédigé conservé, conversation lisible, journal, numéro réutilisable ; auto-suppression RGPD : même effacement |
| Suites adaptées | `phase10`, `phase23`, `phase25`, `transactions` (plus de ligne anonymisée : 404, réinscription avec le même numéro) |
| `npm test` | 166 réussis, 1 ignoré |
| Playwright (console admin, achat) | rejoués sur la pile locale ; suite complète par la CI |
| Captures | listes Annonces / Comptes avant et après suppression (aucune ligne fantôme), page Traçabilité fonctionnelle avec les entrées de suppression et l'entrée CLI, fiche admin et page vendeur d'une vente payée dont l'acheteur est supprimé (trace comptable anonymisée) |
| Migration `Retention` | jouée par le job CI Postgres 16 puis Render |

Déploiement : CI verte (le test `phase26` avec l'entrée `cli` passe sur Postgres 16, migration `Retention` jouée puis Render), API en **1.21.0** (`/health` : postgres ok), front Vercel à jour. La page Traçabilité en production se vérifie avec votre compte admin (aucun accès admin depuis cette machine) : la cause est corrigée et reproduite par le test Postgres de la CI. L'annonce orpheline du premier essai PayPal (§40) répond désormais 404 : nettoyage constaté.

## 42. Audit complet et exhaustif de tout Trocoin — 16 septembre 2026

Rapport page par page : `docs/audit-final.md` (inventaire des routes depuis le code, statut de chaque page,
sécurité, design, organisation, attractivité, paiement). Ce paragraphe résume la méthode, les corrections et
les preuves.

### Méthode

- **Inventaire réel** : 47 routes front (`frontend/src/app/**/page.tsx`) et 142 routes API (décorateurs des
  contrôleurs, gardes, throttling, DTO — table générée par script).
- **Crawl automatisé** sur la pile locale (`scratchpad/crawl-site.js`) : chaque page en bureau 1280 px et
  mobile 375 px, en anonyme, acheteur, vendeur, professionnel et administrateur (données créées par l'API :
  annonces, conversation, transaction expédiée, signalement, favori). Par chargement : erreurs console et
  exceptions JS, réponses réseau ≥ 400, défilement horizontal, marges mobiles (≥ 12 px), liens internes morts,
  unicité du h1, capture d'écran. Trois passages : 134 chargements avant correction (18 constats), puis après
  chaque série de corrections jusqu'à **zéro constat réel** (seuls restent les 404 / 400 attendus des pages
  « annonce inconnue », « page inexistante » et « jeton e-mail invalide », qui sont le comportement voulu).
- **Revue manuelle** des 101 captures sur planches contact (design, organisation), relecture du code
  (frais, catégories, états des listes, textes), balayage des autorisations par test automatisé.

### Corrections livrées

| Domaine | Constat | Correction |
|---|---|---|
| Sécurité | `DELETE /conversations/:id` et `POST /notifications/:id/read` répondaient 200 (sans effet) à un tiers | 404 / 403 explicites ; balayage IDOR `test/phase27.e2e-spec.ts` (transactions, expédition, annonces, messagerie, recherches sauvegardées, notifications, 19 routes admin × membre / anonyme) |
| Sécurité | « Voir le numéro » sans limite dédiée (collecte de numéros possible à 100 / min) | 30 appels / heure / IP |
| Bruit d'erreur | `GET /transactions/:id/shipment` en 404 sur toute vente sans étiquette (erreur console sur la page transaction, acheteur et vendeur) | 200 vide ; test phase 18 adapté |
| Mobile | notifications : la date poussait le texte hors écran ; messagerie : bouton « Envoyer » hors écran ; boutique : champ fichier natif débordant ; tableaux admin (annonces, utilisateurs, journal, réglages, fiche utilisateur) élargissant toute la page | grille étiquette / contenu / date ; champ réductible et libellé d'offre masqué sous 480 px ; bouton « Choisir un fichier » ; tableaux en défilement interne — cause réelle trouvée par mesure : les libellés `.sr-only` (position absolue) des boutons de cellules, posés à leur position statique, élargissaient le document → `position: relative` sur le tableau |
| Mobile | bandeau « confirmez votre e-mail » répété et encombrant sur chaque page du compte ; filtres rapides de la recherche empilés sur trois lignes | bandeau compact (détail masqué, bouton conservé) ; ligne défilante |
| Textes | « 1 annonces en ligne » ; « acheteur remboursé » sur un paiement jamais finalisé ou une autorisation simplement libérée | pluriel ; texte de clôture selon le cas réel (non finalisé / autorisation libérée / remboursé) |
| Accueil | grille « dernières annonces » presque vide sur un site jeune (1 annonce en production) | carte d'invitation « Vendez le vôtre » quand moins de 4 annonces ; bandeau de réassurance sous la recherche |
| Cohérence | état vide des avis différent des autres listes ; couleur codée en dur (paramètres) ; rayons hors grille (aperçu rapide, carte) ; lieu tronqué à rien à côté de « Livraison » sur les cartes | `EmptyState` commun ; jetons ; largeur minimale du lieu |
| Admin | filtre « supprimés » sans objet depuis la suppression réelle (§41) | retiré |

### Ce qui a été vérifié sans correction nécessaire

Frais (calcul unique côté API, affichage cohérent partout), catégories (une seule source `GET
/categories/tree`), listes (squelette + `EmptyState` + tri commun), actions principales / secondaires (un
seul bouton plein par écran), validation serveur (`ValidationPipe` global + DTO partout), secrets (aucun
côté client), séquestre plateforme (affiché acheteur / vendeur / admin, §39), erreurs de paiement (Checkout
Stripe, retour annulé, session expirée, 503 avec code fournisseur), PayPal toujours **en attente
d'activation** côté Dashboard Stripe (constaté §40, inchangé).

### Reporté (à traiter dans un tour dédié)

1. Accroche de marque au-dessus de la recherche (illustration ou photo, promesse en une phrase) et rangée
   « annonces près de chez vous » géolocalisée sur l'accueil (attractivité, points 5 du rapport).
2. Message dédié sur `/confirmer-email` avec un jeton invalide (aujourd'hui message brut de validation).
3. Mentions légales encore en gabarit ([Raison sociale]…) : à compléter par l'éditeur via le CMS admin.
4. Inscription professionnelle avec SIRET dans le crawl : refusée une fois sur deux (SIRET déjà utilisé par
   un compte précédent du crawl) — pas un défaut du site, mais l'espace pro n'a été crawlé qu'au premier
   passage.

### Vérification

| Contrôle | Résultat |
|---|---|
| Crawl final | 122 chargements (sans le rôle pro, voir ci-dessus), 0 constat réel — un faux positif du contrôle automatique sur la fiche annonce (carrousel « annonces similaires », bande défilante sans défilement de page) ; captures dans le dossier de preuves |
| `test/phase27.e2e-spec.ts` (balayage des autorisations) | 5 tests réussis |
| `npm test` | 171 réussis, 1 ignoré |
| Playwright (achat, messagerie, marges mobiles, console admin, accessibilité admin) | rejoués sur la pile locale ; suite complète par la CI |
| Typecheck API et front, lint des pages modifiées | sans erreur |

Déploiement : CI verte (suite Playwright complète, tests API SQLite et Postgres 16, image Docker, Render), API en **1.22.0** (`/health` : postgres ok), front Vercel à jour (accueil : « 1 annonce en ligne » au singulier, bandeau de réassurance et carte « Vendez le vôtre » présents). Aucun compte de test créé en production pour ce tour.

## 43. Lien de confirmation d'e-mail invalide : message clair et renvoi depuis la page — 16 septembre 2026

Constat (§42) : `/confirmer-email` avec un jeton invalide ou expiré affichait le message brut de validation
(« La valeur de le champ token n'est pas valide ») et renvoyait vers les paramètres.

Livré (`frontend/src/components/auth/ConfirmEmailPanel.tsx`) :
- message : « **Ce lien n'est plus valable.** Il a expiré (les liens durent 24 heures) ou a déjà été utilisé.
  Rien n'est perdu : demandez un nouveau lien ci-dessous » ;
- membre connecté : bouton « Renvoyer l'e-mail de confirmation » **sur la page** (même composant que le
  bandeau et les paramètres : cooldown de 60 s, 3 envois par heure), avec l'adresse de destination ;
  adresse déjà confirmée → message de succès et lien vers le compte ;
- anonyme : bouton « Se connecter pour recevoir un nouveau lien », qui ramène sur `/confirmer-email` où
  le bouton de renvoi apparaît (titre « Recevoir un nouveau lien ») ;
- lien incomplet (sans jeton) : même bloc de renvoi.

Vérification : `e2e/22-confirmer-email.spec.ts` (2 scénarios : connecté → message + renvoi confirmé ou
refus temporaire d'une minute après l'e-mail d'inscription, bouton en attente ; anonyme → message + connexion
puis retour sur la page avec le bouton) ; captures : anonyme (message + bouton de connexion), connecté
(message + bouton de renvoi), après renvoi (« E-mail envoyé à … à 17:11 »), lien incomplet après connexion.

Déploiement : CI verte (suite Playwright complète, tests API SQLite et Postgres 16, image Docker, Render), API en **1.23.0** (`/health` ok), front Vercel à jour : `/confirmer-email?token=invalide` en production affiche le nouveau message et le bouton de connexion (capture). Aucun compte de test créé en production.

## 44. Accueil : carte « Vendez le vôtre » — bouton débordant et soulignement au survol — 16 septembre 2026

Constat (capture de l'utilisateur, production) : dans la carte d'invitation ajoutée au §42, le texte du bouton
« Déposer une annonce » dépassait du bouton (largeur d'une colonne de la grille, texte non retourné à la
ligne), et le survol soulignait tout le texte de la carte (la carte entière est un lien, règle globale
`a:hover`).

Correction (`frontend/src/app/(site)/home.module.css`) : aucun soulignement sur la carte ni ses descendants
au survol ou au focus ; bouton en `white-space: normal` (texte sur deux lignes si besoin) étiré à la largeur
de la carte ; sur bureau la carte occupe deux colonnes de la grille. Mesures sur la pile locale au survol :
bureau — carte 316 px, bouton 278 px, aucun débordement, 0 élément souligné ; mobile 375 px — carte 204 px,
bouton 166 px, aucun débordement, 0 élément souligné. Captures avant / après dans le dossier de preuves.

Déploiement : CI verte, API en **1.23.1**, front Vercel à jour ; mesure sur www.trocoin.fr au survol de la carte : largeur 316 px, aucun débordement du bouton, 0 élément souligné (capture).

## 45. Accueil : carte « Vendez le vôtre » aux dimensions exactes d'une carte d'annonce — 16 septembre 2026

Demande : la carte d'invitation doit avoir exactement les dimensions d'une carte d'annonce, sur bureau et
sur mobile. Livré : même colonne de grille (plus d'étalement sur deux colonnes), même structure qu'une
carte d'annonce (même cadre 5 px, visuel carré arrondi à la place de la photo, corps de 10 px), hauteur
égale à la rangée par étirement de la grille ; contenu raccourci pour tenir dans 150 px : visuel « + »
et « Vendez le vôtre », titre « Déposez une annonce » (15 px, comme un titre de carte), ligne « Gratuit,
en ligne en deux minutes. » (12 px), bouton « Déposer » compact. Lien entier sans soulignement.

Mesures sur la pile locale, carte d'annonce voisine contre carte d'invitation : bureau 1280 px —
151 × 277 px pour les deux ; mobile 375 px — 167 × 303 px pour les deux ; aucun débordement du bouton,
0 élément souligné au survol. Captures dans le dossier de preuves.

Déploiement : CI verte, API en **1.23.2**, front Vercel à jour ; mesures sur www.trocoin.fr : bureau 151 × 277 px pour la carte d'annonce et pour la carte d'invitation, mobile 167 × 303 px pour les deux (captures).

## 46. Annonces de démonstration réalistes (site qui semble actif au lancement) — 16 septembre 2026

Demande : 8 à 12 comptes vendeurs réels (noms français, européens et d'origine arabe), 4 à 8 annonces par
catégorie principale, 2 à 5 photos libres de droits par annonce, remise en main propre uniquement, numéro
toujours masqué, messagerie normale, indicateur interne « compte de démonstration » visible seulement côté
admin, identifiants transmis hors dépôt.

### Livré côté code (1.24.0, tests 173)

- `users.isDemoAccount` (migration `1789520000000-ComptesDemo`) : réglable uniquement par un admin
  (`PATCH /admin/users/:id`, tracé `user.update` au journal), case « Compte de démonstration » et pastille
  « Démo » sur la fiche et dans la liste admin ; jamais renvoyé par une route publique (annonce, profil).
  Effets : `phoneAvailable: false` et `POST /listings/:id/phone` → 404 même si le membre affiche son
  numéro ; devis `eligible: false` et `POST /transactions` → 400 ; messagerie inchangée.
- `users.securePaymentDisabled` : préférence du vendeur (case « Proposer le paiement sécurisé sur mes
  annonces » dans Paramètres, `PATCH /users/me`). Décochée : devis non éligible avec le motif « Ce vendeur
  ne propose pas le paiement sécurisé : réglez en main propre, à la remise. », achat refusé (400), et la
  fiche annonce affiche ce motif à la place du bouton d'achat. Cette préférence permet aux comptes de
  démonstration de se protéger eux-mêmes dès l'ensemencement, sans identifiants admin.
- `test/phase28.e2e-spec.ts` (2 tests) : les deux mécanismes, l'absence de fuite de l'indicateur, la
  messagerie dans les deux sens et la trace au journal.

### Ensemencement de la production

- Outils hors dépôt (`private/`, ignoré par git) : `seed-demo.js` (inscription ou reconnexion des comptes,
  `phonePublic: false` + `securePaymentDisabled: true`, création des annonces avec `deliveryAvailable: false`
  et attributs validés contre le schéma de chaque sous-catégorie, envoi des photos, reprise sur `429` et
  état dans `demo-state-*.json`), `collect-photos.js` (candidats Openverse CC0/domaine public et Wikimedia
  Commons CC0 via données structurées P275 = Q6938433, planches-contact `demo-montage-*.jpg` revues une par
  une, sélection manuelle `demo-selection.json`), `verify-prod.js` (contrôle après coup).
- Photos : 152, toutes CC0 ou domaine public (Wikimedia Commons 110, Flickr via Openverse 28, autres
  Openverse 14), source, auteur, licence et page d'origine consignés dans
  `private/demo-photos-https___api_trocoin_fr.json`. Aucune image copiée d'un site de petites annonces. Deux
  annonces prévues (poussette, siège auto) n'avaient aucune photo libre convenable : la première est retirée,
  la seconde remplacée par un lot de peluches ; la bétonnière est devenue un compresseur pour la même raison.
- Numéros : plage ARCEP réservée à la fiction 06 39 98 00 01 → 06 39 98 00 10 (jamais attribuée) ; ils sont
  de toute façon masqués. E-mails `ousbaali11+demo-<prénom>@gmail.com` (comptes non confirmés : usage
  normal, simple rappel dans l'espace compte). Mots de passe aléatoires, dans
  `private/demo-accounts-https___api_trocoin_fr.md` transmis au propriétaire, jamais commité.
- Résultat (`verify-prod.js`, `private/demo-verification-*.json`) : 10 comptes, **59 annonces en ligne**
  (immobilier 5, véhicules 5, matériel pro 5, emploi 5, mode 5, maison-jardin 5, famille 4, multimédia 5,
  loisirs 5, vacances 5, services 5, animaux 5), 59/59 avec au moins 2 photos (2 ou 3 chacune),
  `phoneAvailable: false` sur 59/59, aucune occurrence de `isDemoAccount`, `securePaymentDisabled` ni d'un
  numéro dans les JSON publics (annonces et profils). Sonde avec un compte connecté sur l'annonce
  « Appartement T3 … Lyon 3e » : devis `eligible: false` avec le motif, `POST /listings/:id/phone` → 404,
  `POST /transactions` → 400, conversation créée (201) et réponse du vendeur de démonstration (201).
- Fiche annonce en production (captures bureau et mobile, 4 annonces) : aucun bouton « Voir le numéro »,
  encart « Ce vendeur ne propose pas le paiement sécurisé : réglez en main propre, à la remise » à la place
  de l'achat ; la seule mention restante du paiement sécurisé est le conseil générique de la boîte
  « Conseils de sécurité » et du pied de page. Accueil : « 60 annonces en ligne ».

### Reste à faire par le propriétaire

- Cocher « Compte de démonstration » sur les 10 fiches admin (liens dans le fichier d'identifiants) : les
  annonces sont déjà protégées par la préférence vendeur, l'indicateur sert surtout à les retrouver et à les
  supprimer plus tard.
- Confirmer (ou non) les 10 adresses e-mail depuis les liens reçus sur la boîte Gmail.

Déploiement : CI verte, API en **1.24.0**, front Vercel à jour (case dans Paramètres et fiche admin livrées).

## 47. En-tête sur une seule rangée, grille d'icônes sous l'en-tête, bandeau de réassurance retiré — 17 septembre 2026

Demande (captures annotées) : remplacer la rangée de liens texte des catégories (A) par la grille d'icônes
(B) posée directement sous la barre du haut, supprimer le bandeau de réassurance (C) sans laisser de vide,
fusionner « Catégories » + recherche avec la ligne du haut (Mes recherches, Favoris, Messages, compte,
Déposer une annonce) en une seule rangée, sur bureau et sur mobile.

### Livré (1.25.0)

- **A supprimé** : composant `CategoryBar` (familles au survol, bureau ≥ 1024 px) retiré du layout et du
  dépôt. Les sous-catégories restent accessibles par le bouton « Catégories » (panneau en colonnes) et,
  sur mobile, par l'accordéon du menu.
- **B déplacé** : la grille d'icônes (icône + libellé, apparence inchangée, 12 colonnes → 6 → 4) est
  rendue par l'accueil dans une bande blanche directement sous l'en-tête, avant le bloc « Rechercher une
  annonce ». Choix assumé : A était présent sur toutes les pages mais B n'existait que sur l'accueil ;
  B ne prend donc la place de A que sur l'accueil (une grille de 100 px sur chaque page aurait alourdi
  le dépôt, les fiches et le compte). Facile à généraliser si souhaité.
- **C supprimé** : liste « Ce que Trocoin garantit » et son style retirés ; la recherche large remonte.
- **En-tête fusionné** : une rangée de 60 px (61 avec la bordure) = logo, « Catégories » (padding et
  police resserrés : 120 px), recherche compacte (`max-width: 520px`, flexible), puis Mes recherches,
  Favoris, Messages, Se connecter / compte, Déposer une annonce, **inchangés** (mêmes classes, 40 px de
  haut). `--header-h` passe de 108 à 61 px (57 sur mobile) pour les éléments collants (filtres, menu
  compte, fil de messages).
- **Mobile (≤ 900 px)** : une seule rangée aussi. Choix retenu parmi les adaptations possibles : garder
  un vrai champ de recherche (l'action principale, sans tap supplémentaire) et gagner la place sur la
  marque, réduite à son monogramme « T » sous 560 px (le nom reste pour les lecteurs d'écran) ;
  Messages et le menu gardent leurs 44 px ; « Catégories » vit dans le menu et dans la grille de
  l'accueil. Écarté : la recherche réduite à une icône qui s'ouvre au tap (un geste de plus pour
  l'action la plus fréquente).
- Tests navigateur adaptés : `01-recherche` (rangée unique alignée à 1280/1440/1920 px, recherche
  entre 190 et 520 px, boutons de droite ≥ 40 px), `14-filtres-decouverte` (grille sous l'en-tête,
  A et C absents, attente de la régénération ISR de l'accueil), `15-experience` (animation du panneau
  Catégories). `docs/design-system.md` §6 et README mis à jour.

### Vérification

- Playwright local : 104 réussis, 1 échec isolé de `19-session` (renouvellement de session, sans lien
  avec l'en-tête), qui passe seul (5/5) ; CI verte sur `f155736` (104 réussis, 10 ignorés, 1 instable
  réessayé avec succès sur le premier commit, 0 sur le second).
- Production (www.trocoin.fr, 1.25.0, captures avant/après dans le dossier de preuves) :
  - bureau 1280 px : en-tête **109 → 61 px** ; logo, Catégories, recherche (235 px), Mes recherches,
    Favoris, Messages, Se connecter, Déposer une annonce tous centrés à y = 30 ; grille des catégories à
    y = 71 juste sous l'en-tête (98 px de haut), titre « Rechercher une annonce » à y = 206 ; rangée de
    liens texte 0, bandeau 0, pas de débordement horizontal ;
  - mobile 375 px : en-tête **111 → 57 px** ; monogramme, recherche (161 px), Messages, menu centrés à
    y = 28 ; grille à y = 67 (4 colonnes, 283 px), titre à y = 379 ; A et C absents, pas de débordement.

## 48. Barre du haut : hauteur uniforme ; panneau des sous-catégories au survol de la grille d'icônes — 17 septembre 2026

Demande (capture annotée) : la pilule de recherche n'avait pas la hauteur des boutons Catégories, profil et
« Déposer une annonce » ; rattacher à la grille d'icônes le menu déroulant des sous-catégories que portait
l'ancienne rangée de liens texte, sans changer l'aspect des tuiles ; mobile inchangé.

### Livré (1.25.1)

- **Hauteur** : la pilule mesurait 45,6 px (la classe `.input` impose un padding vertical de 10 px que le
  `min-height` compact ne plafonnait pas). En mode compact, le cadre fait maintenant **40 px** exactement et
  le champ 38 px sans padding vertical (`SearchBox`). Catégories, recherche, Se connecter ou profil, et
  Déposer une annonce : 40 px chacun, centrés à la même ligne.
- **Panneau au survol** : nouveau composant client `CategoryTiles` (accueil) qui rend la même grille
  (mêmes classes, même balisage, `data-family` en plus) et reprend tel quel le panneau de l'ancienne
  `CategoryBar` : posé sous la tuile survolée (bord gauche aligné, borné au bord droit), large comme son
  contenu, en-tête « Tout <famille> », sous-catégories en colonnes de 8 au plus, animation `menu-in` /
  `menu-out`, fermeture par Échap (focus rendu à la tuile), clic hors panneau ou changement de page. Le
  survol n'ouvre rien sans pointeur précis ou sous 1024 px (`matchMedia`), donc rien ne change sur mobile :
  un tap navigue vers la catégorie, les sous-catégories restent dans l'accordéon du menu.
- Tests : `01-recherche` (quatre hauteurs égales à ± 1 px), `14-filtres-decouverte` (survol → panneau
  sous la tuile, 1 colonne pour Véhicules, 2 colonnes 8 + 7 pour Services contenues dans la page, Échap,
  tuile identique avant/après survol, lien de sous-catégorie qui navigue). Suite complète locale :
  106 réussis, 11 ignorés ; CI verte sur `144b615`.

### Vérification en production (www.trocoin.fr, 1.25.1)

- Non connecté, 1280 px : Catégories 40 px, pilule de recherche **45,6 → 40 px**, Se connecter 40 px,
  Déposer une annonce 40 px, tous centrés à y = 30. Connecté (compte de démonstration) : Catégories,
  recherche, profil « Sami C. », Déposer une annonce = 40 px, centrés à y = 30 (captures).
- Survol de « Véhicules » : tuile 91 × 98 px avant et après survol (identique), panneau à x = 165 (bord
  gauche de la tuile), y = 178 (sous la grille), 240 × 257 px, une colonne de 6 sous-catégories. Survol de
  « Services » : deux colonnes (8 + 7), bord droit à 1264 px (dans la page). Échap : 0 panneau. Captures
  et vidéo du survol dans le dossier de preuves.
- Mobile 375 px : survol simulé → 0 panneau ; tap sur « Véhicules » → `/recherche?category=vehicules`.

## 49. Panneau « Tous les filtres » : boutons qui débordaient ; panneau des sous-catégories arrondi et dégradé — 17 septembre 2026

Demande (capture) : « Tout effacer » et « Rechercher » sortaient du cadre du panneau de filtres sur bureau,
avec une barre de défilement horizontale ; à corriger sans élargir le panneau, vérifier les autres champs
et le mobile. Et donner au panneau des sous-catégories (survol d'une tuile) des coins arrondis et un fond
vert clair de la palette qui s'estompe vers le bas.

### Cause et correction (1.25.2)

- **Cause** : dans `SearchPage.module.css`, la règle `.panelFooter .btn` (deux boutons qui se partagent la
  colonne) ciblait `.btn`, classe **globale** : le module CSS hachait ce nom en `…__btn`, donc la règle ne
  s'appliquait à rien et les boutons gardaient leur largeur naturelle (129 + 147 px + 10 px d'écart dans
  239 px utiles → `scrollWidth` 307 pour 278). Même défaut latent sur `.filters .field`, `.drawerBody
  .field` et, sur l'accueil, `.inviteVisual .eyebrow` et `.inviteCard .btn` (carte d'invitation, visible
  seulement avec moins de 4 annonces) : tous passés en `:global(...)`. Aucun autre champ ne débordait
  (localisation, prix : contrôlés par script, 0 élément hors cadre).
- **Boutons** : `flex: 1 1 0`, `min-width: 0`, marges internes 8 px, police 0,86 rem, texte coupé avec
  points de suspension plutôt que de déborder si la place venait à manquer. Largeur du panneau inchangée
  (280 px).
- **Panneau des sous-catégories** : `border-radius: var(--radius-lg)` (16 px) sur les quatre coins, fond
  `linear-gradient(180deg, var(--accent-tint) 0%, var(--white) 100%)` — `--accent-tint` (#e4f3ee) est la
  teinte de la palette déjà utilisée pour les encarts positifs et le survol des menus.
- Tests : `14-filtres-decouverte` — nouveau scénario bureau + mobile (aucun conteneur à défilement
  horizontal dans le panneau ou le volet, aucun champ ni bouton hors du cadre, texte entier des deux
  boutons) et assertions de style du panneau (rayon 16 px, dégradé de rgb(228, 243, 238) vers le blanc).
  Suite complète locale : 108 réussis, 11 ignorés ; CI verte sur `60f14a9`.

### Vérification en production (www.trocoin.fr, 1.25.2)

- Bureau 1280 px : panneau `clientWidth` 278 = `scrollWidth` 278 (**307 avant**), 0 conteneur à
  défilement horizontal, 0 champ hors cadre ; « Tout effacer » 114 px (bord droit 205) et « Rechercher
  (6) » 114 px (bord droit 329) dans le cadre (350), textes entiers.
- Mobile 375 px (volet) : `clientWidth` 375 = `scrollWidth` 375, page sans défilement horizontal,
  boutons 167 px chacun dans le cadre, textes entiers.
- Survol de « Maison & Jardin » : rayon 16 px / 16 px, fond `linear-gradient(rgb(228, 243, 238) 0%,
  rgb(255, 255, 255) 100%)`. Captures avant/après dans le dossier de preuves.

## 50. Console admin : défilement de la colonne de navigation bloqué par intermittence — 17 septembre 2026

Demande (capture) : en faisant défiler la colonne de gauche de la console, le bas (« Retour au site public »,
compte connecté, « Se déconnecter ») n'était parfois plus atteignable. Reproduire selon la hauteur de
fenêtre, le zoom et la page, trouver la cause exacte, corriger, prouver sur plusieurs hauteurs.

### Reproduction et cause (pile locale, front 1.25.2, admin du seed)

La colonne mesure 792 px de contenu (marque, 6 groupes, 8 liens, retour, compte, bouton). Elle était
`position: sticky; top: 0; height: 100vh` **sans `overflow`** : plus haute que la fenêtre, elle débordait
sous sa boîte de 100vh et restait collée en haut. Le bas ne devenait visible que si la page elle-même
pouvait être défilée jusqu'au bout (la colonne collante remonte alors avec la fin de son conteneur) :

| Page | Fenêtre | Résultat avant |
|---|---|---|
| Tableau de bord (courte) | 900 px | atteignable (colonne 900 ≥ contenu) |
| Tableau de bord (courte) | 700 px | **bloqué** (bas du bouton à 782 px, page défilable de 116 px seulement) |
| Tableau de bord (courte) | 600 px | **bloqué** (bas du bouton à 782 px) |
| Journal d'audit (longue) | 700 / 600 px | atteignable seulement après avoir défilé la page jusqu'en bas |
| Toute page, zoom 150 % | 900 px | **bloqué** (fenêtre utile de 600 px) |

D'où l'intermittence : ça dépendait de la hauteur de la fenêtre, du zoom (qui réduit la hauteur utile)
et de la longueur de la page courante, pas d'un défaut aléatoire.

### Correction (1.25.3)

`.admin-side` devient son propre conteneur de défilement : `overflow-y: auto`, `height: 100dvh` (avec
repli `100vh`), `overscroll-behavior: contain`, barre fine assortie au fond sombre ; ses enfants ne
rétrécissent pas (`flex-shrink: 0`) pour que le pied garde sa hauteur. Sur mobile (≤ 900 px) le bandeau
horizontal existant est inchangé.

### Vérification

- Même script après correction, front 1.25.3 : page courte et page longue, fenêtres de **900, 700, 600 et
  500 px** : la colonne défile (scrollTop 110 / 210 / 310), bas du bouton « Se déconnecter » à 672 / 572 /
  472 px, toujours dans la fenêtre → atteignable dans les 8 cas (captures à 600 et 500 px). Le zoom
  navigateur équivaut à une fenêtre plus basse (150 % à 900 px = 600 px utiles), couvert par ces cas.
- Test `21-admin-droits` ajouté : à 900, 700 et 600 px, sur `/admin` et `/admin/journal`, molette sur la
  colonne puis « Se déconnecter » et « Retour au site public » entièrement dans la fenêtre, `overflow-y`
  = `auto`. Spécifications admin 06, 09, 21 : 8 réussis ; CI verte sur `da01fca`.
- Production : API **1.25.3**, feuille de style de la console déployée avec la règle
  `.admin-side{…height:100dvh;…position:sticky;top:0;overflow-y:auto}` (lue sur www.trocoin.fr/admin).
  Aucun identifiant admin de production n'étant disponible, la preuve fonctionnelle est celle de la pile
  locale sur le même code.

## 51. Paiement expliqué en chiffres, affichage des frais, commission et frais réglables par l'admin — 17 septembre 2026

Demande : (1) un document qui explique le mécanisme avec un exemple chiffré (article à 10 €) : où va l'argent,
ce que paie l'acheteur, ce que reçoit le vendeur, ce que garde Trocoin, et si les frais Stripe sont déjà
déduits ; (2) vérifier que la page de paiement détaille prix et frais ; (3) rendre la commission et les
frais de protection réglables depuis la console, sans effet rétroactif, avec trace au journal ; (4) le risque
fiscal ou comptable reste une question pour un comptable.

### 1. Document : `docs/mecanisme-paiement-explique.md`

Article à 10,00 € : l'acheteur paie **11,00 €** (10,00 + 1,00 de frais de protection), le vendeur reçoit
**9,20 €** (10,00 − 0,80 de commission), Trocoin garde **1,80 € brut**. Les frais Stripe **ne sont calculés
nulle part dans le code** : Stripe les prélève sur le solde de la plateforme, donc sur la part de Trocoin.
Barème relu sur stripe.com le 17/09/2026 : carte EEE standard 1,5 % + 0,25 € → 0,42 € sur 11,00 € ; Connect
0,25 % + 0,10 € par versement → 0,12 € sur 9,20 € ; soit **≈ 1,26 € net par vente**, avant le forfait de
**2 € par vendeur actif et par mois** (un vendeur qui ne fait qu'une vente à 10 € dans le mois coûte plus
qu'il ne rapporte). PayPal via Stripe : 0,2 % + 0,10 € plus les frais propres de PayPal. Le document suit
l'argent étape par étape avec les délais du code (capture sous 24 h, 7 jours pour expédier, réception
présumée 7 jours après l'envoi, 7 jours de fenêtre de litige, virement à la confirmation, versement bancaire
au calendrier Stripe), indique où chaque montant est calculé, et liste les questions à poser au comptable.
Le chiffre « Revenus plateforme » de la console est donc un **brut** (commission + frais acheteur).

### 2. Affichage au paiement

Avant : la fenêtre de confirmation montrait déjà trois lignes (prix, frais, total) mais sans la formule, le
bouton disait « frais de protection inclus » sans montant, et la page Stripe n'avait **qu'une ligne** au
total. Maintenant : sous le bouton « Acheter · 11,00 € » → « Paiement sécurisé : 10,00 € + 1,00 € de frais
de protection » ; dans la fenêtre, « Frais de protection acheteur — 5 % + 0,50 € (plafonnés à 15 €) :
paiement conservé par Trocoin jusqu'à la réception » et « Le vendeur perçoit 9,20 € (commission Trocoin de
8 % : 0,80 €) » ; sur la page Stripe, **deux lignes** (l'article, puis « Frais de protection acheteur
Trocoin »). Fiche transaction vendeur : le taux affiché est celui de la vente, plus « 8 % » en dur. Aide et
page Versements lisent le barème en vigueur (`/settings/public` → `fees`).

### 3. Barème réglable par l'admin

- Réglages système `commission_percent`, `buyer_fee_percent`, `buyer_fee_fixed_eur`, `buyer_fee_cap_eur`
  (créés au démarrage avec 8, 5, 0,5, 15 ; bornes 0–30 %, 0–20 €, 0–500 €, deux décimales).
- Console → Configuration → Monétisation et formules → **« Commission et frais du paiement sécurisé »** :
  encart « En vigueur actuellement » (taux, exemple à 10 €, dernière modification et son auteur), champs,
  aperçu chiffré des valeurs saisies, confirmation qui rappelle la portée, bouton inactif sans changement
  ou avec une valeur invalide.
- **Non rétroactif** : `createTransaction` lit le barème une fois et fige `amount`, `commission`,
  `buyerFee` et `feeRates` (migration `1789530000000-BaremeParTransaction`) ; le détail d'une transaction
  relisait `computeQuote(tx.amount)` avec le barème du jour : corrigé (`quoteOfTransaction`). Une page de
  paiement déjà ouverte garde son montant (session Stripe). Un total affiché mais pas encore payé est
  protégé : `expectedTotal` envoyé avec l'achat, réponse **409 `QUOTE_CHANGED`** avec le nouveau devis, la
  fenêtre l'affiche et rien n'est débité.
- **Journal d'audit** : `settings.update` avec admin, date, IP et, par réglage, `{"from":8,"to":9}`.

### Vérification

- API : `test/phase29` (3 tests) — barème par défaut à 10 €, changement par l'admin, transaction existante
  intacte (montants, devis détaillé, barème), 409 puis achat au nouveau barème, journal avec anciennes et
  nouvelles valeurs, bornes et droits, plafond à 1 000 €. **176 tests API**.
- Navigateur : `e2e/23-bareme` (fenêtre de paiement bureau + mobile, console, total protégé) ; suite
  complète 109 réussis + les 3 scénarios corrigés (ils utilisaient une annonce du seed refusée par un autre
  scénario : annonce propre désormais) ; CI verte sur `352c5ef`.
- Captures (pile locale, article à 10 €) : fenêtre de paiement bureau et mobile, panneau admin en vigueur,
  saisie, confirmation, après changement, journal (`{"commission_percent":{"from":8,"to":9},
  "buyer_fee_fixed_eur":{"from":0.5,"to":0.7}}`).
- Production 1.26.0 : `/settings/public` expose `fees` 8 / 5 / 0,5 / 15 ; avec un vendeur et une annonce
  temporaires à 10 € et un compte de démonstration acheteur : devis 11,00 / 9,20, transaction créée avec
  `feeRates`, **page Stripe (environnement de test) sur deux lignes : 10,00 € + « Frais de protection
  acheteur Trocoin » 1,00 € = 11,00 €** (capture, aucune carte saisie). Annonce, transaction en attente et
  compte temporaire supprimés (404 / 0 transaction). À noter : la page Stripe affiche le nom du compte
  Stripe (« Stratos consulting ») et non « Trocoin » : à changer dans le Dashboard Stripe (nom public).
- Pas d'identifiants admin de production : le panneau est prouvé sur la pile locale, même code.

## 52. Alertes Google Search Console sur les données structurées `Product` — 17 septembre 2026

Demande : deux e-mails de Search Console signalent des champs manquants dans le balisage `Product` / `Offer` des
fiches. Corriger `shippingDetails` et `hasMerchantReturnPolicy` avec de vraies données ; ne jamais fabriquer de
GTIN, de marque, d'avis ou de note ; documenter pourquoi ces champs restent vides.

### Livré (1.26.1)

- **API** : la fiche expose `delivery` : livrable ou non, 7 jours accordés au vendeur pour expédier (règle du
  séquestre), 2 à 4 jours de transport (Colissimo, Mondial Relay), et une **fourchette de coût seulement si le
  vendeur a déclaré le poids** du colis (grille indicative des transporteurs, `src/shipping/indicative-rates.ts`,
  partagée avec le fournisseur simulé). Sans poids : `estimate: null`, rien n'est inventé.
- **Balisage** (`frontend/src/lib/listing-jsonld.ts`) :
  - remise en main propre seule → `shippingDetails: { doesNotShip: true, shippingDestination: FR }` et
    `availableDeliveryMethod: OnSitePickup` ;
  - annonce livrable → destination `FR`, `deliveryTime` (`handlingTime` 0–7 j, `transitTime` 2–4 j),
    `availableDeliveryMethod: [OnSitePickup, ParcelService]`, et `shippingRate` min/max si le poids est déclaré ;
  - vendeur particulier → `hasMerchantReturnPolicy: MerchantReturnNotPermitted` (`applicableCountry: FR`) ;
    vendeur professionnel → champ absent (ses conditions et le droit de rétractation légal s'appliquent) ;
  - familles qui ne sont pas des biens (immobilier, emploi, services, vacances) → aucun des deux champs.
- **Page** : nouvel encart « Livraison et retours » sur la fiche, qui dit exactement la même chose que le
  balisage (exigence de Google : les données structurées décrivent le contenu visible).
- **Volontairement vides** : `gtin*`, `mpn`, `brand` (objets d'occasion uniques, sans code-barres) ; `review`,
  `aggregateRating` (réputation par vendeur, pas d'avis par article). Motifs et décision dans
  `docs/seo-checklist.md`, section « Alertes Search Console sur les données structurées ». Un test échoue si
  l'une de ces clés apparaît dans le `Product`.

### Vérification

- API : `test/phase30` (estimation par poids, trois cas de fiche) → **178 tests** ; navigateur :
  `e2e/10-seo` (JSON-LD des deux cas de livraison, encart visible, clés interdites absentes) ; suite complète
  113 réussis, 11 ignorés ; CI verte sur `d8a498c`.
- Production 1.26.1 (www.trocoin.fr), JSON-LD relu dans la page :
  - annonce de démonstration en main propre (particulier) : `doesNotShip: true`, `OnSitePickup`,
    `MerchantReturnNotPermitted` ; encart « Remise en main propre uniquement… » ;
  - annonce temporaire livrable, 800 g : `handlingTime` 0–7, `transitTime` 2–4, `shippingRate` 5,49–7,95 EUR ;
    encart « Envoi estimé entre 5,49 € et 7,95 € d'après le poids déclaré (800 g) » ;
  - annonce temporaire livrable sans poids : mêmes délais, **pas de `shippingRate`** ; encart « Frais d'envoi à
    convenir avec le vendeur » ;
  - offre d'emploi : ni `shippingDetails` ni `hasMerchantReturnPolicy`, pas d'encart ;
  - aucune clé `gtin`, `mpn`, `brand`, `review`, `aggregateRating` dans les trois `Product`.
  Annonces et compte temporaires supprimés (204).
- Reste à faire par le propriétaire : dans Search Console, « Valider la correction » sur les deux alertes
  traitées. Les alertes sur l'identifiant global et les avis resteront en « améliorations facultatives » :
  c'est attendu et documenté.

## 53. Fenêtre de paiement : formule des frais et net du vendeur retirés de la vue de l'acheteur — 17 septembre 2026

Demande (capture annotée) : dans la fenêtre « Paiement sécurisé », ne plus montrer aux utilisateurs le bloc A
(ligne « 5 % + 0,50 € (plafonnés à 15 €) : paiement conservé par Trocoin jusqu'à la réception » sous « Frais
de protection acheteur ») ni le bloc B (« Le vendeur perçoit 9,20 € (commission Trocoin de 8 % : 0,80 €) »).
Ces deux mentions avaient été ajoutées au tour §51.

Livré (1.26.2) : la ligne « Frais de protection acheteur » n'affiche plus que son montant ; la phrase sur le
net du vendeur et la commission est retirée ; « Frais de port à convenir avec le vendeur pour un envoi. » est
conservée, comme les trois lignes prix / frais / total et la ligne sous le bouton « Acheter ». Rien d'autre ne
change : le barème reste réglable par l'admin, le vendeur voit toujours sa commission sur la fiche de sa
transaction, la formule reste dans le centre d'aide et la page Versements.
`docs/mecanisme-paiement-explique.md` §3 et le README sont alignés.

Vérification : `e2e/23-bareme` affirme désormais l'absence de « plafonnés », « Le vendeur perçoit » et
« commission » dans la fenêtre (6 scénarios d'achat et de barème réussis, CI verte sur `d34fcc0`).
Production 1.26.2, annonce temporaire à 10 € et compte de démonstration acheteur, bureau et mobile : la fenêtre
contient « Prix de l'article 10,00 € · Frais de protection acheteur 1,00 € · Total à payer 11,00 € · Frais de
port à convenir avec le vendeur pour un envoi. » et aucune des trois mentions retirées (captures). Annonce et
compte temporaires supprimés (204).

## 54. Annonces sans expiration, verrous anti-fraude après publication, sous-catégories au tap sur mobile — 17 septembre 2026

Demande : (1) supprimer la limite de 60 jours (`LISTING_LIFETIME_DAYS`) ; (2) après publication, rendre non
modifiables pour le vendeur la catégorie, la marque et les photos de publication, avec des champs visiblement
grisés, sans toucher aux pouvoirs de l'admin, et un test de refus ; (3) corriger l'absence de sous-catégories
au tap sur mobile.

### 1. Annonces sans expiration

- Retiré : la constante de durée de vie, la tâche horaire `expireListings`, l'écriture de `expiresAt` (création,
  publication, renouvellement, approbation par l'admin). Migration
  `1789540000000-AnnoncesSansExpirationEtVerrous` : dates effacées, annonces « expiree » remises en ligne
  (seule la limite de temps menait à ce statut).
- Impacts vérifiés : sitemap (ne lit que les annonces en ligne, inchangé) ; « Mes annonces » (onglet « En
  pause », plus de « expire le … ») ; filtre des annonces de la console (option « Expirée » retirée) ;
  réactivation d'un compte suspendu (toutes les annonces reviennent en ligne, test `phase25` adapté) ;
  statistiques (aucune ne dépendait de l'expiration) ; centre d'aide (« sans limite de durée »). Le
  renouvellement reste : il fait remonter l'annonce. Le statut `expiree` ne subsiste que dans le type.

### 2. Verrous anti-fraude

Raison, écrite dans le code (`updateOwn`) et dans `docs/audit-admin.md` : empêcher qu'un vendeur publie une
annonce crédible, accumule vues, favoris et confiance, puis la transforme discrètement en autre chose.

- **Catégorie / sous-catégorie** : 400 si différente après publication (même valeur acceptée).
- **Marque** (attribut `marque` renseigné) : 400 si changée ou retirée ; les autres critères restent libres.
- **Photos de publication** (`listing_photos.lockedAt`) : ni retrait (400), ni déplacement (400), elles restent
  en tête et la couverture ne change pas. **Ajouter** des photos reste permis : elles viennent à la suite,
  restent retirables et déplaçables entre elles, et sont verrouillées à la remise en ligne suivante.
- Le dépôt passe en trois temps (brouillon, photos, publication) pour que les photos existent au moment du
  verrou ; pour les clients qui publient d'abord, les photos reçues dans les 10 minutes suivant la publication
  en font partie. Un brouillon reste entièrement modifiable.
- **Formulaire** : catégorie remplacée par un champ grisé « 🔒 Famille › Catégorie » avec l'explication, marque
  désactivée avec sa note, tuiles « 🔒 Verrouillée » sans bouton, bandeau qui rappelle que l'ajout reste
  possible. La fiche expose `locks`.
- **Admin** : pouvoirs inchangés (modifier, mettre en pause, refuser, supprimer) et nouveau retrait d'une photo,
  même verrouillée, avec motif obligatoire, journal `listing.photo.delete` et notification du vendeur (bouton
  sur la fiche admin). C'est le recours pour une photo publiée par erreur (plaque, visage, adresse).

### 3. Sous-catégories sur mobile

Cause : au tour §48, le panneau n'avait été branché que sur le survol (pointeur précis, ≥ 1024 px) et un tap
naviguait directement vers la famille ; le repli mobile renvoyait à l'accordéon du menu, que rien n'indiquait
depuis la grille. Corrigé : sans survol, un tap sur une famille déplie sous la grille un panneau « Tout
<famille> » + sous-catégories sur deux colonnes (cibles de 44 px, mêmes couleurs que le panneau du bureau),
un second tap ou « Fermer » le replie, une autre famille le remplace ; une famille sans sous-catégorie navigue.

### Vérification

- API : `test/phase31` (4 tests : aucune expiration ; brouillon libre puis verrou ; refus de catégorie, marque,
  retrait et déplacement de photo, ajout permis ; admin et journal) ; tests `listings`, `phase9`, `phase25`
  adaptés → **182 tests**. Navigateur : `04-depot` (formulaire grisé après publication, photo ajoutée retirable),
  `14-filtres` (accordéon mobile) ; suite complète 111 réussis + le scénario mobile corrigé (mesure prise pendant
  l'animation) ; le scénario `19-session` reste instable dans la suite (passe seul 5/5, sans lien avec ce tour,
  tâche de suivi proposée). CI verte sur `adbe14c`.
- Production 1.27.0 : annonce existante `expiresAt = null`, en ligne. Annonce temporaire (brouillon, 2 photos,
  publication) : `locks` tous vrais, 2/2 photos verrouillées ; changer de catégorie → 400, de marque → 400,
  retirer une photo → 400, la déplacer → 400, modifier titre et prix → 200, ajouter une photo → 201. Formulaire :
  catégorie « 🔒 Électronique › Téléphonie » désactivée, marque « Apple » désactivée, 2 tuiles verrouillées,
  0 bouton de suppression (captures). Mobile 375 px : tap sur « Véhicules » → reste sur l'accueil, panneau avec
  les 6 sous-catégories ; tap sur « Motos » → `/recherche?category=motos` (capture). Annonce et compte
  temporaires supprimés (204).
- 1.27.1 : l'indication « 🔒 Verrouillée » passe dans le pied de la tuile (elle chevauchait « Couverture »).

## 55. Étiquette : message d'erreur brut du transporteur ; dépôt : tuile « + Ajouter des photos » — 17 septembre 2026

Demande (captures) : (1) à l'achat d'une étiquette, un bloc rouge affichait le JSON de Boxtal (« demande refusée
(HTTP 422) {"timestamp":…,"ValidationException.PhoneNumber","field":"shipment.fromAddress.contact.phone"… ») ;
(2) à l'étape Photos du dépôt, un bouton d'ajout de photos comme sur leboncoin à la place du lien « Faire → »,
sur bureau et sur mobile.

### 1. Étiquette

- **Cause** : le champ Téléphone de l'expéditeur était vide (facultatif dans le formulaire, jamais prérempli) alors
  que le transporteur l'exige pour les deux parties ; le refus de validation remontait tel quel à l'écran.
- **Avant tout appel au transporteur** (`ShippingService.createLabel`) : un numéro saisi mais invalide → 400
  `telephone_invalide` avec une phrase claire ; sans saisie, l'expéditeur reprend le numéro de son compte, le
  destinataire celui de son adresse de livraison puis celui de son compte — ce dernier n'est transmis qu'au
  transporteur, jamais enregistré ni montré au vendeur ; aucun numéro disponible → 400 `telephone_requis` qui dit
  quoi faire. Numéros normalisés (`src/shipping/phone.ts` : espaces, points, +33, 0033).
- **Refus du transporteur** : `describeBoxtalRefusal` traduit le JSON de validation en une phrase (« le
  transporteur a refusé la demande : numéro de téléphone de l'expéditeur manquant ou invalide ; … Corrigez puis
  réessayez. ») ; téléphone, code postal, ville, adresse, e-mail, colis, point relais, offre. Le détail technique
  part au journal du serveur. Le message ne cite plus le prestataire (« Étiquette non générée : … »).
- **Formulaire du vendeur** : téléphone de l'expéditeur prérempli avec celui du compte, marqué obligatoire, aide
  « Exigé par le transporteur », message rouge sous le champ si le numéro n'a pas 10 chiffres et bouton « Calculer
  le tarif » inactif ; téléphone du destinataire facultatif avec l'explication du repli. Les adresses s'ouvrent
  d'elles-mêmes si le numéro du compte est inexploitable. À l'achat, le téléphone de l'acheteur est prérempli.

### 2. Étape Photos du dépôt

La grande zone « Cliquez pour choisir des photos » est remplacée par une **tuile en tête de grille**, comme sur
leboncoin : cadre en pointillés, pastille « + », « Ajouter jusqu'à 10 photos » puis « Ajouter des photos (n
possibles) » ; elle disparaît à 10 photos. Le glisser-déposer de fichiers reste possible sur la grille, le champ
fichier reste atteignable au clavier (focus visible sur la tuile). Sur cette étape, la checklist « Fiche
complète » n'affiche plus de lien « Faire → » pour les photos (la tuile est juste dessous) ; le lien vers les
critères manquants est conservé car il ramène à une autre étape. Corrigé au passage : les pastilles « Couverture »
et « À envoyer » se chevauchaient sur la première tuile.

### Vérification

- API : `test/phase32` (4 tests : normalisation des numéros, traduction du refus avec le corps exact reçu en
  production, repli sur les comptes sans fuite du numéro de l'acheteur, refus clairs) → **186 tests**.
- Navigateur : `04-depot` (tuile première de la grille, libellés, plus de lien « Faire » pour les photos),
  `17-expedition`, `05-achat`, `15-experience`, `07-accessibilite` (axe : 0 violation après avoir porté le rôle
  `listitem` par un conteneur et non par le `label`), `08-clavier`, `11-marges-mobile` : tous réussis.
- Captures (pile locale) : étape Photos bureau et mobile (vide, puis deux photos), panneau d'expédition avec
  téléphone prérempli puis invalide. L'achat réel d'une étiquette n'est pas rejoué en production (il est payant).

Production 1.27.2 (CI verte sur `685026f`) : formulaire de dépôt ouvert avec un compte de démonstration, sans rien publier — tuile « + Ajouter jusqu'à 10 photos » présente sur bureau et mobile 375 px, ancienne zone « Cliquez pour choisir des photos » absente, aucun lien « Faire » pour les photos (captures).

## 56. Accueil mobile : les annonces dès l'arrivée (les trois blocs de tête conservés) ; dépôt : étape Photos réservée aux photos, sans plafond — 17 septembre 2026

### 1. Accueil mobile (≤ 640 px) — bureau inchangé

Constat mesuré en production 1.27.2 à 375 × 812 : la première annonce commençait à **975 px**, soit sous le premier
écran ; le visiteur voyait trois blocs (A : grille d'icônes sur trois rangées ; B : « Rechercher une annonce » avec
titre, texte, QUOI ?, OÙ ?, bouton ; C : compteur et raccourcis sur trois lignes) avant toute annonce. Demande du
propriétaire : garder les trois blocs, mais que l'on tombe sur les annonces, comme sur leboncoin.

Choix retenu — compacter sans rien retirer, tout reste à un geste :

- **A — catégories sur une seule ligne défilante** (tuiles de 78 px, accroche magnétique, bord droit estompé pour
  signaler la suite). Le tap déplie toujours les sous-catégories sous la ligne (§54).
- **B — recherche repliée en une ligne** « Rechercher une annonce · Quoi ? · Où ? » (48 px). Un tap déplie le bloc
  complet d'origine (titre, texte, QUOI ?, OÙ ?, Rechercher) et place le curseur dans « QUOI ? » ; « Réduire la
  recherche » le replie. Le `h1` et le texte restent dans le document quand le bloc est replié (masquage visuel
  seulement : lecteurs d'écran et référencement inchangés). `aria-expanded` / `aria-controls` sur le déclencheur.
- **C — compteur et raccourcis sur une ligne défilante** (même mécanisme que les filtres rapides de la recherche).
- En-tête « Les dernières annonces » : titre et lien « Tout voir » sur une ligne, marges réduites.

Pistes écartées : masquer les blocs au défilement (ils ne seraient plus « là » à l'arrivée), déplacer les blocs sous
les annonces (la recherche et les catégories doivent rester en tête), faire défiler la page automatiquement jusqu'aux
annonces (désoriente, casse le retour arrière et l'accessibilité).

Résultat mesuré (pile locale, 375 × 812) : première annonce à **335 px** (975 px avant) ; la première rangée de
cartes est entièrement dans le premier écran. Tout est en CSS sous `@media (max-width: 640px)` ; le déclencheur
n'existe pas à l'écran au-delà.

### 2. Dépôt, étape Photos (bureau et mobile)

- Le bloc « Fiche complète » (« Précisez N critères », liens « Faire → ») **n'apparaît plus sur l'étape Photos** :
  l'étape ne sert qu'à ajouter des images. La checklist n'est pas perdue : elle est affichée à l'étape « Aperçu avant
  publication », où « Faire → » ramène au champ concerné (photos → étape 3).
- **Plus de plafond de photos par annonce** (10 auparavant). `MAX_PHOTOS_PER_LISTING` supprimé ; le formulaire
  envoie les photos **par lots de 10** (limite technique d'un envoi, `MAX_FILES_PER_UPLOAD`). La tuile reste toujours
  affichée : « Ajouter des photos » puis « Ajouter d'autres photos ». Aide en ligne et documents mis à jour.
- Garde-fous conservés, à connaître : 10 fichiers par requête, 60 envois par heure et par adresse, 8 Mo par image,
  et **150 photos par compte et par 24 h** (`MAX_PHOTOS_PER_DAY`, réglable) — seul vrai plafond restant, contre le
  remplissage du disque par un compte malveillant. Les verrous du §54 (photos de publication) sont inchangés.

### Vérification

- API : `test/phase33` (23 photos sur une annonce en trois lots, ordre conservé ; 11 fichiers en un envoi → 400, rien
  de conservé) → **188 tests** réussis, 1 ignoré.
- Navigateur : nouveau test `14-filtres-decouverte` « accueil mobile » (une seule ligne de tuiles défilante, bloc replié
  ≤ 56 px, raccourcis ≤ 48 px, première carte avant 55 % de la hauteur et visuel entier à l'écran, dépli/repli,
  focus dans « QUOI ? », `h1` toujours présent, dernière famille atteignable ; bureau : déclencheur absent, grille et
  formulaire inchangés) ; `04-depot` et `15-experience` adaptés (pas de checklist à l'étape Photos, checklist à
  l'aperçu) ; `01-recherche`, `08-clavier` déplient la recherche sur mobile. Suite complète : **115 réussis,
  11 ignorés, 0 échec** (mobile + bureau, axe compris).
- Captures : avant (production 1.27.2, mobile), après (accueil mobile replié, déplié, sous-catégories ; bureau ;
  étape Photos bureau et mobile, vide puis 12 photos).

Production 1.28.0 (CI verte sur `f407c56`, `/health` → 1.28.0) — mobile 375 × 812 : 12 tuiles sur **une** ligne (85 px),
recherche repliée (48 px), raccourcis (37 px), `h1` présent, **première annonce à 335 px** (975 px avant), visuel de
la première rangée entier à l'écran (bas à 502 px), aucun défilement horizontal de la page ; dépli → QUOI ?, OÙ ? et
titre visibles, recherche « vélo » lancée depuis le bloc ; tap sur Véhicules → 6 sous-catégories. Bureau 1440 :
déclencheur absent, formulaire visible, catégories en grille. Dépôt (compte temporaire) : étape Photos sans bloc
« Fiche complète » ni lien « Faire » sur bureau et mobile ; 12 photos ajoutées dans le formulaire puis « Enregistrer
en brouillon » → **12 photos enregistrées** côté API (deux lots). Brouillon (jamais publié) et compte temporaire
supprimés (204, 204).

## 57. Saisie qui saute vers « Remise en main propre », retour de paiement, points de retrait, suivi de la vente dans la messagerie — 17 septembre 2026

### 1. Bug : le curseur quitte le champ et « Remise en main propre » se coche

**Reproduit** avant toute correction (`e2e/24-remise-saisie.spec.ts`, frappe touche par touche) : dans « Paiement
sécurisé », en tapant « Nora Acheteur » dans « Nom et prénom », le focus partait sur le bouton radio « Remise en main
propre » ; l'espace du nom le **cochait**, et le bloc d'adresse disparaissait.

**Cause exacte** — ce n'est pas un raccourci clavier. La boîte de dialogue (`components/ui/Modal.tsx`) rejouait son
« focus initial » à chaque frappe : son effet dépendait de `onClose`, que les appelants passent comme fonction fléchée
**recréée à chaque rendu** — donc à chaque caractère tapé dans un champ contrôlé. L'effet se relançait : focus rendu au
bouton d'ouverture, puis focus posé sur le premier champ de la boîte, ici le radio « Remise en main propre ». Les
boîtes dont le premier champ est celui où l'on tape (message au vendeur, litige) masquaient le défaut.

**Correction** : `onClose` est lu par référence, l'effet ne dépend plus que de l'ouverture. Échap, tabulation confinée
et retour du focus au bouton d'ouverture sont inchangés (vérifiés par le même test). Toutes les boîtes en profitent.

### 2. Retour automatique après paiement, réussi ou non

- Succès : `success_url` → `/compte/transactions/:id?paiement=retour` (inchangé) ; la page affiche maintenant un bandeau
  **« Paiement réussi »** (montant, ce qui se passe ensuite, lien vers la conversation), ou « Paiement en cours de
  vérification… » si la banque n'a pas encore répondu.
- Abandon / refus : `cancel_url` pointait vers l'annonce avec un message fugitif ; il pointe désormais vers
  `/compte/transactions/:id?paiement=annule` → bandeau **« Paiement non abouti : rien n'a été débité »**, quoi vérifier,
  **Reprendre le paiement**, **Abandonner cet achat** (`POST /transactions/:id/abandon` : session fermée chez le
  fournisseur — `expireCheckout`, Stripe `checkout.sessions.expire` —, annonce rachetable aussitôt ; un paiement en
  réalité abouti n'est jamais annulé).
- Limite de Stripe Checkout, dite clairement : une carte **refusée** laisse l'acheteur sur la page Stripe avec le motif
  (pour réessayer) — Stripe n'a pas d'adresse de retour « en cas d'échec ». Le retour se fait par « ← » (notre
  `cancel_url`) ou à l'expiration ; dans les deux cas il arrive sur la page ci-dessus. Idem pour PayPal via Stripe.
- Pour le tester de bout en bout sans Stripe : le fournisseur simulé sait jouer une page de paiement hors du site
  (`/dev/mock-checkout/:id`, 404 en production) avec les mêmes adresses de retour.

### 3. Domicile, point relais, bureau de poste, consigne — pour Colissimo et Mondial Relay

Constat : le mode était déduit du transporteur (« Colissimo à domicile », « Mondial Relay en point relais »), le point
relais choisi par le vendeur, et le panneau du vendeur ne proposait le domicile que pour Colissimo alors que Boxtal
cote `MONR-DomicileFrance`. Relevé réel (diagnostic sandbox) : deux offres par transporteur, domicile et retrait
(`POFR-ColissimoAccess` / `POFR-ColissimoPickupStation`, `MONR-DomicileFrance` / `MONR-CpourToi`) ; bureaux de poste
et consignes ne sont pas des offres à part mais des **points de l'offre de retrait** (« LOCKER … » autour de 75017).

- `GET /shipping/pickup-options` : par transporteur, domicile et retrait **selon la cotation réelle** du colis, et les
  points réels du prestataire, classés relais / bureau de poste / consigne (`classifyPickupPoint`).
- Fenêtre d'achat : « Envoi par Colissimo / Mondial Relay », adresse, puis « Où souhaitez-vous recevoir le colis ? » —
  **À domicile**, **En point relais (n)**, **En bureau de poste / consigne automatique (n)** —, chaque option seulement
  si elle existe autour de l'adresse ; liste des points (nature, adresse, distance, horaires). Paiement impossible
  sans choix complet.
- Le point est relu chez le prestataire avant tout paiement (point inconnu → 400, fiche du prestataire conservée) ;
  à l'étiquette, mode et point de l'acheteur sont imposés. Prestataire en panne : achat non bloqué, parcours d'origine.
- Détail : `docs/etiquettes-transporteur.md` §9.

### 4. Suivi de la vente dans la messagerie

Existant réutilisé tel quel : séquestre, `ship`, `confirm-delivery`, `handover`, virement Stripe Connect, suivi
d'expédition. Ajouté : messages automatiques (`messages.type = 'system'`, `systemEvent`, `transactionId`, `meta`) écrits
par `PaymentsService.track()` après chaque action réussie ; conversation créée d'office à l'achat ; étape
« disponibilité confirmée » (`POST /transactions/:id/confirm-availability`, information, jamais bloquante) ; panneau
de la vente épinglé dans la conversation avec le bouton de l'étape en cours ; diffusion en direct.

**Articulation retenue** (compromis détaillé dans `docs/suivi-vente-messagerie.md`) : la conversation sert à **suivre
et agir en un geste** ; la page « Achats et ventes » reste le **dossier complet** (montants, étiquette, code de remise,
litige, avis, annulation). Mêmes routes des deux côtés, chaque côté renvoie à l'autre : une action faite dans l'un se
voit aussitôt dans l'autre. Tout déplacer dans le fil a été écarté (formulaires et documents introuvables dans des
messages, trace comptable à garder quand la conversation disparaît), tout dupliquer aussi (double maintenance).

Corrigé au passage : deux messages créés dans la même seconde sortaient dans un ordre arbitraire sous SQLite
(horodatage à la milliseconde posé par le service) ; « Acheter », « Proposer un prix » et les questions d'avant-vente
ne s'affichent plus dans une conversation dont la vente est en cours.

### Vérification

- API : `test/phase34` (6 tests : classement des points, suivi complet par les routes existantes, main propre et
  litige sans doublon ni code de remise, options de réception, point relu / imposé à l'étiquette / inconnu refusé,
  abandon et retour de paiement hébergé) ; `phase13` adaptée (nouvelle adresse d'annulation) → **194 tests**, 1 ignoré.
- Navigateur : `24-remise-saisie` (échoue avant correction, réussit après, **bureau et mobile**), `25-retour-paiement`
  (réussi / refusé, bureau et mobile), `26-suivi-messagerie` (deux navigateurs, temps réel, bureau et mobile),
  `17-expedition` adaptée (options réelles par transporteur, choix imposé au vendeur).
- Migration `1789550000000-SuiviDansLaMessagerie` (colonnes nullables, aucune donnée réécrite).

Production 1.29.0 (CI verte sur `cbcb921`, migration jouée sur PostgreSQL, `/health` → 1.29.0) :
- **Saisie** : dans « Paiement sécurisé » (compte de démonstration, bureau 1280 px et mobile 375 px), nom, adresse, code
  postal et ville tapés touche par touche → focus resté dans le champ, valeurs complètes, « Remise en main propre »
  non cochée, Colissimo toujours coché.
- **Points réels (Boxtal, 75017)** : recherche par offre v3.2 acceptée (`MONR-CpourToi`, `POFR-ColissimoPickupStation`
  → 200). Colissimo : domicile + 13 relais + 3 bureaux de poste (« BUREAU DE POSTE PARIS BATIGNOLLES »…) + 4 consignes
  (« CONSIGNE LAPOSTE PICKUP BATIGNOLLES »…) ; Mondial Relay : domicile + 9 relais + 11 consignes (« LOCKER STATION
  AVIA… »). Le prestataire ne fournit pas de champ « type » (champs : code, name, compatibleNetworks, location,
  openingDays) : le classement par nom commercial est donc le bon levier, vérifié sur ces données.
- **Retour de paiement** : « Payer » → `checkout.stripe.com` → lien « ← » de Stripe → `www.trocoin.fr/compte/
  transactions/:id` avec « Paiement non abouti : rien n'a été débité », puis « Abandonner cet achat » → vente
  `annulee` (« Paiement abandonné par l'acheteur »), annonce de nouveau achetable. Aucun numéro de carte n'a été saisi :
  le retour après un paiement **réussi** est prouvé sur la pile locale (même adresse `success_url`, page hébergée
  simulée), pas en production.
- Routes déployées : `confirm-availability`, `abandon`, `pickup-options` → 401 sans session ; page de paiement simulée
  → 404 en production. Le fil de conversation complet (messages automatiques, boutons) est prouvé sur la pile locale ;
  en production il demande un paiement Stripe réel, que je ne fais pas (saisie de carte).
- Vendeur et annonce temporaires supprimés (204, 204).

1.29.1 : pour un paiement non finalisé, la page de la vente dit « Total à payer » et « Achat commencé, paiement non
finalisé » (elle affichait « Total payé » / « Paiement sécurisé » à côté de « rien n'a été débité »).

## 58. Annonce « Vendue » dès le paiement, remise en ligne après annulation, suppression automatique à la réception — 17 septembre 2026

Constat : pendant toute une vente payée, l'annonce restait « en ligne » — visible dans les résultats, avec son bouton
« Acheter » (un second achat était refusé, mais seulement après le clic). Elle ne passait « vendue » qu'à la réception,
et n'était jamais retirée.

Règle demandée par le propriétaire, mise en place :

| Moment | Annonce |
|---|---|
| Paiement reçu (immédiat, retour de la page hébergée ou webhook) | **« Vendue »** : badge « Vendu », plus de bouton Acheter ni de contact, sortie des résultats, page toujours consultable ; devis et achat → 404 |
| Vente annulée ou remboursée (acheteur, vendeur, délai dépassé, médiateur, fournisseur de paiement) | **reste « Vendue »** ; le vendeur la **remet en ligne d'un clic** (conversation, page de la vente, Mes annonces), prévenu par notification et message automatique |
| Article reçu : réception confirmée, code de remise validé, fonds libérés par le médiateur | **supprimée automatiquement** (`RetentionService.purgeListing`, comme une suppression par le vendeur : la vente payée garde montants, dates et titre ; conversation et avis restent possibles) |
| Réception présumée (acheteur silencieux) | reste « Vendue » pendant la fenêtre de litige de l'acheteur, **supprimée à sa clôture** par la tâche périodique — sauf si, l'acheteur ayant été remboursé, le vendeur l'a remise en ligne |

Deux choix à connaître :
- **La remise en ligne n'est pas automatique** après une annulation (avant, l'annonce n'avait jamais quitté les
  résultats) : entre le paiement et l'annulation, le vendeur a pu céder l'objet ailleurs ; une annonce qui reviendrait
  seule pourrait être payée pour un objet qui n'existe plus. Conforme à la demande (« le vendeur peut remettre »).
- **Garde-fou** : tant qu'une vente payée court (fonds bloqués, expédiée, litige), `PATCH /listings/:id {status:
  en_ligne}` répond 400 — sinon le même objet pourrait être payé deux fois.
- Le remboursement décidé après une réception présumée ne remet plus l'annonce en ligne d'office (même règle).

Migration `1789560000000` : les annonces des ventes en cours au déploiement passent « vendue ». Textes mis à jour
(notifications, messages automatiques, page de la vente, aide en ligne) ; `docs/suivi-vente-messagerie.md` complété.

### Vérification

- API : `test/phase35` (5 tests : vendue / hors résultats / non rachetable / non remise en ligne pendant la vente ;
  annulation puis remise en ligne par le vendeur seul ; suppression à la réception avec trace, conversation et avis ;
  code de remise ; réception présumée, fenêtre de litige, remboursement et remise en ligne) ; 13 attentes d'anciens
  tests alignées sur la nouvelle règle (phases 22, 23, 24, 26, 27, transactions) → **199 tests**, 1 ignoré.
- Navigateur : `27-annonce-vendue` (bureau et mobile) ; `05-achat` (annonce supprimée après réception → 404) et
  `13-messagerie` adaptées → **125 réussis, 11 ignorés, 0 échec**.
- Captures (pile locale) : avant achat, « Vendu » (visiteur bureau et mobile, vendeur), annulation avec bouton
  « Remettre l'annonce en ligne » (conversation bureau et mobile, page de la vente), après remise en ligne, annonce
  supprimée (404, page de la vente, conversation).

Production 1.30.0 (CI verte sur `7d84d77`, migrations jouées sur PostgreSQL, `/health` → 1.30.0) — annonce temporaire :
en ligne → bouton « Acheter » et « Contacter » présents, devis 200 ; passée « vendue » → badge « Vendu », **plus de
bouton Acheter ni Contacter** (bureau et mobile 375 px), « Article vendu : il n'est plus disponible à l'achat. »,
devis et achat → 404, absente de la recherche ; remise en ligne par le vendeur → 200 (403 pour un autre membre),
bouton Acheter de retour. Annonce et compte temporaires supprimés (204, 204). Le passage automatique à « vendue » au
paiement, la remise en ligne après annulation et la suppression à la réception demandent une vente payée : ils sont
prouvés par `phase35`, `27-annonce-vendue` et les captures de la pile locale — aucun numéro de carte n'est saisi en
production.

## 59. Livraison payée par l'acheteur ; le vendeur confirme la disponibilité puis génère le bon d'envoi (PDF) sans rien régler — 17 septembre 2026

Demande du propriétaire (modèle leboncoin) : c'est l'acheteur qui choisit Colissimo ou Mondial Relay et le lieu de
réception, **les frais de livraison s'ajoutent à la somme qu'il paie** ; le vendeur — qui ne peut pas avancer le port —
reçoit d'abord un bouton pour confirmer que l'article est disponible, puis un bouton pour générer le **bon d'envoi
(PDF)** ; l'acheteur, qui a payé ce bon, reçoit **le numéro de suivi seulement**, le PDF va au vendeur seul. Cela
tranche la question restée ouverte dans `docs/etiquettes-transporteur.md` (« qui paie l'étiquette ? »).

### Ce qui change

- **Acheteur** : chaque option de réception affiche son **prix réel** (cotation du prestataire pour le colis de
  l'annonce et son adresse) ; le récapitulatif gagne la ligne « Frais de livraison » ; total = prix + protection +
  livraison ; bouton « Payer <total> » ; troisième ligne sur la page Stripe. La mention « frais de port à convenir
  avec le vendeur » disparaît.
- **Serveur** : à la création de la vente la livraison est recotée et figée (`transactions.shippingFee`,
  `shippingQuote`) ; `expectedTotal` couvre aussi la livraison (409 `QUOTE_CHANGED` sinon, aucun débit) ; adresse
  exigée pour un envoi, point exigé pour un retrait ; **annonce sans poids déclaré → envoi non proposé** (pas de prix
  ferme possible), main propre toujours possible ; le dépôt exige le poids dès que l'envoi est accepté.
- **Vendeur** : panneau « Bon d'envoi » — « La livraison (X €) a été payée par l'acheteur : vous n'avez rien à régler » ;
  ni tarif à calculer, ni poids, ni point, ni étiquette à acheter. **1. Confirmer la disponibilité → 2. Générer le bon
  d'envoi (PDF)** (refusé avant la confirmation, 400) ; il ne fournit que son adresse d'expéditeur ; mode, colis,
  destinataire et point viennent de la vente et ne se changent pas. Puis « Confirmer l'expédition » sans ressaisie. Le
  bouton de la conversation devient « Générer le bon d'envoi (PDF) ». La saisie manuelle d'un numéro n'est plus qu'un
  secours replié.
- **Acheteur, suite** : message automatique « Bon d'envoi généré — votre numéro de suivi : … » dès que le bon existe ;
  `label.pdf` → 403 pour lui.
- **Argent** : la livraison reste chez Trocoin, dont le compte chez le prestataire règle le bon ; elle n'entre ni dans
  la commission ni dans le versement au vendeur (toujours prix − commission). **Sans marge.** Remboursement toujours
  intégral, livraison comprise ; un bon déjà généré est annulé chez le prestataire quand il le permet.

Choix faits faute d'instruction, à connaître (détail et tableau des risques : `docs/etiquettes-transporteur.md` §10) :
pas de marge sur le port ; remboursement de la livraison en cas d'annulation ou de litige (le coût d'un bon déjà émis
reste alors à Trocoin) ; poids obligatoire plutôt qu'un poids par défaut (un colis sous-déclaré serait refacturé à
Trocoin). Ventes antérieures : parcours d'origine conservé. Migration `1789570000000`.

**Avant l'ouverture réelle** : la production utilise le bac à sable Boxtal (bons factices) et Stripe en mode test ;
des clés Boxtal de production et un compte approvisionné sont nécessaires pour des bons valables.

### Vérification

- API : `test/phase36` (4 tests : prix par option et annonce sans poids ; total, gel, 409, adresse / point / mode
  exigés, versement inchangé ; bon d'envoi après confirmation, imposé par la vente, PDF au vendeur seul, numéro de
  suivi à l'acheteur, message automatique ; annulation et remboursement intégral) ; tests d'origine du parcours
  d'étiquette rattachés à des ventes « antérieures » (`buyShipped(..., { legacy: true })`) → **203 tests**, 1 ignoré.
- Navigateur : `17-expedition` réécrite sur le nouveau parcours (prix par option, total 68,99 €, vendeur : confirmation
  puis bon d'envoi, PDF, acheteur sans PDF ; échec du bon et secours manuel), `26-suivi-messagerie`, `24`, `23-bareme`
  adaptées → suite complète au vert (125 réussis, 11 ignorés).
- Captures (pile locale) : options et prix, total avec livraison (bureau et mobile), récapitulatif acheteur, vendeur
  avant / après confirmation, bon d'envoi prêt (bureau et mobile) et PDF, conversation acheteur avec le numéro de suivi.

Production 1.31.1 (CI verte sur `4ef5ca3`, migrations jouées sur PostgreSQL ; le premier passage de la CI avait échoué
sur un **test** de la §57 — motif « six chiffres » déclenché par un identifiant aléatoire —, corrigé, déploiement bloqué
entre-temps comme prévu). Annonce temporaire de 10 €, colis de 900 g, Lyon → 75017, **prix réels du prestataire** :
Colissimo domicile 9,73 € / point de retrait 7,86 € ; Mondial Relay domicile 9,72 € / point de retrait 5,02 € (9 relais,
11 consignes). Fenêtre d'achat (bureau et mobile 375 px) : « Prix de l'article 10,00 € · Frais de protection 1,00 € ·
**Frais de livraison Mondial Relay 5,02 €** · Total à payer **16,02 €** », bouton « Payer 16,02 € ». Page Stripe réelle :
trois lignes, dont « Frais de livraison Mondial Relay (en point de retrait) 5,02 € », total 16,02 €. Vente créée : livraison
5,02 figée, offre `MONR-CpourToi`, point « G20 LEVIS », versement vendeur prévu 9,20 € (inchangé). Annonce sans poids :
aucun transporteur proposé, achat avec envoi → 400. Retour par « ← » sans payer puis abandon ; annonces et compte
temporaires supprimés (204). La génération du bon d'envoi demande une vente payée : prouvée par `phase36`,
`17-expedition`, `26-suivi-messagerie` et les captures de la pile locale — aucun numéro de carte n'est saisi en production.

## 60. Prix négocié payable, messagerie en direct, blocs de la conversation, audit général (sécurité, paiement, interfaces) — 17 septembre 2026

Retour du propriétaire après un essai à deux comptes : (1) une proposition de prix acceptée ne servait à rien — le
ticket disait « acceptée » mais l'acheteur payait toujours le prix affiché ; (2) des messages, des tickets de
proposition et des tickets de suivi n'apparaissaient qu'après avoir actualisé la page ; (3) cinq blocs de la
conversation à revoir (A réponses rapides, B flèche de retour, F tickets automatiques, K boutons d'action, N en-tête de
la vente) ; (4) un audit général : bugs, failles, architecture, interfaces (console d'administration comprise),
couleurs, logo, mécanisme de paiement — sur grand écran et sur téléphone.

### 1. Proposition acceptée → « Payer 15,00 € »

- Le prix négocié est **résolu par le serveur, jamais envoyé par le navigateur** : `negotiatedPrice(listing, buyerId)`
  cherche la dernière proposition **acceptée** de CET acheteur sur CETTE annonce, acceptée depuis moins de
  `OFFER_VALID_HOURS` (72 h par défaut), strictement inférieure au prix affiché, annonce toujours en ligne. `quote()`
  renvoie `offer` et `listPrice` ; `createTransaction` calcule protection, commission et versement sur le prix
  négocié et garde le prix affiché dans `transactions.listPrice`. Un autre acheteur, une proposition expirée, refusée
  ou remplacée → prix affiché. Migration `1789580000000` (`messages.offerAnsweredAt`, `transactions.listPrice`).
- Acheteur : le ticket « Acceptée » porte le bouton **« Payer 15,00 € »** et « Prix valable jusqu'au … » ; le bouton
  d'achat de l'en-tête de la conversation devient « Payer 15,00 € » ; la fenêtre de paiement s'ouvre directement
  (`?acheter=1`), ligne « Prix négocié », total recalculé (15,00 € + 1,25 € = 16,25 €) ; la fiche annonce rappelle
  « Prix négocié avec le vendeur : 15,00 € au lieu de 20,00 € ». Vendeur : « En attente du paiement de l'acheteur ».
  Récapitulatif de la vente : « Prix négocié (affiché 20,00 €) ». Message automatique : « … (prix négocié) ».

### 2. « Il faut actualiser pour voir les messages » — cause et correction

Cause : seul un message **texte envoyé par le socket** était diffusé. Les propositions, leurs réponses, les photos, les
messages envoyés par la route REST de secours et une partie des tickets automatiques étaient enregistrés **sans prévenir
personne**. Côté navigateur : aucune resynchronisation après une reconnexion ou un retour sur l'onglet (téléphone mis
en veille), jeton figé dans l'authentification du socket (déconnexion silencieuse après son expiration), et `load()`
écrasait la liste au lieu de la fusionner.

- Serveur : un seul canal d'événements dans `ConversationsService` (`onMessageEvent` → `new` / `update`), alimenté par
  `persist()`, `postOffer`, `answerOffer`, `postSystemEvent` ; la passerelle le relaie à la salle de la conversation
  (`message`, `message:update`) et aux deux membres (`inbox`). Plus aucune émission ailleurs.
- Navigateur : fusion par identifiant (`upsert`), resynchronisation à chaque `connect`, au retour sur l'onglet, au
  retour en ligne et à la sortie du cache de navigation ; jeton relu (et rafraîchi) à chaque connexion ; filet de
  sécurité toutes les 10 s hors direct, 30 s en direct, onglet visible seulement ; accusé de lecture seulement si
  l'onglet est visible ; boîte de réception mise à jour par `inbox`. L'écran d'erreur plein cadre ne s'affiche plus
  que si rien n'a pu être chargé.
- Passerelle durcie : identifiants validés (UUID), 30 messages par minute et par socket.

### 3. Blocs de la conversation

- **A — réponses rapides** et **N — en-tête de la vente** : composant `Disclosure`, replié par défaut, commande sur
  toute la largeur (≥ 44 px) avec médaillon à chevron animé, état `aria-expanded`, contenu `inert` et masqué une fois
  replié, animation coupée si l'utilisateur la refuse ; texte réduit. Les phrases ne sont plus en capitales
  interlettrées (`.pill-phrase`) et « ? » ne passe plus seul à la ligne (espace insécable).
- **B — retour** : `BackLink`, disque de 40 px, flèche dessinée (tige + pointe) qui glisse au survol, nom accessible
  « Retour aux messages ». Repris sur la page d'une vente.
- **F — tickets** : une phrase par ticket (`sale-events.ts` réécrit), proposition : montant, état, action.
- **K — boutons de la vente** : mêmes boutons, compacts, deux lignes au plus (vérifié par test à 375 px).

### 4. Audit de sécurité et du mécanisme de paiement — défauts trouvés et corrigés

| Défaut | Gravité | Correction |
| --- | --- | --- |
| Le **code de remise en main propre** revenait dans la réponse des routes d'action (expédier, confirmer, annuler…) — le vendeur pouvait se verser l'argent sans remettre l'article | critique | toutes les routes passent par `viewFor()` ; le code n'est rendu qu'à l'acheteur ; 5 codes faux → vente verrouillée 1 h |
| Deux confirmations simultanées (ou tâche planifiée + clic) pouvaient déclencher **deux versements** | élevée | transitions par UPDATE conditionnel (`claim`), versement réservé atomiquement (`transferId = en-cours:…`), clé d'idempotence Stripe `payout-<vente>`, réservation périmée reprise après 10 min |
| Deux acheteurs pouvaient payer la **même annonce** (mode hébergé) | élevée | `isFirstActiveSale` après insertion ; le second paiement est refusé ou remboursé ; webhook : paiement arrivé sur une vente annulée → remboursement |
| Annonce refusée ou en attente de modération remise en ligne par « désactiver / réactiver » ou « renouveler » | élevée | changement de statut refusé depuis `en_attente` / `refusee` ; le renouvellement repasse la modération |
| Annonce modifiée, renouvelée ou supprimée **pendant une vente** (ou pendant un paiement en cours) | moyenne | refusé tant qu'une vente est active ou qu'un paiement de moins de 45 min est en attente |
| L'acheteur voyait l'adresse et le téléphone du vendeur dans l'expédition ; le vendeur voyait l'adresse de l'acheteur **avant** le paiement | moyenne | vues par rôle (`getForViewer`, `viewFor`) |
| Bon d'envoi téléchargeable après annulation | moyenne | PDF effacé et refusé (400) dès l'annulation ou le remboursement |
| Remboursement **partiel** Stripe traité comme total | moyenne | `charge.refunded` ignoré si `refunded` est faux |
| Corps d'expédition sans expéditeur → erreur 500 | faible | `@IsDefined`, 400 |

Reste connu : le code postal d'expéditeur saisi par le vendeur peut différer de celui de la cotation (écart de tarif
possible, seulement journalisé) ; les onglets de filtre utilisent `role="tab"` sans panneau associé (toléré, à
reprendre avec une navigation aux flèches).

Mécanisme de paiement, **vérifié et jugé correct** : montants toujours calculés par le serveur (prix, protection,
livraison, prix négocié), garde `expectedTotal` → 409 sans débit, barème figé sur la vente, séquestre jusqu'à la
réception, remboursement intégral, signature des webhooks, aucun numéro de carte ne transite par Trocoin (Stripe
Checkout), versement par Stripe Connect après confirmation ou à l'échéance.

### 5. Audit des interfaces — 84 pages parcourues (42 à 1280 px, 42 à 375 px)

Mesures automatiques sur toutes les pages publiques, du compte et de la console : **aucun défilement horizontal,
aucune erreur de console, un seul `h1` partout**. Défauts relevés à la lecture des captures et corrigés :

- **Fiche annonce sur téléphone** : « Contacter » et « Acheter » étaient à quatre écrans de défilement → barre fixe en
  bas (prix, « Message », « Acheter »), qui s'efface quand le vrai bloc d'actions est à l'écran et derrière les fenêtres.
- **Console d'administration sur téléphone** : bandeau de 120 px (titres de groupe au-dessus des liens) → une ligne de
  56 px ; quatorze chiffres empilés un par ligne → deux colonnes ; filtres pleine largeur, 44 px, 16 px (pas de zoom iOS).
- **Recherche de la console** : une requête par caractère, sans ordre garanti → une requête par pause de frappe,
  réponses périmées ignorées, champ nommé (`type="search"`, `aria-label`).
- **Squelettes sans fin** quand une requête échoue (tableau de bord, mes annonces, paiements, formule, réglages de la
  console) → message et bouton « Réessayer » (`LoadError`).
- **Formule** : « Période de lancement : tout est gratuit » s'affichait avant de connaître les droits — donc aussi en
  cas d'échec ou brièvement avec la monétisation active → affiché seulement une fois les droits connus.
- **Paiements** : retour arrière depuis Stripe → bouton figé sur « Redirection… » (page sortie du cache) → réarmé.
- **Dépôt** : `URL.createObjectURL` appelé à chaque rendu (une adresse par photo et par frappe, jamais libérée) → une
  adresse par fichier, libérée ; étapes franchies devenues de vrais boutons (clavier) ; aperçu final resserré à 375 px.
- **Conversation** : photo plus large que la bulle sur petit écran ; visionneuse sans bouton de fermeture ni Échap.
- **Recherche** : sous-catégories de 24 px de haut → 36 px.
- **Contrastes** : `--sage-dark` 4,2:1 → 5,5:1 ; contour des champs 1,3:1 → 3,3:1 (`--field-line`, WCAG 1.4.11).
- **Liens dans le texte courant** : ils héritaient de la couleur du texte et ne se soulignaient qu'au survol — donc
  invisibles sur un écran tactile (WCAG 1.4.1) → couleur d'accent et soulignement dans les paragraphes et les alertes.
- **Conversation sur téléphone** : le champ de saisie ne mesurait que ~110 px → « Envoyer » devient une icône ronde
  sous 480 px (nom accessible conservé).
- Tableau de bord : « · » orphelin en début de ligne sur téléphone ; « 1 vues » → « 1 vue ».

Couleurs et logo, **jugés cohérents et conservés** : vert bouteille `#0f7b5f` (5,2:1 avec le blanc, au-dessus du
seuil AA), encre `#1f2937`, fond `#f6f8f7`, brique pour le danger, ocre pour l'attention ; titres Fraunces, texte Public
Sans ; monogramme « T » carré vert + mot-symbole, lisible à 28 px ; console en ardoise / indigo, volontairement
distincte du site public.

### Vérification

- API : `test/phase37` (6 tests : prix négocié et expiration, ordre des événements diffusés, code de remise jamais
  renvoyé et verrouillage, double confirmation, vues par rôle et bon d'envoi après annulation, garde-fous de statut
  d'annonce) ; `phase13` (remboursement partiel), `phase27` adaptées → **209 tests**, 1 ignoré.
- Navigateur : `28-prix-negocie-direct` (deux navigateurs, aucun rechargement : message, proposition, acceptation,
  « Payer 15,00 € », vente à 16,25 €, blocs A / B / K) et `29-audit-interfaces` (barre mobile, console mobile, recherche
  de la console, « Réessayer », puces) jouées à 375 px et sur grand écran ; `05`, `26`, `27` adaptées.
- Suites complètes avant livraison : API **209 réussis, 1 ignoré** ; navigateur **135 réussis, 11 ignorés** (bureau et
  mobile 375 px) ; `npm audit` sans alerte haute ; types API et front propres.
- Captures (pile locale, bureau et mobile) : blocs A / B repliés puis dépliés, proposition reçue en direct, « Payer
  15,00 € », fenêtre au prix négocié, vente « Prix négocié (affiché 20,00 €) », blocs F / K / N côté vendeur, barre
  d'action mobile, console sur téléphone (bandeau de 56 px, chiffres sur deux colonnes), liens du texte courant.

Production 1.32.0 (CI verte sur `f1713ca` — tests API sur SQLite et PostgreSQL 16 avec la migration `1789580000000`,
parcours navigateur, image Docker, déploiement). Deux sessions réelles sur www.trocoin.fr — acheteur sur téléphone
375 px (compte de démonstration), vendeur temporaire sur grand écran —, **aucun rechargement** : message de
l'acheteur visible chez le vendeur en 94 ms ; ticket « Proposition · En attente · 15,00 € » chez le vendeur en 199 ms ;
après « Accepter », bouton **« Payer 15,00 € »** et « Prix valable jusqu'au 20 sept. » chez l'acheteur en 1,8 s,
en-tête « Payer 15,00 € », vendeur « En attente du paiement de l'acheteur ». Devis du serveur pour l'acheteur : prix 15,
protection 1,25, total 16,25, prix affiché 20 ; **pour un autre compte : 20 €**. Fenêtre de paiement (mobile) : « Prix
négocié 15,00 € · Frais de protection 1,25 € · Total à payer 16,25 € », bouton « Payer 16,25 € ». Page Stripe réelle :
**16,25 €**, 20,00 € nulle part. Retour par « ← » sans payer : vente `en_attente` à 15 € (prix affiché 20 gardé), puis
abandon. Fiche annonce sur téléphone : barre « 15,00 € · prix négocié · Message · Acheter ». Conversation, annonce et
compte temporaires supprimés (200, 204, 204). Aucun numéro de carte saisi.

Correctif 1.32.1, vu sur les captures : l'aide de l'état « Fonds bloqués » disait au vendeur « le vendeur doit
expédier… » → « à vous d'expédier ou d'organiser la remise » (conversation et page de la vente).

## 61. « Configurer mon compte de versement » en erreur ; options de réception sans attente — 18 septembre 2026

Deux retours du propriétaire après un achat complet à deux comptes : (1) une fois la réception confirmée, le vendeur
clique sur « Configurer mon compte de versement » et obtient une erreur, sur grand écran comme sur téléphone ;
(2) à l'achat avec envoi, il faut attendre avant que les choix « domicile / point relais / bureau ou consigne »
n'apparaissent — il veut les trouver déjà là, et la liste des points sans attendre.

### 1. Compte de versement

- Reproduit en production : `POST /users/me/stripe-onboarding-link` → **500 « Erreur interne »**. Cause côté code :
  les appels à Stripe (`accounts.create`, `accountLinks.create`, `accounts.retrieve`) n'étaient pas protégés — tout
  refus de Stripe devenait une erreur interne, sans explication, et le bouton donnait l'impression d'un bug du site.
- Correction : le refus est journalisé et rendu en **503, en français** (`CONNECT_NOT_READY` quand la plateforme n'a
  pas terminé l'activation de Stripe Connect, `CONNECT_UNAVAILABLE` pour une panne), avec « votre argent reste en
  sécurité » ; avec des clés de test, la cause exacte donnée par Stripe est jointe (`reason`) pour le réglage du
  compte. Un compte connecté enregistré mais inconnu de Stripe (autres clés, compte effacé) est remplacé une fois.
  L'état du compte (`stripe-status`) ne renvoie plus d'erreur quand Stripe ne répond pas. Page « Paiements » : le
  message reste affiché sous le bouton (un toast disparaissait), le bouton redevient cliquable.
- La limite de 5 essais par 10 minutes explique le message « Trop de tentatives » vu après plusieurs clics.

### 2. Options de réception sans attente

Mesure en production avant correction : **7,2 s** pour `GET /shipping/pickup-options` (6,1 à 6,8 s pour un autre
code postal), auxquelles s'ajoutaient 500 ms d'attente après la dernière frappe et l'obligation d'avoir saisi la ville.
Cause : quatre appels au prestataire **l'un après l'autre** (cotation puis points, pour chaque transporteur), dont
**deux cotations identiques** — la cotation Boxtal contient déjà tous les transporteurs.

- Serveur : tarifs et points des deux transporteurs demandés **en même temps** ; une seule cotation partagée ;
  réponses gardées en mémoire (tarifs 10 min, points 30 min, demandes en cours partagées, échecs jamais gardés) et
  réutilisées au paiement (`quoteForPurchase`, `resolvePickupPoint`). Des points illisibles ne retirent plus la
  livraison à domicile. La ville devient facultative pour la recherche.
- Navigateur : les trois choix sont **affichés d'emblée** et se cochent tout de suite (prix en attente figurés par un
  trait, liste figurée par trois lignes) ; la recherche part au **cinquième chiffre du code postal**, sans délai ni
  ville ; quand la ville se précise, la relecture se fait sans rien effacer et garde le point choisi ; les options déjà
  lues sont reprises de mémoire (changement de transporteur : aucun appel).
- **Préchargement** : code postal et ville préremplis (dernier achat sur l'appareil — seuls ces deux champs sont
  gardés, par compte —, sinon profil) ; dès l'arrivée sur une fiche achetable avec envoi, les options sont lues en
  arrière-plan. À l'ouverture de la fenêtre, choix, prix et points sont déjà là. La ville est déduite du code postal
  quand il ne correspond qu'à une commune (jamais pendant que la personne est dans le champ Ville).
- Une fois la réponse du transporteur connue, seul ce qu'il propose réellement reste affiché (règle de la §57).
- **Boîte de confirmation** (course vue en CI sur `09-admin-accessibilite`, déploiement bloqué comme prévu) : le bouton
  d'action est en `autoFocus`, mais le « focus initial » de la boîte, posé un instant plus tard, le reprenait au profit
  d'« Annuler » — selon la vitesse de la machine, Entrée annulait au lieu de valider. La boîte respecte maintenant un
  focus déjà placé à l'intérieur (`Modal.tsx`).

### Vérification

- API : `test/phase38` (refus Stripe → 503 en français avec cause en mode test, panne → message de réessai, compte
  inconnu remplacé, état lisible ; quatre appels au prestataire en parallèle puis servis de mémoire ; moitiés
  `part=points` / `part=prices`) → **211 tests**, 1 ignoré.
- Navigateur : `30-versement-options-sans-attente` (message de refus affiché et bouton réarmé ; trois choix visibles
  avant toute adresse, points au code postal seul, choix et point gardés à la relecture, aucun appel au changement de
  transporteur, préchargement au retour : prix affichés sans requête ni attente) à 375 px et sur grand écran ;
  `24` adaptée (ville désormais déduite du code postal). Suite complète : 139 réussis, 11 ignorés.
- Captures (pile locale, bureau et mobile) : choix visibles avant toute adresse, prix et points après le code postal
  (61–68 ms après le cinquième chiffre, sans ville), message clair sur la page Paiements.

**Production 1.33.1** (CI verte sur `32e6cdc`). Compte temporaire : `POST /users/me/stripe-onboarding-link` →
**503 `CONNECT_NOT_READY`** avec la cause donnée par Stripe : *« You can only create new accounts if you've signed up
for Connect, which you can do at https://dashboard.stripe.com/connect »* — **Stripe Connect n'est pas activé sur le
compte Stripe de Trocoin**. C'est un réglage du tableau de bord Stripe, réservé au titulaire du compte (voir
`DEPLOIEMENT.md` §5c) ; tant qu'il n'est pas fait, aucun vendeur ne peut créer son compte de versement — le site le dit
maintenant clairement au lieu d'une « erreur interne ». Options de réception (annonce temporaire, 900 g, Lyon → 33000) :
**6,0 s à froid** (7,2 s avant), **56 ms** ensuite (939 ms avant), autre ville 4,7 s, autre code postal 5,3 s — la
lenteur restante est celle du prestataire lui-même (bac à sable Boxtal, une cotation ≈ 5 s), d'où deux mesures de
plus : **préchargement** dès la fiche, et **deux moitiés indépendantes** (`part=points`, `part=prices`) demandées
ensemble — la liste des points n'attend pas la cotation, et inversement. Compte et annonce temporaires supprimés.

**Production 1.33.2** (CI verte sur `ad1fb42`), fenêtre d'achat réelle, acheteur de démonstration avec code postal connu
(75017), annonce temporaire Lyon → Paris : sur téléphone 375 px, **mémoire vide côté serveur**, les options sont
préchargées 5,5 s après le début du chargement de la fiche ; en cochant Mondial Relay aussitôt, les prix arrivent 4,4 s
plus tard (cotation du bac à sable Boxtal) mais la **liste des points est déjà là : 4 ms** après le choix « point relais »
(9 relais, 11 consignes). Sur grand écran, juste après (mémoire chaude) : options préchargées en 1,3 s, **prix et
nombre de points affichés 10 ms après avoir coché le transporteur, liste en 5 ms**. Limite connue : la première
cotation d'un colis pour une destination dépend du prestataire (5 à 9 s en bac à sable) ; elle ne se voit que si
l'acheteur ouvre la fenêtre dans les secondes qui suivent son arrivée sur une fiche jamais cotée. Compte et annonce
temporaires supprimés.

## 62. Page Paiements sans barème ni nom du prestataire ; avatar rond et pastille de présence dans la conversation — 18 septembre 2026

Demande du propriétaire, livrée **sans passage des suites locales** (crédit limité ; la CI reste le garde-fou) :

- Page « Paiements » : le bloc « Comment sont calculés les frais ? » est retiré (le barème ne doit pas être exposé), le bloc DAC7 est gardé sous « Bon à savoir » ; le nom du prestataire de paiement n'apparaît plus nulle part dans les textes du site (page Paiements, Formule, page de la vente, message d'un vendeur sans compte de versement). Les identifiants techniques (routes, variables) sont inchangés.
- Conversation : la vignette carrée de l'annonce laisse place à l'**avatar rond** de l'autre membre (photo ou initiale) avec une **pastille** en haut à droite — **verte** s'il est connecté, **orange** sinon, jamais d'heure de dernière visite. Présence tenue par la passerelle (sockets ouverts par membre ; `peerOnline` dans l'accusé de `join`, évènement `presence` à l'entrée dans la conversation et à la fermeture du dernier onglet). L'indicateur « ● en direct » disparaît de l'en-tête (« différé » n'apparaît qu'en cas de coupure). Vignettes de la boîte de réception arrondies.
- Specs `05` et `28` : l'attente de « en direct » devient l'attente de la pastille verte.

## 63. Litiges introuvables pour l'admin, annonces effacées trop tôt, audit complet, versement par IBAN — 22 septembre 2026

Demande du propriétaire : (1) un litige déclaré ne pouvait pas être tranché par l'admin ; (2) une annonce effacée
automatiquement à la réception doit rester consultable par l'administration (pas par les membres) si un litige
survient ; (3) audit complet — bugs, erreurs, failles, « personne ne doit pouvoir tricher » — avec test des
paiements et de Boxtal ; (4) un compte de versement simple (nom + IBAN) au lieu du parcours du prestataire.

### 1. Pourquoi l'admin ne pouvait pas trancher — cause racine

Reproduit localement : les trois décisions passent. Mesure en production : **l'API est en veille** (offre gratuite de
Render : premier appel 32 s, `uptimeSeconds` 24). La tâche interne des échéances (toutes les 15 min : encaissement
sous 24 h, réception présumée, virements) **ne tournait donc jamais** entre deux visites. Les autorisations
bancaires expiraient au bout de 7 jours sans encaissement ; toute décision demandant un mouvement d'argent finissait
chez le prestataire en refus, rendu au site en **500 « Erreur interne »** — l'admin ne voyait ni la cause ni ce
qu'il pouvait encore faire.

Corrections :
- **Échéances rejouées à chaque démarrage** de l'API (`onApplicationBootstrap`, 8 s après le réveil) et **workflow
  GitHub `keep-alive.yml`** : appel de `/health` toutes les 10 minutes (documenté dans `DEPLOIEMENT.md` §5b bis ;
  l'instance Starter reste la vraie solution).
- **État réel du paiement lu chez le prestataire** (`IPaymentProvider.inspect`) : la fiche admin l'affiche (« autorisé,
  non encaissé », « encaissé par Trocoin », « autorisation annulée ou expirée », « remboursé ») et n'offre que les
  décisions possibles — autorisation expirée → **annuler seulement** (l'acheteur n'a jamais été débité).
- `capture` relit l'état avant d'agir (déjà encaissé → rien ; annulé → refus explicite `autorisation_expiree`),
  `refund` ne rembourse pas deux fois ni un paiement annulé ; un identifiant de session resté en place est résolu en
  identifiant de paiement.
- **Refus du prestataire rendus en clair** (`providerCall`) : 409 avec message pour une autorisation expirée, 502
  « Le prestataire de paiement a refusé l'opération : … » sinon — sur les décisions admin, l'ouverture de litige et
  la confirmation de réception. Plus jamais « Erreur interne ».
- Fiche admin : bouton « Réessayer » sans perdre la page, « ouvert par l'acheteur / le vendeur » juste même sans
  compte, note bornée à 1 000 caractères.

### 2. Annonces archivées au lieu d'effacées

À la fin d'une vente (réception confirmée, remise validée, réception présumée, décision « libérer »), l'annonce est
**archivée** (`status = archivee`, `archivedAt`, migration `1789590000000`) : retirée de la recherche, de la fiche
(404), de « Mes annonces », des favoris et de l'historique — mais **conservée avec ses photos pour l'administration**
(fiche admin avec bandeau, lien depuis la fiche de la vente, filtre « Archivée » dans la liste). Effacement réel par
une tâche quotidienne après **90 jours**, jamais tant qu'un litige est ouvert ou qu'une fenêtre de litige court. Une
suppression (vendeur ou admin) d'une annonce ayant connu une vente payée archive au lieu d'effacer.

### 3. Audit complet — failles et bugs corrigés

Deux relectures systématiques (API : 35 constats ; front : 25 constats). Corrigé dans ce tour :

| Constat | Gravité | Correction |
| --- | --- | --- |
| **Export RGPD** (`/users/me/export`) livrait le **code de remise** : un vendeur pouvait valider la remise seul et être payé sans livrer | critique | code de remise, référence de paiement et de virement retirés de l'export |
| Fiches admin utilisateur / annonce renvoyaient les transactions brutes avec le code de remise | élevée | retiré |
| Décision admin, expédition, annulation pouvaient se croiser (double mouvement d'argent, vente « livrée » alors que l'acheteur est remboursé) | élevée | verrou par vente (`locked`), relecture avant décision, refus d'une seconde décision sur une vente tranchée |
| Virement au vendeur refusé par le prestataire → la confirmation de l'acheteur échouait en boucle | élevée | la vente est confirmée, le virement reste en attente et est retenté par la tâche périodique |
| Numéro de suivi **inventé** → « livrée » → réception présumée → vendeur payé sans envoi (livraison prépayée par l'acheteur) | élevée | expédition exigeant le bon d'envoi de Trocoin quand la livraison est prépayée ; forme du numéro contrôlée sinon |
| Admin : « Approuver et publier » sur une annonce vendue (vente en cours) ou un brouillon → double vente ; suppression admin pendant une vente | élevée | publication limitée à en vérification / refusée / en pause / expirée, jamais pendant une vente ; suppression refusée pendant une vente |
| « Renouveler » une annonce déjà en ligne = remontée gratuite illimitée (et réveil des alertes) | élevée | au plus une fois par semaine |
| Titre, description et prix modifiables pendant une vente payée | moyenne | figés jusqu'à la fin de la vente |
| Socket : un compte suspendu ou supprimé continuait d'écrire | moyenne | statut relu à chaque écriture |
| Vendeur au compte de versement commencé mais non fini : toutes ses annonces inachetables (400 après « Payer ») | moyenne | traité comme « pas de compte » : achat possible, virement en attente |
| Suppression de compte avec un virement dû : argent bloqué chez Trocoin | moyenne | refusée tant qu'un versement est dû |
| Remboursement fait depuis le tableau de bord du prestataire après virement au vendeur : Trocoin payait deux fois | moyenne | le virement est annulé ; annulation externe → bon d'envoi retiré |
| Signalement d'un membre confondu avec un signalement d'annonce (`undefined` ignoré) ; retrait sur signalement d'une annonce vendue | moyenne | `IsNull()` ; retrait limité aux annonces visibles |
| Faux avis à 0,51 € (prix 0,01 €) | moyenne | paiement sécurisé à partir de 1 € |
| Litiges anciens absents de la file « à échéance » | moyenne | litiges de plus de 7 jours inclus |
| Identifiant non UUID dans une route protégée → 500 | faible | 400 |
| Avatar / logo sans limite dédiée | faible | 10 par heure |
| PDF du bon d'envoi muet après expiration du jeton | élevée (front) | jeton rafraîchi, erreur affichée |
| « Débloquer » proposé à celui qui est bloqué | moyenne (front) | `blockedByMe` ; « Bloqué » sinon |

Non traité (choix ou reporté) : vérification SMS du numéro (reportée par le propriétaire — sans elle, un numéro
peut être usurpé à l'inscription) ; verrouillage par compte à la connexion ; exécution mémoire des recherches
sauvegardées ; compteurs de la console non rafraîchis après action ; champs vidés non enregistrés dans Paramètres.

### 4. Compte de versement en un formulaire (nom + IBAN)

Options pesées : (a) garder le parcours hébergé Express (le plus simple pour la conformité, mais plusieurs écrans,
SMS, pièce d'identité — c'est ce qui décourageait) ; (b) compte **Custom** créé par Trocoin depuis un formulaire du
site ; (c) virements SEPA faits par Trocoin depuis son propre compte bancaire — **écarté** : détenir et reverser les
fonds de tiers hors prestataire agréé est une activité réglementée (ACPR). Retenu : **(b)**. Le particulier saisit
prénom, nom, date de naissance, adresse, IBAN et coche les conditions du service de versement ; c'est le minimum
imposé par la réglementation des paiements — « nom + IBAN » seuls ne suffisent pas légalement. Prénom, nom, code
postal et ville sont préremplis ; l'IBAN est vérifié (format, clé) avant tout appel ; Trocoin n'en garde que les
4 derniers caractères. Si le prestataire demande ensuite une pièce d'identité (seuils de volume), la page le dit et
un lien n'ouvre que cette étape ; webhook `account.updated` à activer pour les comptes connectés. Les comptes
professionnels gardent le parcours hébergé. Migration `1789600000000`. La mention des conditions du prestataire
(lien) est contractuellement obligatoire : c'est la seule trace de son nom sur le site.

### 5. Paiement et Boxtal : ce qui a été testé

Pile locale (prestataire de paiement simulé, transporteur simulé) : achat, expédition, réception, remise, litige et
les trois décisions admin, autorisation expirée, refus du prestataire, archivage, formulaire IBAN. Production :
cotations et points Boxtal réels vérifiés aux §59 et §61 ; **un achat complet en production exige de saisir une carte
(même de test), ce qui reste interdit** — la chaîne paiement → séquestre → virement est prouvée par les tests API et
navigateur sur le prestataire simulé et par le parcours réel jusqu'à la page de paiement.

### Vérification

- API : `test/phase39` (5 tests : autorisation expirée → 409 en clair, décisions restreintes, annulation ; refus du prestataire
  → 502 sans changement d'état ; archivage et effacement différé ; formulaire IBAN et suppression bloquée ; export sans code,
  texte figé, suivi manuel sans réception présumée, renouvellement limité, suppression admin refusée, prix minimum) ;
  `phase17`, `22`, `24`, `26` adaptées aux nouvelles règles → **216 tests**, 1 ignoré.
- Navigateur : `31-versement-iban-archivage` (formulaire IBAN → compte actif « •••• 2606 », IBAN jamais réaffiché ; litige →
  état du prestataire sur la fiche admin → décision ; annonce archivée : bandeau admin, 404 membres, absente de « Mes
  annonces ») à 375 px et sur grand écran ; `30` adaptée au formulaire.

**Production 1.35.1 → 1.35.2.** Premier essai réel du formulaire (compte temporaire, IBAN de test public, mobile 375 px) :
refus du prestataire *« Connect platforms based in FR must create accounts via account tokens »* — rendu en clair sous le
formulaire (plus d'erreur interne), compte et état inchangés. Une plateforme établie en France doit transmettre
l'identité par un jeton de compte : corrigé en 1.35.2 (`tokens.create({ account })` puis `account_token`, conditions
attestées dans le jeton). La sauvegarde hebdomadaire de la base échouait depuis le passage du serveur en PostgreSQL 18
(« server version mismatch ») : `pg_dump` est désormais installé dans la version majeure du serveur — passage manuel
réussi (dump de 162 Ko, archive vérifiée).

**Production 1.35.2** (CI verte). Nouvel essai réel du formulaire sur téléphone 375 px, compte temporaire, IBAN de test
public : **compte de versement actif en 3,9 s** — « … versées automatiquement … sur le compte se terminant par •••• 2606 »,
état `{ onboardingComplete: true, kind: formulaire, ibanLast4: 2606, requirements: [] }` (capacité de virement active chez le
prestataire, aucune pièce demandée à ce stade), IBAN complet absent de toute réponse. Compte temporaire supprimé, compte de
versement fermé chez le prestataire.
