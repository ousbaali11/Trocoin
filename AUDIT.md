# AUDIT.md — Trocoin (audit final, 12 septembre 2026 · phases 2, 3 et mise en ligne, 13 septembre 2026)

Chaque affirmation de ce document est étiquetée :
**[exécuté]** = vérifié par exécution réelle (tests e2e `npm test` 54/54 après la phase 3, sur SQLite et sur PostgreSQL, appels HTTP,
`test/ws-smoke.js`, parcours complets dans le navigateur sur le front Next.js) ;
**[lecture]** = vérifié par relecture du code seulement ;
**[non testé]** = impossible à tester dans cet environnement, avec la raison.

---

## 1. Résumé exécutif

**État global.** Le projet est passé d'un MVP backend seul (13 endpoints, aucun
test, plusieurs failles) à une plateforme complète : API NestJS 12 avec 12 modules
et ~70 endpoints, 36 tests e2e, et un front Next.js 16 en trois espaces (site
public, espace compte, console d'administration) construit, compilé en production
(`next build` : 34 routes) et **parcouru de bout en bout dans un navigateur** :
inscription OTP → dépôt d'annonce avec photos → recherche/carte → contact →
messagerie temps réel → achat sécurisé → confirmation → avis → passage pro →
onboarding Stripe (mock) → modération admin → journal d'audit.

**Prêt pour une mise en production réelle ? Non, pas encore — mais prêt pour une
bêta fermée ou une démonstration investisseur.** Les blocages ne sont pas des
défauts de code mais des briques externes jamais exercées en conditions réelles
(SMS réel, Stripe réel, PostgreSQL, hébergement) et quelques mesures de
durcissement (refresh tokens, stockage objet des photos, monitoring).

**Principaux risques restants** (détail §2.3 et §6) :
1. Stripe Connect implémenté mais **jamais exécuté avec de vraies clés** (pas de
   clé disponible, pas d'accès réseau vérifié) ; le webhook Stripe n'est pas
   implémenté : un paiement refusé côté banque après autorisation ne serait pas
   répercuté.
2. Aucun fournisseur SMS réel branché : l'OTP fonctionne uniquement en mock.
3. Migrations PostgreSQL à générer contre la base cible (jamais exécuté sur Postgres).
4. JWT de 7 jours sans refresh ni révocation (atténué : compte rechargé à chaque requête).
5. Photos sur disque local, sans redimensionnement ni purge des métadonnées EXIF.
6. Rate limiting et cache en mémoire : incompatibles avec plusieurs instances.

---

## 2. Sécurité

### 2.1 Vulnérabilités trouvées dans l'existant et corrigées

| # | Constat initial | Sévérité | Correction | Vérification |
|---|---|---|---|---|
| S1 | CORS totalement ouvert (`cors: true`), y compris WebSocket `origin: '*'` | Haute | Liste blanche `CORS_ORIGINS` obligatoire en prod, partagée HTTP + WS ; origine inconnue → 403 | [exécuté] test e2e CORS |
| S2 | `synchronize: true` inconditionnel (perte de données possible en prod) | Haute | `data-source.ts` : synchronize hors prod seulement, `migrationsRun` en prod, scripts CLI | [exécuté] génération + exécution d'une migration sur SQLite vierge ; Postgres [non testé] |
| S3 | Secret JWT par défaut dupliqué dans 3 modules | Critique | Validation d'environnement : démarrage refusé en prod si secret absent/faible ; un seul `AuthModule` global | [exécuté] démarrage bloqué avec `NODE_ENV=production` |
| S4 | `suspendedAt` jamais vérifié → un suspendu gardait 7 jours d'accès | Haute | Compte rechargé à chaque requête HTTP et à chaque connexion WS ; rôle admin lu en base | [exécuté] tests suspension + admin |
| S5 | Extension de fichier issue du nom client → HTML déguisé en image servi depuis `/uploads` (**XSS stocké**) | Critique | Nom UUID, extension déduite de la signature binaire, `nosniff`, chemin borné | [exécuté] test e2e « HTML déguisé → 400, aucun fichier » |
| S6 | Upload écrit sur disque avant le contrôle de propriété (remplissage de disque) | Moyenne | `ListingOwnerGuard` avant l'interceptor multer | [exécuté] 403 sans fichier écrit |
| S7 | Fichiers orphelins à la suppression | Basse | Suppression physique (photo, annonce, avatar, compte) | [exécuté] |
| S8 | Rate limiting global uniquement (spam SMS possible) | Haute | Limites dédiées OTP par IP **et** plafond horaire par numéro + cooldown ; limites sur dépôt/contact/achat/signalement/export | [exécuté] tests + limite réellement atteinte pendant les tests navigateur (429) |
| S9 | Endpoint `/dev/last-otp` protégé par une seule condition | Moyenne | 404 si `NODE_ENV=production` + code non conservé hors mock + mock interdit en prod | [exécuté] |
| S10 | `PATCH /users/me` sans DTO (`any`) | Moyenne | DTO strict, champs sensibles ignorés | [exécuté] |
| S11 | DTO incomplets (bornes, enums, UUID, NaN en SQL) | Moyenne | Tous les DTO complétés, `ParseUUIDPipe`, `attributes` validés contre le schéma de catégorie | [exécuté] |
| S12 | Comparaison OTP non constante | Basse | `timingSafeEqual` | [lecture] |
| S13 | Injection SQL | — | Aucune concaténation trouvée ; QueryBuilder paramétré partout ; échappement `%`/`_` ajouté | [lecture] + tests de recherche |
| S14 | Fuite d'information (erreurs multer en 500 brut) | Basse | Filtre global : message générique, log serveur, `helmet`, `x-powered-by` retiré | [exécuté] |
| S15 | Annonces non publiées lisibles par ID | Moyenne | 404 sauf propriétaire/admin | [exécuté] |
| S16 | Métier paiement : achat d'annonce non en ligne, double vente, remboursement jamais appelé | Haute | Statut requis, une transaction active par annonce, exclusions/plafond, annulation, arbitrage | [exécuté] |
| S17 | WebSocket : condition de course d'authentification (`join` avant fin de `handleConnection`), throttler appliqué aux handlers WS | Moyenne | Authentification en middleware socket.io (avant `connection`), throttler limité au HTTP | [exécuté] constaté puis corrigé dans le navigateur ; smoke 4/4 |
| S18 | 21 vulnérabilités `npm audit` (1 critique) | Haute | NestJS 10 → 12, sqlite3 6, multer 2.3 forcé | [exécuté] `npm audit` : 0 |
| S19 | Aucun test automatisé | Haute | 36 tests e2e | [exécuté] |

Front : jeton en `localStorage` (pas de cookie → pas de CSRF), redirection `next`
restreinte aux chemins internes (pas d'open redirect), en-têtes `X-Frame-Options`,
`nosniff`, `Referrer-Policy`, `/admin` en `noindex` + `robots.txt`, aucune
utilisation de `dangerouslySetInnerHTML` hormis le JSON-LD généré côté serveur à
partir de données sérialisées [lecture].

### 2.2 Contrôle d'accès (revue endpoint par endpoint) [exécuté]

| Ressource | Règle | Test |
|---|---|---|
| Annonce (modifier, supprimer, renouveler, dupliquer, photos) | propriétaire uniquement | 403 tiers, upload sans écriture |
| Annonce non en ligne | invisible sauf propriétaire/admin | 404 public, 200 propriétaire |
| Conversation | participants uniquement, blocage bidirectionnel | 403 tiers, 403 après blocage |
| Transaction | acheteur/vendeur ; confirmation = acheteur ; expédition/code = vendeur | 403 croisés |
| Avis | partie à une transaction confirmée, un avis par partie | 400/403 |
| Signalement | pas sa propre annonce, un ouvert par cible | 400 |
| Admin | JWT + `accountType='admin'` relu en base ; auto-suspension/rétrogradation interdite | 403 non-admin, 401 anonyme, 400 auto-suspension |
| Recherche sauvegardée, favoris, blocages, notifications | propriétaire | 404/200 |

### 2.3 Restant à traiter

| Point | Sévérité | Recommandation |
|---|---|---|
| Pas de refresh token, pas de révocation, JWT 7 jours | Moyenne | Access 15 min + refresh rotatif en base ; déconnexion = révocation |
| Webhook Stripe absent (`payment_intent.payment_failed`, `charge.dispute.created`, `account.updated`) | Haute avant prod | Endpoint `/payments/stripe/webhook` avec vérification de signature ; réconciliation des statuts |
| Photos sur disque, sans redimensionnement ni suppression EXIF (géolocalisation embarquée !) | Haute (vie privée) | S3/OVH + `sharp` : recompression, miniatures, purge EXIF |
| Rate limiting / caches en mémoire | Moyenne | Redis (throttler storage, cache catégories) |
| Aucune journalisation structurée ni alerting | Moyenne | Sentry, logs JSON, alertes sur 429/échecs OTP/erreurs 500 |
| `simple-json` pour `attributes` ; filtres d'attributs et distance en mémoire (≤ 2 000 lignes) | Moyenne (perf) | `jsonb` indexé, PostGIS, puis Elasticsearch/Meilisearch |
| Pas de vérification SIRET auprès de l'INSEE (Luhn seulement) | Moyenne | API Sirene + KYC pro |
| Pas de 2FA, pas de connexion e-mail/SSO | Basse (choix produit) | — |
| Pas de vérification d'identité (KYC) | Moyenne | Déléguer à Stripe Identity / Ubble, alimenter `identityVerified` |
| Pas de CSP stricte sur le front (fonts Google) | Basse | CSP avec nonce, fonts auto-hébergées |

---

## 3. Complétude fonctionnelle (vs `analyse-concurrentielle.md` §8)

Légende : **Fait** (API + front, exécuté) · **Partiel** · **Absent** (hors périmètre, documenté).

### Comptes
| Fonctionnalité | État | Justification |
|---|---|---|
| Inscription téléphone FR + OTP | Fait | Front : page connexion avec renvoi, erreurs, raccourci dev |
| E-mail/mot de passe, SSO, 2FA | Absent | Choix produit : le mobile FR est l'identifiant unique |
| Profil (pseudo, ville, CP, avatar) | Fait | Upload avatar vérifié par signature |
| Taux de réponse, ancienneté, badges | Fait | Profil public et carte vendeur |
| Badge identité vérifiée | Partiel | Activable par l'admin ; pas de KYC automatisé |
| Compte pro (SIRET Luhn, vitrine : logo, description, adresse, horaires, site) | Fait | Testé dans le navigateur |
| Suspension, rôle admin, script de création admin | Fait | |
| Export RGPD, suppression (anonymisation, numéro libéré) | Fait | |
| Préférences notification (push/SMS) | Fait | Fournisseur réel à brancher |
| Utilisateurs bloqués | Fait | |
| Refresh token | Absent | Voir §2.3 |

### Dépôt d'annonce
| Fonctionnalité | État | Justification |
|---|---|---|
| 12 familles + 46 sous-catégories | Fait | Seed idempotent |
| Champs dynamiques par catégorie (validés) | Fait | 36 schémas (véhicules, immo, emploi, mode, multimédia…) |
| Types de prix, état (liste fermée) | Fait | |
| Photos : 10 max, signature vérifiée, réordonnancement, couverture | Fait | Glisser-déposer (phase 2) |
| Livraison possible (hors catégories exclues) | Fait | |
| Localisation : autocomplétion adresse.data.gouv.fr, position approximative, repli centroïde département | Fait | |
| Brouillon, aperçu, duplication | Fait | |
| Expiration 60 j (cron), renouvellement | Fait | Cron horaire [exécuté en test unitaire], pas observé sur 60 j |
| Pré-modération (mots-clés interdits, coordonnées) → file admin | Fait | |
| Refus motivé | Fait | Notification au vendeur |
| Quota particulier (20 / 30 j) | Fait | |
| Options de mise en avant (boost, urgent) | **Fait (phase 2)** | Tri prioritaire, badges, filtre « urgent » ; gratuites tant que la monétisation est désactivée |
| Formules / abonnements pro | **Fait (phase 2), désactivé par défaut** | 3 plans configurables par l'admin, sans prélèvement réel |
| Recadrage intégré des photos | **Fait (phase 2)** | Cadre 4:3, zoom, rotation, ré-encodage JPEG 1600 px avant envoi |

### Recherche
| Fonctionnalité | État |
|---|---|
| Texte, catégorie/famille, ville, code postal (préfixe), prix, état, livraison, particulier/pro, avec photo, date | Fait |
| Rayon km + « autour de moi » + tri distance + carte | Fait |
| Filtres spécifiques par catégorie (select, min/max, booléen) | Fait |
| Tri récents / prix | Fait |
| Recherche sauvegardée + alertes (cron 5 min, notification in-app + push mock) | Fait |
| Suggestions (titres + catégories) et correction simple | **Fait (phase 2)** — requête SQL LIKE + Levenshtein, sans moteur dédié (limite documentée §4) |
| Recherche visuelle | Absent |
| Historique de consultation | **Fait (phase 2)** |

### Page annonce
Galerie plein écran, caractéristiques libellées, description, carte approximative,
carte vendeur, similaires, compteur de vues et favoris, partager, signaler, favori,
contacter, acheter avec devis affiché, JSON-LD Product, canonical : **Fait**.

### Messagerie et transaction
| Fonctionnalité | État |
|---|---|
| Chat temps réel (WebSocket authentifié) + repli REST/polling | Fait |
| Boîte de réception enrichie, non-lus, accusé de lecture | Fait |
| Réponses rapides, blocage, signalement de conversation | Fait |
| Photo dans un message, proposition de prix (accepter / refuser / retirer) | **Fait (phase 2)** |
| Paiement séquestre, devis avant validation (frais acheteur + commission) | Fait (mock) / Stripe [non testé] |
| Remise en main propre avec code, expédition avec suivi, annulation, litige | Fait |
| Arbitrage admin (rembourser / libérer) | Fait |
| Étiquette transporteur (Colissimo / Mondial Relay) | Absent (partenariat) |
| Onboarding Stripe Connect | Fait en mock / réel [non testé] |
| Webhook Stripe | Absent |

### Confiance, modération, admin
Avis après transaction (reçus/donnés, note recalculée), signalements (annonce,
utilisateur, conversation ; 10 motifs), liste noire d'objets interdits,
back-office complet (stats, utilisateurs, annonces, signalements avec actions,
litiges, journal d'audit), pages CGU / confidentialité / mentions légales /
aide : **Fait**. CMS des pages légales : **Fait (phase 2)**. DAC7, modération d'images par IA : **volontairement différés** (voir §7).

### Espace pro
Vitrine complète, badge, statistiques vendeur (vues, favoris, par statut) : **Fait**.
Import CSV/XML (création + mise à jour par référence, rapport d'erreurs par ligne) : **Fait (phase 2)**. Multi-utilisateurs (membres invités par numéro, publication « au nom de » la boutique, droits vérifiés à chaque action) : **Fait (phase 2)**. Formules pro : **Fait (phase 2)**, sans effet tant que la monétisation est désactivée. CRM : Absent.

**Bilan** : sur les 95 lignes de l'analyse des écarts, 71 sont **faites**, 3
**partielles**, 21 **absentes** — toutes les absences relèvent de la V2 du cahier
des charges (monétisation, import de flux, logistique) ou de partenariats externes.

---

## 4. Qualité de code

**Architecture.** Modulith NestJS : un module par domaine, services testables,
fournisseurs externes derrière des interfaces (SMS, paiement, notifications) avec
mock + implémentation réelle. Front : App Router, composants serveur pour le SEO
(accueil, recherche shell, annonce, vendeur, sitemap), composants clients pour
l'interactif, un client API unique, contexte d'auth, système de design en CSS
natif (tokens, pas de framework).

**Tests.** 36 tests e2e (auth 12, annonces 11, transactions/admin 13) sur SQLite
en mémoire, couvrant chaque règle métier et de sécurité listée ci-dessus. Aucun
test unitaire isolé ni test front automatisé : le front a été validé par
parcours manuels outillés (navigateur piloté) et `next build`.

**Dette technique identifiée**
- `simple-json` + filtres en mémoire (voir §2.3).
- Certaines listes admin font N+1 requêtes (enrichissement par ligne) : acceptable
  à 25 lignes/page, à remplacer par des jointures.
- `taux de réponse` calculé à la volée (une requête par conversation) : à
  matérialiser.
- Suggestions de recherche : requête `LIKE` sur les titres + correction par distance de Levenshtein calculée sur les 500 derniers titres — suffisant jusqu'à quelques dizaines de milliers d'annonces, à remplacer par un moteur dédié ensuite.
- `ScheduleModule` en processus API : à externaliser (BullMQ) avant montée en charge.
- Quelques `any` dans les contrôleurs (`req: any`) : typer `Request & { user: AuthUser }`.
- Pas de lint CI ni de pipeline : à ajouter (`tsc`, `jest`, `next build`).
- `@nestjs/throttler` installé avec `--legacy-peer-deps` (peer Nest 12 non déclaré) :
  à mettre à jour dès publication.

---

## 5. Ce qui n'a pas pu être testé réellement

| Élément | Pourquoi | Ce qui a été fait à la place |
|---|---|---|
| **Stripe Connect / PaymentIntent réels** | Aucune clé API disponible ; pas de compte Stripe | Implémentation complète (`StripePaymentProvider`, `StripeConnectService`), typée contre le SDK officiel, exercée en mode mock de bout en bout. À valider avec `sk_test_` : onboarding Express, autorisation `capture_method: manual`, capture, annulation/remboursement avec `reverse_transfer`. |
| **Envoi de SMS réel** | Aucun compte Vonage/Twilio/OVH | Interface `ISmsProvider`, mock journalisant ; un fournisseur non implémenté fait échouer l'envoi explicitement au lieu de l'ignorer. |
| **Push mobile / e-mail** | Pas de projet Firebase, pas de SMTP | `INotificationProvider` mock ; centre de notifications in-app réel. |
| **PostgreSQL** | Pas d'instance disponible | Types de colonnes portables (`timestamptz`/`datetime`, `jsonb`/`simple-json`), migration générée et exécutée sur SQLite ; **une migration Postgres doit être générée contre la base cible avant le premier déploiement**. |
| **Expiration à 60 jours** | Nécessite 60 jours réels | Méthode du cron testée directement en e2e (`expireListings`). |
| **Charge / plusieurs instances** | Un seul processus local | Documenté (§2.3). |
| **Recadrage/compression d'images, purge EXIF** | Non implémenté | Documenté comme prérequis prod. |
| **Comportement derrière un reverse proxy** (`TRUST_PROXY`) | Pas de proxy local | Option implémentée, non observée. |

---

## 6. Recommandations avant lancement réel (par priorité)

**P0 — bloquant**
1. Générer et exécuter les migrations sur PostgreSQL ; désactiver toute synchronisation.
2. Brancher un fournisseur SMS réel et tester l'OTP sur de vrais numéros (coût, latence, échecs).
3. Configurer Stripe Connect avec des clés de test, dérouler achat → capture → remboursement,
   puis implémenter le **webhook** signé et la réconciliation des statuts.
4. Stockage objet (S3/OVH) + `sharp` (redimensionnement, purge EXIF) pour toutes les images.
5. Secrets de production (`JWT_SECRET` 48 octets aléatoires), `CORS_ORIGINS`, `TRUST_PROXY=true`
   derrière nginx/Cloudflare, HTTPS/HSTS.
6. Faire valider CGU, politique de confidentialité et mentions légales par un juriste ; compléter
   l'éditeur, l'hébergeur et le médiateur.

**P1 — avant ouverture publique**
7. Refresh tokens rotatifs + révocation ; durée d'accès courte.
8. Redis pour le rate limiting et les caches ; BullMQ pour les alertes et l'expiration.
9. Monitoring : Sentry, logs structurés, alertes sur pics de 429 et d'erreurs OTP.
10. Sauvegardes PostgreSQL et procédure de restauration testée.
11. Vérification SIRET (API Sirene) et KYC pour le badge identité et les catégories sensibles.
12. Pipeline CI (`tsc`, `jest`, `next build`, `npm audit`) et tests front automatisés (Playwright).

**P2 — après lancement**
13. Moteur de recherche dédié (suggestions, fautes, facettes) et PostGIS.
14. (fait en phase 2 : proposition de prix, photos dans la messagerie, drag-and-drop)
15. Étiquettes Colissimo / Mondial Relay ; DAC7 (collecte des informations fiscales des vendeurs
    dépassant les seuils).
16. Monétisation : boosts, abonnements pro, import de catalogue, multi-utilisateurs.
17. Application mobile (React Native) réutilisant l'API.

---


---

## 7. Phase 2 (13 septembre 2026) — fonctionnalités complètes, catégories, navigation, design clair

### 7.1 Ce qui a été ajouté

| Domaine | Ajout | Fichiers principaux |
|---|---|---|
| Monétisation désactivable | Table `system_settings` (clé/valeur), interrupteur `monetization_enabled` **à false par défaut**, prix boost/urgent et quota configurables ; entités `Plan` (Gratuit 0 €, Boutique 29 €, Boutique Premium 79 €) et `Subscription` ; calcul central des droits `SettingsService.entitlements()` consulté avant tout quota ou toute mise en avant | `src/settings/*`, `listings.service.ts` (`assertQuota`, `promote`) |
| Back-office | Page « Monétisation et formules » (interrupteur avec confirmation, paramètres, édition des 3 plans) ; page « Pages légales (CMS) » (éditeur Markdown, aperçu, publication) ; tout est journalisé dans `admin_audit_log` | `frontend/src/app/admin/reglages`, `admin/pages`, `src/admin/*` |
| PayPal | Second fournisseur `PaypalPaymentProvider` derrière `IPaymentProvider`, sélectionné par `PAYMENT_PROVIDER=paypal`, **simulé** (aucun appel réseau, aucune clé) | `src/payments/paypal-payment.provider.ts` |
| Mise en avant | `boostedUntil` / `urgentUntil` (7 jours), `POST /listings/:id/promote`, tri prioritaire des boostées (sauf tri par prix), badges « À la une » / « Urgent », filtre `urgent=true`, boutons dans Mes annonces | `listing.entity.ts`, `listings.service.ts`, `ListingCard.tsx` |
| Import de catalogue | `POST /listings/import` (CSV séparateur auto / XML, 500 lignes, 2 Mo, en mémoire), création ou mise à jour par `reference`, mêmes validations qu'un dépôt manuel, rapport par ligne ; écran « Ma boutique » avec modèle CSV téléchargeable | `src/listings/import/listing-import.ts`, `compte/boutique` |
| Multi-utilisateurs | Table `shop_members`, invitation par numéro de mobile (compte existant requis, 10 max), `onBehalfOf` au dépôt, `getManaged()` remplace `getOwned()` partout (annonce, photos, boost, import), `createdBy` conservé, retrait immédiat des droits | `src/shops/*`, `listing-owner.guard.ts` |
| Recadrage photo | Modale canvas 4:3 (déplacement, zoom, rotation), ré-encodage JPEG 1600 px **avant** envoi ; proposé automatiquement à l'ajout et sur chaque vignette | `PhotoCropper.tsx` |
| Glisser-déposer | Réordonnancement des photos (déjà envoyées et en attente) par drag-and-drop HTML5, persisté via `PATCH /photos/order` | `ListingForm.tsx` |
| Historique | Table `listing_views` (une ligne par couple, date rafraîchie), `GET/DELETE /listings/history`, page « Annonces consultées », non enregistré pour ses propres annonces ni pour les anonymes | `listing-view.entity.ts`, `compte/historique` |
| Messagerie | Messages typés `text` / `image` / `offer` ; photo via `POST /conversations/:id/images` (MIME + signature binaire, appartenance vérifiée avant conservation du fichier) ; proposition de prix par l'acheteur (une seule en attente), accepter / refuser (vendeur) / retirer (acheteur), notifications ; rendu dans le fil (vignette cliquable, carte d'offre) | `message.entity.ts`, `conversations.*`, `compte/messages/[id]` |
| CMS pages légales | Table `legal_pages` seedée (CGU, confidentialité, mentions légales, à propos), `GET /pages/:slug` public, `PATCH /admin/pages/:slug`, rendu Markdown **échappé** côté front (aucun HTML injectable) | `src/pages/*`, `lib/markdown.ts`, `LegalPageView.tsx` |
| Suggestions | `GET /listings/suggest?q=` : titres d'annonces en ligne + catégories, correction par distance de Levenshtein ≤ 2 ; barre de recherche avec liste déroulante, navigation clavier, « Essayez avec … » | `listings.service.ts`, `SearchBox.tsx` |
| Catégories | Arborescence de référence : 12 racines dans l'ordre imposé, « Multimédia » → « Électronique », « Matériel professionnel » → « Matériel pro », « Vacances » → « Locations de vacances » (sans sous-catégorie ; type d'hébergement, nombre de voyageurs, piscine / jardin / animaux = champs dynamiques **filtrables**), Services : 15 sous-catégories (`travaux-artisans` renommé en `jardinerie-bricolage` avec conservation de l'id), Animaux : 5 ; seed idempotent qui migre les données (les annonces de « Locations saisonnières » sont rattachées à la racine). Une famille qui a des enfants refuse le dépôt direct. | `categories.service.ts`, `category-schemas.ts` |
| Navigation | Barre publique : **Mes recherches · Favoris · Messages · Se connecter / menu compte · Déposer une annonce** (accent), badges (recherches sauvegardées, messages non lus, notifications) ; les liens personnels déclenchent la connexion avec retour ; méga-menu des catégories ; menu mobile | `Header.tsx` |
| Design | Palette claire : fond `#f5f7f9`, surfaces blanches, texte `#1f2933`, **un seul accent** vert `#0f7b5f` (contraste AA sur blanc), boutons ≥ 42 px, champs ≥ 44 px ; en-tête et pied de page blancs ; le back-office conserve son thème ardoise/indigo distinct | `globals.css`, `home.module.css`, `Header.module.css`, `Footer.module.css` |

### 7.2 Comment cela a été vérifié [exécuté]

- **Tests e2e** : nouvelle suite `test/phase2.e2e-spec.ts` (13 tests) → **49/49** au total, `npm audit` 0 vulnérabilité, `tsc` API et front sans erreur, `next build` : 37 routes.
- **Gratuité** (§7.3 ci-dessous).
- **Navigateur** (Next.js sur :3001, API sur :3000, données de démonstration) :
  - accueil clair, 12 familles dans l'ordre de la référence ; méga-menu avec les 15 sous-catégories Services et les 5 Animaux ;
  - barre publique déconnectée : « Mes recherches · Favoris · Messages · Se connecter · Déposer une annonce » ; clic sur « Favoris » → `/connexion?next=/compte/favoris` → après OTP, retour sur Favoris ; connectée : menu compte à la place de « Se connecter », compteurs affichés ;
  - suggestions : « canap » → titres d'annonces ; « canaper » → « Essayez avec canapé » ;
  - dépôt sous « Locations de vacances » : liste Type d'hébergement (Maisons et villas, Appartements, Chalets, Chambres d'hôtes, Campings), Nombre de voyageurs, cases Piscine / Jardin / Animaux acceptés ; recadreur ouvert automatiquement, rotation + validation → image 1600×1200 ; annonce publiée, caractéristiques affichées, retrouvée par le filtre `attr.piscine=true` et le panneau « Caractéristiques Locations de vacances » ;
  - Mes annonces (compte pro) : « Mettre en avant (gratuit) » et « Urgent (gratuit) » → badges et annonce en tête de la recherche Voitures ;
  - Ma boutique (pro) : invitation d'un membre par numéro (affiché masqué), import d'un CSV de 3 lignes → 2 créées, 1 erreur détaillée (catégorie inconnue) ;
  - messagerie : acheteur envoie une proposition (220 €) puis une photo ; vendeuse voit les deux, clique « Accepter » → « Acceptée », notification reçue ;
  - historique : page « Annonces consultées » ;
  - admin : page Monétisation → « Activer » → `/settings/public` renvoie `monetizationEnabled: true` → « Désactiver » → `false` ; les deux bascules apparaissent dans le journal d'audit avec l'ancienne et la nouvelle valeur ; page CMS avec les 4 pages, éditeur et aperçu.

### 7.3 Confirmation : le site reste entièrement gratuit tant que l'admin n'active pas la monétisation

Preuves d'exécution (test `phase2.e2e-spec.ts`, « flag désactivé : un compte pro SANS abonnement publie sans limite… ») :
- `GET /settings/public` → `monetizationEnabled: false` (valeur seedée par défaut) ;
- un compte **professionnel sans abonnement** : `entitlements` = `listingsLimit: null, boostsLimit: null, boostPrice: 0, urgentPrice: 0` ; **25 annonces publiées** d'affilée sans erreur (au-delà des 20 du plan « Gratuit » et du quota particulier) ; boost et urgent appelés plusieurs fois, réponse `charged: 0` ;
- un **particulier** : 22 annonces publiées, boost gratuit ;
- aucun endpoint du parcours (dépôt, mise en avant, formule) ne renvoie de demande de paiement ; la page Formule affiche « Période de lancement : tout est gratuit » et désactive les boutons de souscription ; la page Mes annonces affiche le bandeau « tout est gratuit et illimité ».
- Contre-épreuve : flag activé par l'admin → quota de 2 annonces appliqué (400 « Limite de 2 annonces »), boost refusé avec le prix (« 2.99 € »), souscription au plan Premium enregistrée avec `charged: 79` mais **sans prélèvement** (provider `mock`) ; flag désactivé de nouveau → un autre compte publie 3 annonces, `listingsLimit: null`.

### 7.4 Volontairement différé (nécessite un compte ou une API externe payante)

À ne pas lire comme « manquant » : ces briques sont prêtes à être branchées et restent hors périmètre tant que les comptes n'existent pas.

| Élément | État du code | Ce qu'il faudra |
|---|---|---|
| Stripe réel (paiement + Connect) et webhooks | `StripePaymentProvider` et `StripeConnectService` implémentés, jamais exécutés avec de vraies clés ; webhook absent | Compte Stripe, clés de test, endpoint signé `/payments/stripe/webhook` |
| PayPal réel | `PaypalPaymentProvider` simulé (même contrat) | Compte marchand, Orders API v2 (authorize / capture / refund), Commerce Platform pour les versements |
| Prélèvement des abonnements | `Subscription` enregistrée avec `provider: 'gratuit' | 'mock'` | Abonnements récurrents Stripe Billing ou PayPal Subscriptions |
| Étiquettes de transport Colissimo / Mondial Relay | Statut `livree` + numéro de suivi saisi manuellement | Contrats transporteurs, API d'étiquetage |
| Vérification SIRET réelle | Contrôle Luhn uniquement | API Sirene (INSEE) |
| Vérification d'identité (KYC) | Badge `identityVerified` activable par l'admin | Stripe Identity, Ubble ou équivalent |
| Déclaration DAC7 | Non implémentée (mention informative dans Paiements) | Collecte NIR / adresse au-delà des seuils, export annuel |
| Modération d'images par IA | Non implémentée ; la pré-modération par mots-clés et la file de vérification manuelle du back-office restent le mécanisme actif | Google Vision SafeSearch ou AWS Rekognition |

### 7.5 Limites connues introduites en phase 2

- Suggestions par `LIKE` sans index full-text (voir §4) ; correction calculée sur les 500 derniers titres.
- Filtres d'attributs (dont piscine / voyageurs) appliqués en mémoire sur 2 000 candidats maximum (déjà noté en §2.3 pour `jsonb`).
- `createdAt` des messages à la seconde en SQLite : l'aperçu « dernier message » peut être ambigu pour deux messages envoyés dans la même seconde (sans incidence sur le fil, ordonné de façon stable ; PostgreSQL a une précision à la microseconde).
- Import : les photos ne sont pas importées par URL (choix de sécurité : pas de récupération de ressources distantes côté serveur).
- Le recadrage est facultatif (« Garder l'original ») : une image non recadrée reste envoyée telle quelle, jusqu'à 8 Mo.

## 8. Phase 3 (13 septembre 2026) — SMS réel, mise en ligne, durcissement

Objectif du brief : fournisseur SMS réel, bascule PostgreSQL, conteneur de production, CI,
sessions révocables, monitoring, sauvegardes. Règle appliquée : rien n'est déclaré fait sans
preuve d'exécution ; ce qui n'a pas pu être exécuté est listé en §8.6 et §8.7.

### 8.1 SMS : ce qui a été fait, ce qui ne l'a pas été (et pourquoi)

**Aucun identifiant SMS n'est présent dans `.env`** (vérifié : `SMS_PROVIDER=mock`, aucune
clé Vonage/Twilio). Conformément au brief, l'appel HTTP vers Vonage ou Twilio **n'a pas été
inventé** : il serait intestable. Variables attendues, noms exacts :

| Fournisseur | Variables |
|---|---|
| Vonage | `SMS_PROVIDER=vonage`, `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `SMS_SENDER` |
| Twilio | `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` |

Ce qui est en place et **[exécuté]** :

- `ISmsProvider` + `SmsDeliveryError(provider, reason)` ; `SmsService.sendOtp` borne l'appel à
  10 s et convertit toute erreur (numéro refusé, crédit, délai, fournisseur non configuré) en
  **503** avec un message utilisateur explicite — jamais de succès silencieux.
- `OtpService` supprime le code créé si l'envoi échoue : pas de code fantôme, pas de cooldown
  imposé à l'utilisateur pour un SMS jamais parti (vérifié en base après un échec : 0 ligne).
- `validateEnv` refuse le démarrage si `SMS_PROVIDER=vonage|twilio` sans ses clés (message qui
  nomme les variables manquantes) ; `SMS_PROVIDER=mock` reste interdit en production.
- `/dev/last-otp/:phone` : **404** dès que `NODE_ENV=production` (quel que soit le fournisseur)
  ou que `SMS_PROVIDER≠mock` — observé dans les deux cas (§8.3).
- Test e2e `phase3 › SMS` : panne simulée (`SMS_MOCK_FAIL=true`) → 503, puis nouvel envoi
  possible immédiatement.

Reste à écrire, une fois les clés fournies : ~40 lignes d'appel `fetch` par fournisseur dans
`src/sms/sms.service.ts`, puis un test sur un vrai numéro.

### 8.2 Mise en ligne : ce qui a été fait

| Élément | État | Preuve |
|---|---|---|
| Migration PostgreSQL | **[exécuté]** générée et exécutée contre un vrai moteur Postgres (PGlite 0.5.8 = PostgreSQL 18.3 embarqué, protocole wire sur `127.0.0.1:5433` — pas une instance hébergée ; la CI utilise un vrai `postgres:16-alpine`) : `src/migrations/1789255931367-InitialPostgres.ts`, 23 tables, 45 colonnes `timestamptz`, `gen_random_uuid()` (`pgcrypto`) | `Migration InitialPostgres1789255931367 has been executed successfully` ; `migration:generate` relancé ensuite → `No changes in database schema were found` |
| Tests e2e sur Postgres | **[exécuté]** **54/54** avec `E2E_DB=postgres`, `DB_SYNCHRONIZE=false` (schéma issu uniquement de la migration) ; `createApp()` vide les tables de données entre suites | sortie Jest `Tests: 54 passed, 54 total` |
| Cycle réel sur Postgres | **[exécuté]** API compilée (`node dist/main.js`) sur :3002, base Postgres : inscription 200 → OTP → vérification 200 (access JWT + refresh 64 caractères) → `POST /listings` 201 (`en_ligne`) → `GET /listings?q=Peugeot` → `total=1` ; rotation du refresh, réutilisation → 401, famille révoquée → 401 ; en base : 21 users, 68 listings, 22 refresh_tokens | script `cycle.sh`, log API |
| `Dockerfile` | **[lecture + CI]** 3 étapes (build, deps `--omit=dev`, runtime `node:22-bookworm-slim`, utilisateur non-root, `HEALTHCHECK` sur `/health`, `CMD node dist/main.js`). Docker absent du poste : l'image est construite par le job CI « Image Docker de l'API » (résultat en §8.4) | `.dockerignore`, `ci.yml` |
| `next build` avec URL de prod | **[exécuté]** `NEXT_PUBLIC_API_URL=https://api.trocoin.fr` → succès ; 1 chunk contient `api.trocoin.fr`, **0** chunk contient `localhost:3000`. Premier essai en échec : les pages légales étaient pré-rendues au build contre l'API → passées en `dynamic = "force-dynamic"` | sortie `next build` |
| Démarrage en mode production | **[exécuté]** `NODE_ENV=production` + un fournisseur `mock` → démarrage **refusé** (3 erreurs nommées). Configuration valide (`JWT_SECRET` 48 octets aléatoires, `CORS_ORIGINS=https://www.trocoin.fr`, `TRUST_PROXY=true`, Postgres, `SMS_PROVIDER=vonage` + clés factices, `PAYMENT_PROVIDER=disabled`, `NOTIFICATION_PROVIDER=none`) → démarre, `GET /health` 200 `{"database":"postgres"}`, `GET /dev/last-otp/…` **404**, `OPTIONS` depuis une origine inconnue **403**, origine autorisée renvoyée dans `Access-Control-Allow-Origin`, en-têtes `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` présents, inscription → 503 explicite (fournisseur SMS non implémenté) | log API :3004, `curl` |
| Modes production sans prestataire | **[exécuté]** nouveaux modes `PAYMENT_PROVIDER=disabled` (`DisabledPaymentProvider` : 503 « Le paiement sécurisé n'est pas encore disponible… », y compris l'onboarding Stripe) et `NOTIFICATION_PROVIDER=none` (in-app seulement). Sans eux, la mise en ligne exigeait des clés Stripe et Firebase — le mock, lui, aurait fait croire à un paiement effectué | tests 54/54, démarrage prod ci-dessus |
| Hébergement | **[non testé]** aucun compte Neon/Render/Railway/Vercel, aucune CLI (`railway`, `render`, `vercel`, `docker`, `psql` absents ; seul `gh` est authentifié). Guide pas à pas de 15–20 min : `DEPLOIEMENT.md` (Neon + Render Docker + Vercel, variables exactes, vérification externe, sauvegardes, Redis) | — |
| `README.md` | mis à jour : « URL de production : non déployé à ce jour », tests 54, sessions, production | — |

### 8.3 Bugs réels révélés par PostgreSQL (invisibles sur SQLite)

Faire tourner la suite complète sur un vrai moteur Postgres a fait remonter cinq défauts
qui auraient cassé la production au premier déploiement :

1. **Casse des identifiants** : Postgres replie en minuscules les colonnes non citées ; les
   fragments SQL bruts (`u.accountType`, `p.listingId`, index partiel `externalRef IS NOT NULL`)
   sont désormais cités (`"accountType"`…).
2. **`uuid` contre `varchar`** : `users.id` est un `uuid` natif alors que les clés étrangères
   applicatives (`listings.userId`, `listing_photos.listingId`) sont des `varchar` →
   `operator does not exist: character varying = uuid` sur le filtre `seller_type`, et
   `invalid input syntax for type uuid` sur la recherche admin par téléphone (500). Corrigé par
   `CAST(… AS varchar)` (portable SQLite/Postgres).
3. **Fuseau horaire** : `@CreateDateColumn()` sans type produit `TIMESTAMP` sans fuseau ; le
   pilote `pg` le relit en heure locale (+2 h) → le cooldown OTP ne se déclenchait jamais et le
   brute-force devenait possible. Les 24 colonnes de date auto sont passées en `timestamptz`.
4. **Fusion de catégories** : `UPDATE` par entité incorrect sur Postgres → `.update(Listing)`
   explicite.
5. **Pool de connexions** : `Promise.all` de 11 requêtes dans `/admin/stats` saturait le
   serveur de test → option `DB_POOL_MAX` (recommandée à 5 sur les offres gratuites).

### 8.4 Durcissement P1

| Élément | État | Détail |
|---|---|---|
| Refresh tokens rotatifs + révocation | **[exécuté]** | Table `refresh_tokens` (hash SHA-256, `familyId`, `expiresAt`, `revokedAt`, `replacedById`, UA, IP). Access token **15 min** (`JWT_EXPIRES_IN`), refresh **30 jours** (`REFRESH_TOKEN_TTL_DAYS`). `POST /auth/refresh` : inconnu → 401 ; déjà consommé → **toute la famille révoquée** + 401 (vol détecté) ; expiré → 401 ; compte suspendu → 403. `POST /auth/logout` révoque la famille ; suspension admin et suppression de compte appellent `revokeAllSessions`. `GET/DELETE /auth/sessions`. Front : stockage access+refresh, rotation automatique sur 401 (vol unique), déconnexion serveur. 4 tests e2e dédiés. **Limite honnête** : un access token volé reste valable jusqu'à 15 min ; c'est le compromis choisi (pas de liste noire JWT). |
| CI GitHub Actions | **[exécuté]** | `.github/workflows/ci.yml`, 4 jobs à chaque push/PR : `api` (tsc, 54 tests SQLite, build, `npm audit --audit-level=high`), `api-postgres` (service `postgres:16-alpine`, `migration:run`, 54 tests `E2E_DB=postgres`), `frontend` (tsc, `next build` avec URL d'API de production, audit), `docker` (build de l'image, sans push). Résultat réel après le push : **premier run rouge** (34726287040 : Jest sur Node 22 ne sait pas charger `@nestjs/typeorm` en ESM → « Must use import to load ES Module ») ; correction Node 24 dans la CI et le `Dockerfile` ; **second run vert, 4/4 jobs** : https://github.com/ousbaali11/Trocoin/actions/runs/34726419130 — `api` 54/54 + audit 0 vulnérabilité, `api-postgres` migration exécutée sur `postgres:16-alpine` puis 54/54, `frontend` build OK + audit 0, `docker` image construite |
| Sentry | **[exécuté partiellement]** | `@sentry/nestjs` initialisé **uniquement si `SENTRY_DSN`** est défini (`src/monitoring/sentry.ts`, `sendDefaultPii:false`, corps de requête supprimé), `captureException` sur les 500 dans le filtre global. Sans DSN : log `Monitoring Sentry : désactivé`. **Aucune clé fournie → aucun évènement réel envoyé**. |
| Sauvegardes | **[documenté, non exécuté]** | `DEPLOIEMENT.md` §6 : PITR Neon, `pg_dump --format=custom` hebdomadaire, `pg_restore --clean --if-exists`, redémarrage sans rejeu des migrations. Non exécuté : pas de `pg_dump` sur le poste ni de base hébergée. Les photos (`/uploads`) ne sont pas couvertes. |
| Redis | **[non disponible, documenté]** | Aucun Redis. Rate limiting et cache restent en mémoire : corrects pour **une** instance, à brancher sur Upstash/Render Key Value avant tout passage à plusieurs instances (`DEPLOIEMENT.md` §8). Le cooldown OTP est en base et n'est pas concerné. |
| `GET /health` | **[exécuté]** | `{status, database, uptimeSeconds, version}` ; 503 si la base ne répond pas ; utilisé par le `HEALTHCHECK` Docker et Render. |

### 8.5 Vérifications exécutées (13 septembre 2026, phase 3)

- `npx tsc --noEmit` API et front : 0 erreur.
- `npm test` SQLite : **54/54** (5 suites) ; `E2E_DB=postgres … npm test` : **54/54** sur le
  schéma issu de la migration (`DB_SYNCHRONIZE=false`).
- `npm audit --audit-level=high` : 0 vulnérabilité (API et front).
- `npm run build` puis `node dist/main.js` (commande du `Dockerfile`) sur Postgres : cycle
  inscription → annonce → recherche → rotation/révocation de session (§8.2).
- Démarrage `NODE_ENV=production` : refus avec config faible, succès avec config valide,
  `/dev/last-otp` 404, CORS restreint, en-têtes de sécurité (§8.2).
- `next build` avec `NEXT_PUBLIC_API_URL=https://api.trocoin.fr` : succès, aucun `localhost`
  dans les bundles.
- Push GitHub `2219d86` puis `56b23e8` → CI GitHub Actions réellement exécutée : run https://github.com/ousbaali11/Trocoin/actions/runs/34726419130 **vert** (4 jobs, dont 54 tests sur un vrai PostgreSQL 16 et le build de l'image Docker).

### 8.6 Ce qu'il manque de votre côté (liste exacte)

1. **SMS** — un compte Vonage **ou** Twilio et ses clés : `VONAGE_API_KEY`, `VONAGE_API_SECRET`,
   `SMS_SENDER` ou `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. Sans elles, aucune
   inscription n'est possible en production (et je n'écris pas l'appel réseau sans pouvoir le tester).
2. **Base PostgreSQL hébergée** — une `DATABASE_URL` (Neon recommandé, gratuit, UE).
3. **Hébergeur API** — un compte Render (ou Railway) relié au dépôt GitHub.
4. **Hébergeur front** — un compte Vercel relié au dépôt (dossier `frontend`).
5. **Domaines** (facultatif pour tester) — sinon `*.onrender.com` / `*.vercel.app` ; à reporter
   dans `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`.
6. **Sentry** (facultatif) — `SENTRY_DSN`.
7. **Redis** (facultatif tant qu'il n'y a qu'une instance) — `REDIS_URL` + branchement du throttler.
8. **Stripe** (plus tard) — `STRIPE_SECRET_KEY` de test, sinon `PAYMENT_PROVIDER=disabled`.

Dès les points 1 à 4 fournis, le déploiement suit `DEPLOIEMENT.md` en 15–20 min, puis la
vérification externe §4 de ce guide (SMS reçu sur un vrai téléphone, annonce visible).

### 8.7 Ce qui reste avant l'ouverture publique (liste honnête)

**Bloquant**
- Appel réel Vonage/Twilio + test sur plusieurs vrais numéros (latence, échecs, coût).
- Déploiement effectif et test externe (jamais fait : aucun compte hébergeur).
- Stockage persistant des photos (disque Render payant ou S3/R2) : sur l'offre gratuite, les
  photos disparaissent à chaque déploiement.
- Redimensionnement / purge EXIF des images (`sharp`), toujours non implémenté (§6 P0-4).
- Textes légaux validés par un juriste (éditeur, hébergeur, médiateur).

**Avant montée en charge**
- Redis pour le rate limiting dès la 2ᵉ instance ; index full-text pour la recherche (§4).
- Sauvegarde automatisée hebdomadaire hors Neon (script `pg_dump` planifié) et test de
  restauration sur une base vide.
- Sentry réellement alimenté et alertes configurées ; APM/logs centralisés.
- Webhook Stripe signé et réconciliation (§6 P0-3) avant d'activer `PAYMENT_PROVIDER=stripe`.

**Non testé dans cet environnement**
- Exécution de l'image Docker (construite en CI seulement), TLS vers une base hébergée
  (`sslmode=require`), comportement derrière le proxy Render (`TRUST_PROXY=true`), envoi
  d'un évènement Sentry, `pg_dump`/`pg_restore`.

## 9. Mise en ligne réelle (13 septembre 2026, suite de la phase 3)

Le propriétaire a créé les comptes Neon, Render, Vercel et Vonage et transmis `DATABASE_URL`,
les clés Vonage et `CORS_ORIGINS`. Tout ce qui suit a été **observé réellement** depuis le poste
de développement, sauf mention contraire.

### 9.1 SMS Vonage : implémenté et validé

| Étape | Résultat |
|---|---|
| Implémentation | `src/sms/vonage-sms.provider.ts` : `POST https://rest.nexmo.com/sms/json` (form-encodé, numéro E.164 sans « + », `type=unicode` seulement hors GSM-7), délai 8 s via `AbortController`, chaque statut Vonage (1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 22, 29, 32, 33) traduit en `SmsDeliveryError` explicite ; sélectionné par `SMS_PROVIDER=vonage` dans `SmsService`. Twilio reste **non implémenté** (aucun identifiant). |
| Tests unitaires **[exécuté]** | `src/sms/vonage-sms.provider.spec.ts`, **10/10** avec un `fetch` simulé : requête conforme, statuts 4/9/29/3/inconnu, numéro non français refusé sans appel réseau, HTTP 401, erreur réseau, délai dépassé, construction sans identifiants refusée. Suite complète : **64/64** (6 suites). |
| Clés réelles **[exécuté]** | `GET rest.nexmo.com/account/get-balance` avec les clés fournies → `{"value":2.00,"autoReload":false}` : identifiants **valides**, solde **2,00 €** (≈ 25 SMS vers un mobile français). Aucun SMS envoyé à ce stade. |
| Point d'attention | Un compte Vonage d'essai ne délivre qu'aux numéros ajoutés dans *Dashboard → Test numbers* (statut 29 sinon, remonté en clair dans les logs Render et en 503 côté utilisateur). |

### 9.2 Infrastructure observée

| Brique | Observation **[exécuté]** |
|---|---|
| Neon (PostgreSQL 18.6, région **us-east-2**) | Connexion TLS OK ; **23 tables** ; table `migrations` = `InitialPostgres1789255931367` (exécutée par Render au premier démarrage) ; 0 utilisateur. Remarque : région États-Unis — pour des données de résidents français, recréer le projet en `eu-central-1` (Francfort) avant l'ouverture publique (`DEPLOIEMENT.md` §1). |
| Render — API `https://trocoin.onrender.com` | `GET /health` → `{"status":"ok","database":"postgres"}` ; `GET /dev/last-otp/…` → **404** ; `OPTIONS` avec `Origin: https://trocoin.vercel.app` → 204 + `access-control-allow-origin` correct ; origine inconnue → **403** ; `Strict-Transport-Security` présent ; `GET /categories/tree` → 12 familles seedées ; `GET /listings` → 0 annonce. Un redémarrage de l'instance a été observé après le push `e5b535f` (déploiement automatique), à confirmer dans *Render → Events*. |
| CI GitHub | Run https://github.com/ousbaali11/Trocoin/actions/runs/34735085223 **vert** (4/4 jobs, 64 tests SQLite, 64 tests PostgreSQL 16, front, Docker). |
| Vercel — front | Déploiements `Production` réussis (statuts GitHub « Vercel: success »), mais **le site n'est pas accessible publiquement** : `https://trocoin-devi-facto.vercel.app` redirige vers `vercel.com/sso-api` (**Deployment Protection / Vercel Authentication activée**), et `https://trocoin.vercel.app` (valeur de `CORS_ORIGINS`) répond `X-Vercel-Error: NOT_FOUND` (domaine non rattaché au projet). Un second projet `trocoin_alpha` existe (déploiement 410 Gone). |

### 9.3 Vérification externe (§4 de DEPLOIEMENT.md) — état

| Étape | État |
|---|---|
| 1. `/health` en production | **fait**, OK |
| 2. `/dev/last-otp` neutralisé | **fait**, 404 |
| 3. Inscription réelle avec SMS reçu, dépôt d'annonce, recherche | **en attente** : le numéro de téléphone n'a pas été transmis (« [votre numéro] » est resté un espace réservé) et le front Vercel est verrouillé par l'authentification Vercel. Aucun SMS n'a été envoyé : je n'utilise pas de numéro inventé. |
| 4. Déconnexion → accès refusé | en attente (dépend de 3) |
| 5. Compte administrateur | en attente du numéro ; exécutable depuis le poste avec `DATABASE_URL` Neon : `DB_TYPE=postgres DATABASE_URL=… node dist/admin/create-admin.js 06XXXXXXXX "Admin"` (aucune route HTTP ne permet de devenir admin). |

### 9.4 Actions restant à votre charge

1. **Vercel** : *Settings → Deployment Protection* → désactiver *Vercel Authentication* pour
   Production (sinon aucun testeur n'entre), puis *Settings → Domains* → ajouter
   `trocoin.vercel.app` (ou votre domaine). Vérifier que `NEXT_PUBLIC_API_URL=https://trocoin.onrender.com`
   est bien défini dans le projet Vercel, puis *Redeploy*.
2. **Render** : `CORS_ORIGINS` doit contenir l'URL réellement servie par Vercel (aujourd'hui
   `https://trocoin.vercel.app` ne sert rien).
3. **Vonage** : si le compte est encore en essai, ajouter votre numéro dans *Test numbers*.
4. Me transmettre **votre numéro de mobile** pour dérouler l'inscription réelle et créer l'admin.
5. **Sécurité** : les clés Vonage et le mot de passe Neon ont transité par cette conversation ;
   il est prudent de les régénérer (Vonage → *API settings*, Neon → *Reset password*) et de
   mettre à jour Render ensuite.

## Annexe — journal des vérifications exécutées le 12 septembre 2026

- `npm test` : 3 suites, **36/36**.
- `npm audit` : **0 vulnérabilité**.
- `npx tsc --noEmit` (API et front) : 0 erreur ; `next build` : 34 routes.
- `node test/ws-smoke.js` : 4/4 (token invalide rejeté, tiers refusé, message reçu en
  direct, évènement boîte de réception).
- `npm run create-admin` : compte admin créé et journalisé (`user.promote_admin`).
- Migration TypeORM : générée puis exécutée sur une base vierge.
- Navigateur (Next.js sur :3001, API sur :3000, données `test/seed-demo.js`) : 17 URL
  publiques en 200/404 attendus sans erreur console ; parcours complets décrits en §1 ;
  utilisateur non-admin redirigé depuis `/admin` ; actions admin retrouvées dans le journal
  d'audit avec IP et détail des champs modifiés.

- **13 septembre 2026 (phase 2)** : `npm test` **49/49** (4 suites) ; `npm audit` 0 ; `tsc` API + front 0 erreur ; `next build` 37 routes ; parcours navigateur décrits en §7.2 ; `GET /settings/public` → `monetizationEnabled: false` en fin de session.
