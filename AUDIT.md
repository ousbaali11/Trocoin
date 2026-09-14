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
(EXIF/GPS supprimés, ≤ 1600 px, plafond par compte), CI GitHub (97 tests sur SQLite et sur
PostgreSQL 16, image Docker). Depuis le tour « polish » du 14 septembre après-midi (§9) : centre
d'aide structuré, partage d'annonce, autres annonces du vendeur, reprise des consultations sur
l'accueil, préférences de notification par famille et canal, navigation compte et console admin
utilisables sur mobile, boîte de confirmation unique.

**Ce qui est en place dans le code, testé, mais pas activé en production par choix (bêta entre
proches, décision du 14 septembre, voir §6) :** e-mail transactionnel (Resend/Brevo), stockage
objet des photos (S3/R2), base Neon en Europe. À activer avant une vraie ouverture publique.
Redis pour le rate limiting multi-instances reste facultatif tant qu'il n'y a qu'une instance.

**Ce qui est volontairement différé (choix produit, §6) :** paiement Stripe/PayPal réel,
vérification SMS du téléphone à l'inscription (désactivée depuis le passage au mot de passe ;
le badge « téléphone vérifié » n'est affiché nulle part), validation juridique des textes.

**État de la base :** 1 compte réel en production (le vôtre), 0 annonce. Base Neon en
région **États-Unis** (`us-east-2`) : à migrer en Europe avant ouverture publique (§7).

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
| Annonce | Galerie, critères, vendeur, similaires, annonces du pro, partage, signalement | Identique + badge « Fiche complète », menu Partager (lien, WhatsApp, e-mail, Facebook, X, natif), « autres annonces de ce vendeur » | — |
| Messagerie / transaction | Messagerie, paiement sécurisé, livraison | Messagerie temps réel, offres de prix, photos ; paiement **désactivé** | [différé] paiement ; pas d'étiquettes transporteur |
| Confiance / modération | Vérifications, modération | Pré-modération mots-clés, file admin, signalements, suspension, audit ; SIRET vérifié | Pas de vérification d'identité ni de téléphone |
| Aide / notifications / RGPD | Centre d'aide structuré, préférences de notification, export | Centre d'aide (6 rubriques, 22 articles, recherche), préférences famille × canal, export JSON | E-mail enregistré mais non envoyé (différé) |
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

## 5. Comptes et clés — mode d'emploi quand vous déciderez de les activer

| Besoin | Pourquoi | Variables exactes (Render) | Guide |
|---|---|---|---|
| ~~Auto-deploy Render~~ | **Fait le 14 septembre** : secret `RENDER_DEPLOY_HOOK` en place, preuve automatique par `/health` (§8) | — | `DEPLOIEMENT.md` §2b |
| E-mail transactionnel [différé] | Mot de passe oublié autonome | `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` (ou `brevo` + `BREVO_API_KEY`), `SITE_URL` | `DEPLOIEMENT.md` §5 ; l'appel HTTP (≈40 lignes) sera écrit et testé dès réception d'une clé |
| Stockage des photos [différé] | Disque Render éphémère | `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL` (Cloudflare R2, gratuit jusqu'à 10 Go) | `DEPLOIEMENT.md` « Fichiers envoyés » ; code testé contre un S3 simulé |
| Base en Europe [différé] | RGPD | Nouvelle `DATABASE_URL` Neon Frankfurt | `DEPLOIEMENT.md` §6b — option 3 retenue pour la bêta (risque accepté), migration (option 2) avant ouverture |
| Redis (plus tard) | Dès la 2ᵉ instance | `REDIS_URL` (Upstash gratuit) | `DEPLOIEMENT.md` §8b ; code testé avec un Redis simulé |
| Sentry (facultatif) | Erreurs 500 remontées | `SENTRY_DSN` | `DEPLOIEMENT.md` §7 |

---

## 6. Différés par choix produit (à ne pas confondre avec des manques)

**Décision du 14 septembre 2026 (tests entre proches uniquement) — à traiter avant une vraie
ouverture publique :**

- **Fournisseur d'e-mail** : le parcours « mot de passe oublié » est complet et testé, mais
  aucun e-mail ne part (`EMAIL_PROVIDER=none` → 503 explicite). En bêta, l'admin dépanne avec
  un mot de passe temporaire depuis le back-office. Activation : clé Resend ou Brevo +
  `EMAIL_FROM` + `SITE_URL`, puis ~40 lignes d'appel HTTP à écrire et tester (§5).
- **Stockage objet des photos** : le code S3/R2 est en place et testé contre un S3 simulé ;
  en bêta, les photos restent sur le disque éphémère de Render et disparaissent à chaque
  déploiement (les testeurs le savent). Activation : bucket R2 + 6 variables (§5).
- **Région de la base Neon** : `us-east-2` conservée pour la bêta (données de quelques
  proches, risque accepté et connu) ; migration vers Francfort (`DEPLOIEMENT.md` §6b,
  option 2) avant toute ouverture publique.

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
- ~~Auto-deploy Render~~ réglé le 14 septembre (§8). Plus rien de bloquant pour la bêta :
  l'admin dépanne les mots de passe oubliés, les photos sont volatiles en connaissance de cause.

**Non bloquant pour la bêta fermée, à traiter avant l'ouverture publique (différés par choix, §6)**
1. E-mail transactionnel (clé Resend/Brevo).
2. Stockage objet des photos (R2).
3. Base Neon en Europe (migration).
4. Vérification du téléphone par SMS (différé §6) ou, à défaut, un e-mail de confirmation
   dès que l'e-mail est branché : aujourd'hui rien ne prouve qu'un contact appartient à l'inscrit.
5. Textes légaux validés par un juriste ; information sur la collecte du téléphone non vérifié.
6. Instance Render payante (fin de la mise en veille : premier appel jusqu'à 1 minute) et Redis
   dès la deuxième instance.
7. Sauvegarde automatisée : workflow prêt, à activer avec deux secrets (`DEPLOIEMENT.md` §6) ; test de restauration à faire une fois ; Sentry alimenté (DSN).

**Confort / après ouverture**
8. Canaux exacts du menu « Partager » de leboncoin à observer depuis un navigateur normal (bandeau cookies) ; relevé manuel des 6 panneaux de filtres leboncoin non observés (Matériel pro, Famille,
   Loisirs, Vacances, Services, Animaux) et alignement fin.
9. Listes marque → modèle pour les véhicules ; historique des localisations ; arrondissements
    groupés.
10. Modification de l'e-mail avec confirmation ; double facteur.
11. Paiement réel, notifications push/e-mail, KYC, DAC7 (différés).

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
