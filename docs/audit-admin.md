# Audit du panneau d'administration — 16 septembre 2026

## Étape 1 — Inventaire et test réel (état avant modification)

Méthode : chaque route et chaque écran de la console ont été **exercés sur la pile locale**
(API compilée, fournisseurs simulés, base SQLite jetable) par un script qui joue l'action admin puis
vérifie **l'effet réel du côté du membre concerné** (connexion, annonce publique, profil, notification,
journal). Les captures « avant » de chaque page sont dans le dossier de preuves du tour (AUDIT §38).
Résultat brut : **29 fonctions vérifiées OK sur 32, 3 absentes** (aucune fonction « à moitié
fonctionnelle » sans effet réel n'a été trouvée).

### 1.1 Fonctions existantes, page par page

| Page | Fonction | Testé | Résultat |
|---|---|---|---|
| Tableau de bord | compteurs comptes / annonces / transactions / signalements, actions en attente, séquestres à échéance | oui | OK |
| Utilisateurs (liste) | recherche par téléphone, pseudo, e-mail, SIRET, boutique ; filtres type et statut ; pagination | oui | OK |
| Utilisateur (fiche) | identité, SIRET, annonces, transactions, signalements reçus / émis, avis | oui | OK |
| Utilisateur (fiche) | **suspendre** avec motif → connexion refusée (403), sessions révoquées, annonces mises en pause, notification | oui | OK |
| Utilisateur (fiche) | **réactiver** → connexion possible, notification | oui | OK, mais les annonces restent « en pause » (le membre doit les remettre en ligne lui-même) — comportement à documenter dans l'interface |
| Utilisateur (fiche) | mot de passe temporaire → ancien refusé, temporaire accepté, sessions déconnectées | oui | OK |
| Utilisateur (fiche) | modifier pseudo, ville, type de compte, boutique, SIRET, identité vérifiée → profil public à jour | oui | OK |
| Utilisateur (fiche) | garde-fou : ne pas se suspendre ni se rétrograder soi-même | oui | OK |
| Annonces (liste) | filtres statut / catégorie / recherche, annonces signalées, pagination | oui | OK |
| Annonce (fiche) | approuver → visible publiquement, propriétaire notifié | oui | OK |
| Annonce (fiche) | refuser avec motif → retirée du public, motif visible par le propriétaire | oui | OK |
| Annonce (fiche) | mettre en pause | oui | OK |
| Annonce (fiche) | corriger titre / description | oui | OK |
| Annonce (fiche) | supprimer : effacée si aucune transaction, sinon mise en pause | oui | OK (voir 1.3 : confirmation trop faible) |
| Signalements | file ouverte, traiter (aucune action / retirer / suspendre / retirer et suspendre), rejeter ; un signalement clos ne se retraite pas | oui | OK |
| Transactions et litiges | liste par statut (sans code de remise), séquestres à échéance | oui | OK |
| Transactions et litiges | trancher un **litige** : rembourser / libérer, note transmise | oui | OK |
| Monétisation et formules | interrupteur global, quota gratuit, prix boost / urgent → `/settings/public` et quota appliqués | oui | OK |
| Monétisation et formules | formules pro (prix, annonces incluses, options) → `/plans` public | oui | OK |
| Pages légales (CMS) | édition, aperçu, publication → page publique à jour | oui | OK |
| Journal d'audit | une entrée par action (admin, action, cible, détails, IP, date) ; filtres par type / cible | oui | OK |
| Accès | `/admin/*` refusé sans jeton (401) et à un membre (403) ; `X-Robots-Tag: noindex` | oui | OK |

### 1.2 Fonctions absentes ou insuffisantes (constatées par le test)

| # | Manque | Constat |
|---|---|---|
| 1 | **Suppression définitive d'un compte par l'admin** | aucune route (`DELETE /admin/users/:id` → 404) ; seule l'auto-suppression RGPD existe (`DELETE /users/me`), refusée si une transaction est en cours |
| 2 | **Suppression d'une annonce : confirmation faible** | un clic + boîte de confirmation générique, motif facultatif ; pas de saisie explicite ; le journal enregistre bien l'action |
| 3 | **Transactions hors litige** | l'admin ne peut agir que sur un statut « litige » (`400 Cette transaction n'est pas en litige`) : impossible de forcer un remboursement, une capture ou une annulation sur une vente en séquestre / expédiée (fraude avérée, vendeur disparu) |
| 4 | **Fiche détaillée d'une transaction** | pas de route `GET /admin/transactions/:id` ni de page : adresse de livraison, expédition (étiquette, suivi), historique et journal ne sont visibles qu'en partie dans la liste |
| 5 | **Suspension vs suppression** | la suspension existe (réversible) ; la distinction avec une suppression définitive n'est pas offerte à l'admin |

Observation hors panneau, relevée pendant le test : une annonce titrée « iPhone … pas cher urgent
whatsapp » est passée **en ligne** sans pré-modération (la liste de mots surveillés ne contient ni
« whatsapp » ni « urgent ») — à traiter dans un tour dédié à la modération automatique.

### 1.3 Navigation et organisation

- Menu à plat de 8 entrées sans regroupement : « Utilisateurs » arrive après « Transactions et
  litiges », « Monétisation et formules » et « Pages légales (CMS) » (configuration) sont mêlées aux
  files de travail.
- Les compteurs (annonces à vérifier, signalements, litiges) sont bien sur les entrées concernées,
  mais le compteur « séquestres à échéance » n'est que sur le tableau de bord.
- Doublons fonctionnels : suspension possible depuis la fiche utilisateur **et** depuis un signalement
  (« retirer et suspendre ») — cohérent (même service, même journal), à garder.
- Absents du menu : rien ; toutes les pages sont accessibles. La fiche utilisateur ne propose pas de
  lien direct vers ses transactions filtrées ; la liste des transactions ne mène pas à une fiche.
- Libellés : « Transactions et litiges » (URL `/admin/litiges`) et « Monétisation et formules »
  (URL `/admin/reglages`) sont clairs mais l'URL ne suit pas ; le bandeau rouge « toutes les actions
  sont journalisées » est bien visible.
- Design : le back-office garde volontairement un thème distinct (ardoise / indigo, monospace pour
  les identifiants — `docs/design-system.md` §9), boutons et pilules cohérents avec le site.

## Étape 2 — livré (16 septembre 2026)

| Droit | Où | Garde-fous | Journal |
|---|---|---|---|
| **Suppression définitive d'un compte** (particulier ou pro) | fiche utilisateur → « Suppression définitive » ; `DELETE /admin/users/:id` | motif ≥ 5 caractères + saisie du mot **SUPPRIMER** (dialogue dédié, bouton inactif tant que les deux ne sont pas fournis) ; refusé pour soi-même et pour un administrateur non rétrogradé ; les transactions en cours sont d'abord **annulées et remboursées** (l'acheteur ou le vendeur restant n'est jamais bloqué), annonces retirées, sessions révoquées, données personnelles effacées (numéro réutilisable) — même routine que l'auto-suppression RGPD | `user.delete` (admin, cible, motif, type de compte, transactions remboursées) + une entrée `transaction.force_refund` par transaction |
| **Suppression définitive d'une annonce** | fiche annonce → « Supprimer définitivement » ; `DELETE /admin/listings/:id` | motif + **SUPPRIMER** obligatoires (le paramètre d'URL d'avant ne suffit plus) ; annonce liée à une transaction : seulement mise en pause (conservée pour la vente) ; propriétaire notifié avec le motif | `listing.delete` (motif, `hardDeleted`, `keptForTransactions`) |
| **Décisions sur toute transaction ouverte** (séquestre, expédiée, litige) : rembourser, libérer, annuler | fiche détaillée `/admin/litiges/:id` ; `POST /admin/transactions/:id/resolve` | note ≥ 5 caractères transmise aux deux parties ; « annuler » impossible après capture ; remboursement encore possible sur une transaction capturée automatiquement tant que sa fenêtre de litige est ouverte ; boîte de confirmation | `transaction.resolve` (litige) ou `transaction.force_refund` / `transaction.force_capture` / `transaction.cancel` (hors litige), avec statuts avant / après |
| **Fiche détaillée d'une transaction** | `/admin/litiges/:id` (lien « Fiche détaillée » dans la liste) ; `GET /admin/transactions/:id` | parties (téléphone, e-mail, note, suspendu / supprimé), annonce, remise et adresse de livraison, étiquette et suivi, chronologie et échéances du séquestre, journal lié ; le code de remise n'est jamais renvoyé | — |
| **Suspension (réversible)** | fiche utilisateur (existait) ; liens « acheteur / vendeur » depuis la fiche transaction | inchangée : connexion refusée, sessions révoquées, annonces en pause, motif transmis, réactivation possible | `user.update` |
| **Journal consultable** | `/admin/journal` (existait) ; filtre `?target=` pré-rempli depuis les fiches ; journal lié affiché sur la fiche transaction | — | toutes les actions sensibles ci-dessus |

Suspension **vs** suppression, tel qu'implémenté : la suspension bloque l'accès et masque les annonces
mais conserve tout (réversible) ; la suppression efface les données personnelles, libère le numéro et
ne se défait pas. Le choix de rembourser d'office les transactions en cours lors d'une suppression
(plutôt que de la refuser tant qu'une vente est ouverte, comme pour l'auto-suppression) est un
compromis : il évite qu'un compte frauduleux reste vivant à cause d'une vente en cours ; à confirmer.

## Étape 3 — réorganisation

Menu regroupé par domaine (`AdminShell`) : **Vue d'ensemble** (tableau de bord) · **Comptes**
(utilisateurs) · **Annonces** (annonces, signalements) · **Transactions** (transactions et litiges,
compteur = litiges + séquestres à échéance) · **Configuration** (monétisation et formules, pages
légales) · **Traçabilité** (journal d'audit). Pages, URL et thème inchangés (`docs/design-system.md`
§9 : le back-office reste volontairement distinct du site public) ; les nouvelles boîtes de dialogue
reprennent le composant `Modal` du site (focus confiné, Échap). Vérifié par `e2e/21-admin-droits.spec.ts`.

## Vérification après livraison (même méthode qu'à l'étape 1)

Le script de l'étape 1, complété des nouveaux droits, rejoué sur une pile locale neuve : **34 fonctions
OK sur 34** (les 3 absences de l'étape 1 sont comblées et testées avec leurs refus : sans le mot
SUPPRIMER, sans motif, sur soi-même, sur un administrateur). Extrait des lignes ajoutées :

| Zone | Fonction testée | Résultat | Constat |
|---|---|---|---|
| Annonces | Supprimer sans le mot SUPPRIMER (ou sans motif) → refusé 400 | **OK** | 400 |
| Annonces | Supprimer une annonce sans transaction → supprimée réellement (404 admin et public) | **OK** | admin 404 |
| Annonces | Supprimer une annonce liée à une transaction → seulement mise en pause (jamais effacée) | **OK** | statut desactivee, hardDeleted false |
| Transactions | Rembourser (forcer) une transaction en séquestre qui n'est PAS en litige → remboursée, journal « transaction.force_refund » | **OK** | statut rembourse |
| Transactions | Annuler une vente en séquestre (hors litige) → annulée, note transmise | **OK** | statut annulee |
| Transactions | Fiche détaillée (parties, annonce, livraison, expédition, journal lié, décisions possibles, sans code de remise) | **OK** | journal lié : transaction.resolve |
| Journal | Chaque action admin laisse une trace | **OK** | listing.delete, report.resolve, user.update, transaction.force_refund, transaction.cancel, transaction.resolve, settings.update, plan.update, page.update, user.reset_password, listing.update, user.delete |
| Utilisateurs | Suppression définitive d'un compte : refusée sans SUPPRIMER (400) et pour soi-même (400) ; effective → connexion refusée (401), profil 404, transaction ouverte remboursée, journal « user.delete » avec motif | **OK** | suppression 200, refundedTransactions = 1 |

Tests automatisés associés : `test/phase23.e2e-spec.ts` (3 tests API : suppression de compte avec
garde-fous et remboursements, suppression d'annonce avec corps obligatoire, décisions hors litige et
fiche détaillée) et `e2e/21-admin-droits.spec.ts` (3 scénarios navigateur : menu regroupé, dialogue
de suppression d'annonce, fiche transaction + suppression de compte + journal). Captures « après »
dans le dossier de preuves du tour (AUDIT §38).

## Verrous anti-fraude après publication et pouvoirs de l'admin (17 septembre 2026, AUDIT §54)

**Pourquoi.** Sans verrou, un vendeur peut publier une annonce crédible, accumuler vues, favoris et
confiance, puis la transformer discrètement en autre chose : changer de catégorie, de marque, ou remplacer
les photos. L'acheteur qui avait mis l'annonce en favori, ou qui arrive par un lien partagé, est trompé.

**Ce qui est verrouillé pour le vendeur**, dès que l'annonce a été publiée (ou soumise à la vérification) :

| Élément | Règle | Réponse de l'API |
|---|---|---|
| Catégorie et sous-catégorie | non modifiables | `PATCH /listings/:id` avec une autre `categorySlug` → 400 (la même valeur est acceptée) |
| Marque (attribut `marque`, quand la catégorie en a un et qu'il est renseigné) | non modifiable, ni retirable | `PATCH` avec une autre marque ou sans marque → 400 ; les autres critères restent modifiables |
| Photos présentes à la publication | ni retirables, ni remplaçables, ni déplaçables ; elles restent en tête, la couverture ne change pas | `DELETE /listings/:id/photos/:photoId` → 400 ; `PATCH …/photos/order` qui les déplace → 400 |
| Photos ajoutées ensuite | permises (dans la limite de 10), toujours après les photos verrouillées, retirables et déplaçables entre elles ; elles sont verrouillées à leur tour à la prochaine remise en ligne | `POST /listings/:id/photos` → 201, `lockedAt: null` |

Le dépôt crée un brouillon, envoie les photos, puis publie : les photos présentes à la publication sont
verrouillées à cet instant (`listing_photos.lockedAt`). Pour les clients qui publient d'abord puis envoient
les photos, celles reçues dans les 10 minutes suivant la publication (`PUBLICATION_PHOTO_WINDOW_MINUTES`)
font partie de la publication. Un brouillon reste entièrement modifiable. Dupliquer une annonce repart d'un
brouillon sans vues ni favoris : sa catégorie est libre, ce qui ne pose pas le même risque.

Le formulaire de modification montre ces champs **grisés avec leur explication** (catégorie, marque, tuiles
« 🔒 Verrouillée » sans boutons) ; la fiche expose `locks` et chaque photo son `lockedAt`.

**Ce que l'admin garde.** Le verrou ne vise que le vendeur. L'admin peut toujours modifier le titre, la
description, la ville et le statut, mettre en pause, refuser, **supprimer l'annonce** (`DELETE
/admin/listings/:id`), et il gagne le **retrait d'une photo**, y compris verrouillée :
`DELETE /admin/listings/:id/photos/:photoId` avec un motif obligatoire (bouton « Retirer la photo n » sur la
fiche admin de l'annonce). C'est le recours quand une photo publiée montre une plaque, un visage ou une
adresse, ou qu'elle est signalée. L'action est inscrite au journal (`listing.photo.delete`, avec
`wasLocked` et le motif) et le vendeur est prévenu.

**Annonces sans expiration.** Il n'y a plus de durée de vie (60 jours auparavant) : la tâche horaire
`expireListings` est retirée, `expiresAt` n'est plus renseigné, la migration
`1789540000000-AnnoncesSansExpirationEtVerrous` efface les anciennes dates et remet en ligne les annonces que
la seule limite de temps avait fait expirer. Le statut `expiree` ne subsiste que dans le type, pour
d'éventuelles anciennes lignes ; l'option a disparu du filtre des annonces de la console. À la réactivation
d'un compte suspendu, toutes les annonces mises en pause par la suspension reviennent en ligne.

Tests : `test/phase31.e2e-spec.ts` (4 tests : aucune expiration ; brouillon libre puis verrou à la
publication ; refus de changement de catégorie, de marque, de retrait et de déplacement d'une photo
verrouillée, ajout permis ; pouvoirs de l'admin et journal) et `e2e/04-depot.spec.ts` (champs grisés dans le
formulaire, photo ajoutée retirable).

