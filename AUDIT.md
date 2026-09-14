# AUDIT.md — Trocoin, état consolidé au 14 septembre 2026

Ce document remplace les sections incrémentales accumulées phase après phase (archivées
dans `AUDIT-HISTORIQUE.md`). Chaque affirmation est étiquetée :
**[exécuté]** vérifié par exécution réelle (tests e2e, appels HTTP sur la production, navigateur) ·
**[lecture]** vérifié par relecture du code · **[non testé]** impossible à tester ici, avec la raison ·
**[différé]** volontairement reporté par choix produit.

Production : API `https://trocoin.onrender.com` (Render, Docker, PostgreSQL Neon, SMS Vonage),
front `https://trocoin.vercel.app` (Vercel). Dépôt GitHub `ousbaali11/Trocoin`, branche `main`.

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
(EXIF/GPS supprimés, ≤ 1600 px, plafond par compte), CI GitHub (85 tests sur SQLite et sur
PostgreSQL 16, image Docker).

**Ce qui est en place dans le code mais pas encore actif en production, faute d'un compte ou
d'une clé à créer par vous :** e-mail transactionnel (Resend/Brevo), stockage objet des photos
(S3/R2), Redis pour le rate limiting multi-instances, déploiement automatique Render (deploy hook).

**Ce qui est volontairement différé (choix produit, §6) :** paiement Stripe/PayPal réel,
vérification SMS du téléphone à l'inscription (désactivée depuis le passage au mot de passe ;
le badge « téléphone vérifié » n'est affiché nulle part), validation juridique des textes.

**État de la base :** 1 compte réel en production (le vôtre), 0 annonce. Base Neon en
région **États-Unis** (`us-east-2`) : à migrer en Europe avant ouverture publique (§7).

**Préalable auto-deploy (point 0 du brief) : non résolu, et je ne peux pas le résoudre seul.**
Le dépôt GitHub n'a toujours aucun webhook vers Render et aucun secret `RENDER_DEPLOY_HOOK`
([exécuté] : `gh api …/hooks` → 0, `gh secret list` → vide). Render exécute aujourd'hui le
build de la phase 8 déployé à la main. J'ai ajouté à la CI un job « Déploiement Render (deploy
hook) + preuve /health » qui, dès que le secret `RENDER_DEPLOY_HOOK` existe, déclenche Render
après une CI verte puis attend que `/health` renvoie la version poussée (preuve automatique).
Le job reste inactif (avertissement) tant que le secret manque. Les deux actions qui vous
reviennent sont décrites dans `DEPLOIEMENT.md` §2b (deploy hook + secret GitHub : 2 minutes,
ou liaison du compte GitHub dans Render). Le commit de preuve (version 1.2.0 dans `/health`) est
poussé avec ce tour : il se déploiera tout seul dès que le secret sera en place, et le job CI
échouera visiblement si ce n'est pas le cas.

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
| Paiement | `PAYMENT_PROVIDER=disabled` en production : aucun flux d'argent possible | [exécuté] | [différé] Stripe/PayPal réels + webhooks |

---

## 3. Complétude fonctionnelle face à leboncoin (`analyse-concurrentielle.md`)

Synthèse par domaine (le détail filtre par filtre et famille par famille est en
`analyse-concurrentielle.md` §10, relevé réel sur leboncoin.fr des 14 et 15 septembre 2026).

| Domaine | leboncoin | Trocoin | Écart restant |
|---|---|---|---|
| Compte | SMS/e-mail, pro avec SIRET | Formulaire particulier/pro, SIRET vérifié au registre, mot de passe, username | Pas de connexion sociale ; téléphone non vérifié (différé) |
| Dépôt | Champs par catégorie, exemple de titre, photos, brouillon | Idem : 60 exemples de titre, schémas alignés (voir ci-dessous), 10 photos retraitées, brouillon, import CSV/XML, multi-utilisateurs pro, prix moyen constaté, fiche complète | Listes dépendantes marque → modèle → finition (référentiel constructeur absent) |
| Recherche | Mots-clés, localisation (Autour de moi / Toute la France / commune + rayon), filtres, tri, carte, sauvegarde | Identique, paliers de rayon exacts (0/1/5/10/20/30/50/100/200 km, 5 par défaut), plein texte français, dons/échanges en un clic | Historique des localisations ; arrondissements « toute la ville » |
| Annonce | Galerie, critères, vendeur, similaires, signalement | Identique + badge « Fiche complète » | — |
| Messagerie / transaction | Messagerie, paiement sécurisé, livraison | Messagerie temps réel, offres de prix, photos ; paiement **désactivé** | [différé] paiement ; pas d'étiquettes transporteur |
| Confiance / modération | Vérifications, modération | Pré-modération mots-clés, file admin, signalements, suspension, audit ; SIRET vérifié | Pas de vérification d'identité ni de téléphone |
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

## 5. Ce qui vous revient — comptes et clés à créer (rien de bloquant pour continuer à tester)

| Besoin | Pourquoi | Variables exactes (Render) | Guide |
|---|---|---|---|
| **Auto-deploy Render** | Fin des Manual Deploy ; preuve automatique par `/health` | Secret GitHub `RENDER_DEPLOY_HOOK` (URL du Deploy Hook Render) | `DEPLOIEMENT.md` §2b |
| **E-mail transactionnel** | Mot de passe oublié autonome | `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` (ou `brevo` + `BREVO_API_KEY`), `SITE_URL` | `DEPLOIEMENT.md` §5 ; l'appel HTTP (≈40 lignes) sera écrit et testé dès réception d'une clé |
| **Stockage des photos** | Disque Render éphémère | `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL` (Cloudflare R2, gratuit jusqu'à 10 Go) | `DEPLOIEMENT.md` « Fichiers envoyés » ; code testé contre un S3 simulé |
| **Base en Europe** | RGPD | Nouvelle `DATABASE_URL` Neon Frankfurt | `DEPLOIEMENT.md` §6b — **je vous demande de choisir** : nouvelle base vide, migration des données, ou risque accepté pour la bêta |
| Redis (plus tard) | Dès la 2ᵉ instance | `REDIS_URL` (Upstash gratuit) | `DEPLOIEMENT.md` §8b ; code testé avec un Redis simulé |
| Sentry (facultatif) | Erreurs 500 remontées | `SENTRY_DSN` | `DEPLOIEMENT.md` §7 |

---

## 6. Différés par choix produit (à ne pas confondre avec des manques)

- **Paiement sécurisé réel** (Stripe Connect, PayPal, webhooks signés, réconciliation) :
  implémenté en mode simulé, désactivé en production (`PAYMENT_PROVIDER=disabled`, 503
  explicite). Réactivation quand un compte Stripe de test existera.
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
1. Auto-deploy Render : secret `RENDER_DEPLOY_HOOK` (§5) — sinon chaque correctif attend un
   Manual Deploy et la production dérive du code.
2. E-mail transactionnel : sans lui, un testeur qui oublie son mot de passe dépend de vous
   (bouton admin).

**Non bloquant pour la bêta fermée, bloquant pour l'ouverture publique**
3. Stockage objet des photos (R2) : en bêta, accepter que les photos disparaissent à chaque
   déploiement ; inacceptable avec du public.
4. Base Neon en Europe (§5) — votre décision.
5. Vérification du téléphone par SMS (différé §6) ou, à défaut, un e-mail de confirmation
   dès que l'e-mail est branché : aujourd'hui rien ne prouve qu'un contact appartient à l'inscrit.
6. Textes légaux validés par un juriste ; information sur la collecte du téléphone non vérifié.
7. Instance Render payante (fin de la mise en veille : premier appel jusqu'à 1 minute) et Redis
   dès la deuxième instance.
8. Sauvegarde automatisée hors Neon + test de restauration ; Sentry alimenté.

**Confort / après ouverture**
9. Relevé manuel des 6 panneaux de filtres leboncoin non observés (Matériel pro, Famille,
   Loisirs, Vacances, Services, Animaux) et alignement fin.
10. Listes marque → modèle pour les véhicules ; historique des localisations ; arrondissements
    groupés.
11. Modification de l'e-mail avec confirmation ; suppression de compte revue ; double facteur.
12. Paiement réel, notifications push/e-mail, KYC, DAC7 (différés).

---

## 8. CI et déploiement de ce tour

(complété après le push du commit de ce tour)
