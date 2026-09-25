# Audit complet n° 2 — septembre 2026 (AUDIT §73)

Second passage complet après le grand audit du §63 : PayPal (option non retenue, prestataire simulé), changement
d'environnement Stripe (clés, deux webhooks, comptes de versement orphelins, clé d'idempotence), réversibilité
particulier / professionnel, catalogue de démonstration (600 annonces, pas encore créées en production). Méthode : rien n'est
tenu pour acquis ; chaque point est classé **conforme**, **corrigé** (avec la version) ou **à signaler** (décision du
propriétaire, ou limite assumée et documentée). Les preuves (tests, captures, extraits) sont dans `AUDIT.md` §73.

Livraisons : **1** — séquelles Stripe, catalogue de démonstration, secrets, points laissés de côté (ce document, partie A à C
et E) ; **2** — inventaire des routes et autorisations ; **3** — argent et litiges ; **4** — passage page par page dans le
navigateur (bureau et mobile, connecté ou non, particulier / pro / admin).

## A. Séquelles du changement d'environnement Stripe

Inventaire exhaustif de ce qui garde un identifiant du prestataire en base (aucune table ne mémorisait l'environnement de
création) :

| Donnée | Où | Appels ultérieurs au prestataire | Verdict |
|---|---|---|---|
| `transactions.providerPaymentId` (`cs_…` puis `pi_…`) | ventes | relecture de la page de paiement, capture, remboursement, inspection, virement | **corrigé** : page de paiement inconnue → signalée (avant : annulée « paiement non finalisé » en silence) ; paiement inconnu → déjà signalé (§65) ; **balayage des ventes ouvertes au changement d'environnement** (nouveau) |
| `transactions.transferId` (`tr_…`) | ventes confirmées | annulation du virement lors d'un remboursement après versement | **corrigé** : échec d'annulation → administration prévenue « virement à récupérer à la main » (avant : une ligne de journal) ; l'acheteur est remboursé quand même (déjà le cas) |
| `users.stripeAccountId` (`acct_…`) | comptes de versement | lien de configuration, lecture d'état, virement (destination), suppression | **conforme** : remise à zéro des orphelins et balayage nocturne (§67), rejoué 20 s après chaque démarrage |
| clés d'idempotence des virements | jamais en base (calculées) | création de virement | **conforme** (§70 : clé liée aux paramètres, conflit résolu une fois) |
| `shipments.providerRef` (Boxtal) | bons d'envoi | suivi, annulation | **à signaler** : Boxtal est encore en bac à sable ; au passage en production, les bons d'envoi de test en cours perdront leur suivi (le suivi indisponible n'est jamais présumé : la vente attend l'administration) — même mécanisme d'empreinte à prévoir le jour du passage |
| identifiants d'évènements webhook | jamais en base | — | **à signaler** : pas de table de déduplication ; les traitements sont idempotents (état relu avant chaque effet), un évènement rejoué ne fait rien deux fois |
| `subscriptions.providerRef` | abonnements | aucun (jamais écrit ni lu) | conforme (colonne réservée) |
| PayPal | rien en base (prestataire simulé, option non retenue) | aucun appel réseau | conforme |

**Nouveau garde-fou (1.44.0)** : l'API mémorise l'**empreinte de l'environnement** du prestataire (compte plateforme + mode
test/réel) ; à chaque démarrage, si elle a changé, toutes les ventes ouvertes sont vérifiées d'un coup chez le prestataire,
celles qu'il ne connaît plus sont signalées « paiement inconnu » (plus de nouvel essai automatique, décision dans la console,
« annuler » possible même sur une page de paiement en attente), les administrateurs sont prévenus, et `/health` expose
`paymentEnvironment` (4 derniers caractères du compte, mode, date du changement, résultat du balayage). Test `phase44`.

## B. Catalogue de démonstration : vérifications avant activation

| Point | Verdict |
|---|---|
| Comptes non distinguables publiquement (aucune mention « démo » sur la fiche, le profil, la recherche, les avis ; `isDemoAccount` absent de toute réponse publique) | **conforme** (test `phase43`, fiche relue). Seule exception, voulue (§71) : la **réponse automatique** reçue par celui qui écrit dit que l'annonce est gérée par l'équipe — honnêteté choisie plutôt que faux vendeur |
| Identifiables côté admin | **conforme** : case « Compte de démonstration » sur la fiche membre, page console dédiée, conversations listées |
| Aucun paiement en ligne (devis `eligible: false`, achat 400, plus de bouton « Acheter » sur la fiche ni dans le fil) | **conforme** (tests `phase43`, captures §71) |
| Numéro jamais exposé (`phonePublic: false` réaffirmé à chaque passage, « Voir le numéro » → 404) | **conforme** |
| Double clic sur « Créer le catalogue » | **conforme** : 409 « exécution déjà en cours » pendant l'exécution ; ensuite reprise idempotente (comptes par e-mail, annonces par référence `demo:<clé>`, photos manquantes seulement) — 0 doublon au second passage (test `phase43`) |
| Identifiants perdus si l'API s'endort ou redémarre avant « Récupérer les identifiants » (ils ne vivent qu'en mémoire) | **corrigé (1.44.0)** : bouton « Régénérer les mots de passe » (nouveaux mots de passe pour tous les comptes démo, remis une fois, journalisés) |
| Limites de débit sur les écritures d'administration du catalogue | **corrigé (1.44.0)** : 10 lancements / 10 min, 3 régénérations / 10 min |

## C. Secrets (clé Pexels, clés Stripe, secrets de webhook)

| Point | Verdict |
|---|---|
| Aucune valeur réelle dans le dépôt ni dans l'historique git (recherche des motifs `sk_live_`, `sk_test_`, `rk_`, `whsec_`, `npg_`, `re_`, URL Postgres avec mot de passe, valeur exacte de la clé Pexels) | **conforme** : seuls des exemples (`.env.example`, `DEPLOIEMENT.md`) et des valeurs fictives de tests |
| `private/` et `.env` ignorés ; `photos.json` ne contient que des URL publiques et des métadonnées | **conforme** ; **corrigé** : `.gitignore` couvre désormais `.env.*` (sauf `.env.example`) et tout `data/` |
| Réponses API : jamais de clé ni de secret (`/health` n'expose que la présence et le format des secrets, les identifiants abrégés) | **conforme** |
| Journaux : erreurs du prestataire sans en-tête ni clé ; Sentry ne recevait pas le corps des requêtes mais pouvait recevoir les **en-têtes** (jeton de session) | **corrigé (1.44.0)** : en-têtes, cookies et chaîne de requête retirés avant envoi |
| Diagnostic Boxtal (`GET /shipping/diagnostic`, bac à sable seulement) accessible sans compte : longueur des clés, commande de test | **corrigé (1.44.0)** : réservé aux administrateurs |
| Front : seules `NEXT_PUBLIC_API_URL` et `NEXT_PUBLIC_SITE_URL` | **conforme** |

## D. Routes et autorisations, argent et litiges, passage page par page

Livraisons 2 à 4 (sections complétées au fil des tours).

## E. Ce qui a été volontairement laissé de côté (toujours identifié, jamais oublié)

| Point | Où c'est documenté | Verdict |
|---|---|---|
| Vérification SMS du numéro à l'inscription (compte créé avec `phoneVerified = false`) | `README.md` (« Aucun SMS à l'inscription »), `AUDIT.md` §11 et §63 (« reportée par le propriétaire ») | **à signaler** — décision du propriétaire, toujours ouverte |
| Relecture juridique des CGU / CGV / mentions légales | `docs/audit-bugs.md` (« relecture par un juriste avant ouverture publique ») | **à signaler** — à faire avant l'ouverture publique |
| Clés Stripe réelles (mode test), KYC, DAC7 | `DEPLOIEMENT.md` §5 (« `sk_test_…` pour le mode test, `sk_live_…` ensuite »), `AUDIT.md` §§59–61 | **à signaler** — bascule à prévoir avec l'empreinte d'environnement (partie A) : les ventes de test en cours seront signalées, pas perdues |
| Clés Boxtal réelles (bac à sable actuel) | `docs/etiquettes-transporteur.md` §7 | **à signaler** — même remarque pour les bons d'envoi en cours |
| PayPal Commerce Platform (multiparty) | `docs/paypal-integration.md` (« Décision prise : option 0 », option A « reste possible ») | **à signaler** — non retenu, prestataire simulé jamais activé en production |
| Badge « Réactif » | `AUDIT.md` §§ précédents | **à signaler** — différé |
