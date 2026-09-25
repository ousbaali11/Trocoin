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
| identifiants d'évènements webhook | table `webhook_events` (depuis 1.47.0) | réclamés avant traitement, libérés en cas d'échec, purgés à 30 jours | **corrigé (1.47.0, §74)** : un évènement livré plusieurs fois n'est traité qu'une fois (200 « deja_traite »), compteur dans `/health` |
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

## D. Routes et autorisations (livraison 2)

Inventaire réel : 23 contrôleurs, 131 routes (API), 49 pages (front). Chaque route prenant un identifiant a été relue
jusqu'au contrôle de propriété dans le service (conversations, ventes, expéditions, avis, annonces et boutiques, favoris,
notifications, recherches, blocages, abonnements) : **aucun moyen de lire ou de modifier les données d'un autre membre**
n'a été trouvé, y compris sur les routes récentes (`become-individual` / `become-pro`, catalogue de démonstration, comptes
orphelins — ces derniers n'ont d'ailleurs aucune route : balayage interne, résultat dans `/health`).

| Point | Verdict |
|---|---|
| Propriété et participation vérifiées avant toute lecture privée ou écriture (messages, ventes, étiquettes, avis, annonces, favoris, notifications, recherches, blocages, abonnements) | **conforme** |
| Acheteur / vendeur : confirmer la réception et abandonner = acheteur seul ; expédier, confirmer la disponibilité, code de remise, étiquettes = vendeur seul ; annuler et litige = les deux (litige après capture : acheteur seul) | **conforme** |
| Téléphone / e-mail de l'autre partie jamais renvoyés (résumé public, fiche de vente, vue acheteur de l'expédition) ; adresse de l'acheteur au vendeur seulement après paiement | **conforme** ; **corrigé (1.45.0)** : plus d'adresse au vendeur une fois la vente annulée ou remboursée |
| Compte suspendu : ses annonces sont mises en pause et ses sessions révoquées, mais un **membre de sa boutique** pouvait les remettre en ligne (statut, renouvellement, import), déposer en son nom, et un administrateur pouvait approuver une annonce en vérification ; les acheteurs pouvaient alors payer un vendeur suspendu | **corrigé (1.45.0)** : `canActFor` refuse un propriétaire suspendu ou supprimé ; toute mise en ligne (vendeur, membre, renouvellement, import, approbation admin) vérifie le compte ; le devis et l'achat refusent un vendeur suspendu ou supprimé ; les sockets temps réel d'un compte suspendu sont fermés |
| Compte effacé : ses appartenances de boutique (comme propriétaire ou membre) restaient en base | **corrigé (1.45.0)** |
| Double clic sur « Générer le bon d'envoi » : deux étiquettes achetées chez le transporteur | **corrigé (1.45.0)** : une création à la fois par vente (verrou), 409 pour la seconde |
| Deux avis simultanés sur la même vente par le même membre, note recalculée par lecture-écriture | **corrigé (1.45.0)** : index unique en base (migration), note et nombre recalculés par agrégat |
| Formules payantes : monétisation activée sans prestataire de facturation → activées gratuitement (`charged` affiché, rien prélevé) | **corrigé (1.45.0)** : refusées (503) tant que le prélèvement n'est pas branché ; formule gratuite inchangée |
| Image envoyée dans une conversation par un membre bloqué : fichier conservé avant le refus | **corrigé (1.45.0)** : droit d'écrire vérifié avant de conserver le fichier |
| Détail d'une conversation : « l'autre a effacé la conversation » (dates de masquage) renvoyé au membre | **corrigé (1.45.0)** |
| Cotation d'envoi sur une annonce non en ligne (brouillon, vendue, archivée) par quiconque connaît l'identifiant | **corrigé (1.44.0)** |
| Bascule particulier / professionnel sans limite propre (registre des entreprises appelé) | **corrigé (1.44.0)** : 5 / h |
| Pages du front : garde côté client (`RequireAuth`) + contrôle réel par l'API ; `/compte/boutique` ouvrable par un non-pro (contenu adapté) ; aucun lien mort dans les quatre menus | **conforme** |
| Images de conversation servies sans connexion (noms imprévisibles) ; pas de table de déduplication des webhooks | **corrigé (1.47.0, §74)** : images réservées aux participants et à l'administration (stockage privé, route contrôlée, identité vérifiée à chaque requête) ; évènements webhook dédupliqués |

## D bis. Argent et litiges (livraison 3)

| Point | Verdict |
|---|---|
| Barème : commission vendeur et frais acheteur (plafonnés) figés sur la vente au paiement, jamais recalculés avec le barème du jour ; versement = prix − commission | **conforme** (tests `phase29`, régression verte) |
| Séquestre « platform » : capture sur le solde de Trocoin avant l'échéance courte, virement au vendeur après confirmation ou réception présumée, réservation atomique du virement, clé d'idempotence liée aux paramètres, virement existant réutilisé | **conforme** (§69, §70, tests `phase41`, `phase42`) |
| PayPal (via Stripe) : autorisation de 10 jours (+ 10 automatiques) selon la documentation Stripe ; le code capture avant 5 jours (valeur par défaut quand le prestataire ne donne pas de date de capture) | **conforme** — capture toujours avant l'expiration ; PayPal Commerce Platform en direct non retenu (prestataire simulé, jamais activé) |
| Changement d'environnement : paiements, virements et comptes de versement d'un autre environnement signalés, jamais perdus en silence | **corrigé (1.44.0)**, partie A |
| Décisions admin : rembourser / libérer / annuler prises de façon atomique avant tout mouvement d'argent ; « annuler » possible sur un paiement ou une page de paiement inconnus du prestataire ; remboursement forcé quand l'admin supprime un compte avec des ventes sous séquestre ; suppression bloquée si une vente est expédiée ou en litige (suspension réversible possible) | **conforme** |
| Suspension : ventes en cours conservées (l'autre partie n'est pas lésée), aucune nouvelle vente possible (corrigé ci-dessus) | **conforme** après 1.45.0 |

## D ter. Passage page par page (livraison 4)

Méthode du §63 rejouée sur la pile locale reconstruite (API et front à jour, base réensemencée) : les 49 pages du front
visitées en bureau (1280 px) et sur mobile (375 px), en visiteur, en membre et en administrateur — 116 visites — avec
relevé du statut HTTP, des erreurs console, des requêtes en échec (hors 401 attendus), du défilement horizontal, et
vérification de chaque lien interne rencontré (149 liens distincts).

| Point | Verdict |
|---|---|
| Statuts : 112 pages en 200, 4 en 404 attendus (page inventée, annonce inexistante) ; espace membre et console redirigés vers la connexion (`?next=`) pour un visiteur ; `/admin` renvoyé à l'accueil pour un membre | **conforme** |
| Erreurs console et requêtes en échec : aucune (hors le 404 de la page elle-même sur les pages inexistantes) | **conforme** |
| Liens morts : 0 sur 149 liens internes (en-tête, pied de page, menus compte et console, contenu des pages) | **conforme** |
| Défilement horizontal sur mobile : 1 page — `/confirmer-email` sans jeton, bouton « Se connecter pour recevoir un nouveau lien » trop long à 375 px | **corrigé (1.46.0)** : libellé « Me connecter » (largeur 375 px vérifiée après reconstruction) |
| Formulaires « qui acceptent n'importe quoi » : 18 entrées aberrantes envoyées à l'API (téléphone étranger, mot de passe court, type de compte inventé, champs injectés `isDemoAccount` / `userId` / `status`, prix négatif ou 10⁹, titre de 5 000 caractères, catégorie inconnue, balise script, message de 10 000 caractères, note 9, identifiant non UUID, pagination 100 000, tri injecté, JSON invalide, corps de 3 Mo) | **conforme** : tout est refusé en 400 avec un message clair ou ignoré (champs inconnus retirés, jamais appliqués : le propriétaire, le statut et le drapeau démo restent ceux du serveur ; la balise script est stockée comme du texte et échappée à l'affichage, y compris dans les données structurées) ; **corrigé (1.46.0)** : un corps de 3 Mo produisait « Erreur interne » (500) → 413 « Corps de requête trop volumineux » |

## E. Ce qui a été volontairement laissé de côté (toujours identifié, jamais oublié)

| Point | Où c'est documenté | Verdict |
|---|---|---|
| Vérification SMS du numéro à l'inscription (compte créé avec `phoneVerified = false`) | `README.md` (« Aucun SMS à l'inscription »), `AUDIT.md` §11 et §63 (« reportée par le propriétaire ») | **à signaler** — décision du propriétaire, toujours ouverte |
| Relecture juridique des CGU / CGV / mentions légales | `docs/audit-bugs.md` (« relecture par un juriste avant ouverture publique ») | **à signaler** — à faire avant l'ouverture publique |
| Clés Stripe réelles (mode test), KYC, DAC7 | `DEPLOIEMENT.md` §5 (« `sk_test_…` pour le mode test, `sk_live_…` ensuite »), `AUDIT.md` §§59–61 | **à signaler** — bascule à prévoir avec l'empreinte d'environnement (partie A) : les ventes de test en cours seront signalées, pas perdues |
| Clés Boxtal réelles (bac à sable actuel) | `docs/etiquettes-transporteur.md` §7 | **à signaler** — même remarque pour les bons d'envoi en cours |
| PayPal Commerce Platform (multiparty) | `docs/paypal-integration.md` (« Décision prise : option 0 », option A « reste possible ») | **à signaler** — non retenu, prestataire simulé jamais activé en production |
| Badge « Réactif » | `AUDIT.md` §§ précédents | **à signaler** — différé |
