# AUDIT.md — Trocoin (audit final, 12 septembre 2026 · phase 2, 13 septembre 2026)

Chaque affirmation de ce document est étiquetée :
**[exécuté]** = vérifié par exécution réelle (tests e2e `npm test` 49/49 après la phase 2, appels HTTP,
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
