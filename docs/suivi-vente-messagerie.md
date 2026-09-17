# Suivi de la vente dans la messagerie (AUDIT §57)

## Ce que voit chacun

Dès qu'un achat est payé, la conversation de l'annonce entre l'acheteur et le vendeur porte le suivi de la vente.
Elle est **créée d'office** si les deux ne s'étaient jamais écrit, et redevient visible si l'un l'avait supprimée.

| Étape | Déclencheur (route existante) | Message automatique — acheteur | Message automatique — vendeur |
|---|---|---|---|
| Achat payé | `POST /transactions` (ou retour de la page de paiement / webhook) | « Achat confirmé » : paiement sécurisé, **les mises à jour arriveront ici** | « Nouvelle vente » : confirmez la disponibilité, puis expédiez |
| Article prêt | `POST /transactions/:id/confirm-availability` (nouveau) | « Article disponible » | « Disponibilité confirmée » |
| Envoi déclaré | `POST /transactions/:id/ship` | « Colis expédié » : numéro de suivi, bouton **Suivre le colis**, date de réception présumée | « Colis expédié » : payé à la confirmation |
| Remise prête (main propre) | `POST /transactions/:id/ship` | « Vendeur prêt pour la remise » | « Prêt pour la remise » |
| Réception | `POST /transactions/:id/confirm-delivery` | « Réception confirmée » | « Réception confirmée par l'acheteur » : **virement déclenché** (ou en attente du compte de versement) |
| Remise validée | `POST /transactions/:id/handover` | « Remise validée » | « Remise validée » : virement déclenché |
| Autres | réception présumée, annulation, litige ouvert / clos | texte adapté | texte adapté |

Les messages automatiques sont **visuellement à part** : centrés, cadre en pointillés sur fond vert clair, étiquette
« Message automatique · Trocoin », sans bulle, sans « Vu », jamais alignés comme « mes » messages. Dans la boîte de
réception, leur aperçu commence par « ℹ️ » et n'est jamais préfixé de « Vous : ».

Un **panneau de la vente** est épinglé sous l'en-tête de la conversation : état, montant, mode de remise, quatre étapes
(Payé → Disponibilité confirmée → Expédié → Reçu) et le bouton de l'étape en cours :

- vendeur : **Confirmer que l'article est disponible** ; « Je suis prêt pour la remise » (main propre) ; « Préparer
  l'envoi (étiquette, suivi) » qui mène à la page de la vente ;
- acheteur : **Confirmer la réception** (avec la même demande de confirmation que sur la page de la vente),
  « Suivre le colis », « Un problème ? » ;
- les deux : « Détails de la vente → ».

## Aucune logique parallèle

- Les boutons de la conversation appellent **les routes `/transactions/...` de la page « Achats et ventes »** ; le
  virement au vendeur reste celui de `confirmDelivery` → `settle` → `payoutSeller` (Stripe Connect, compte de versement
  existant — aucun RIB séparé).
- La messagerie ne fait que **raconter** : `PaymentsService.track()` appelle `ConversationsService.postSystemEvent()`
  après chaque action réussie. Cet appel ne lève jamais (un souci de messagerie ne fait pas échouer un paiement) et
  n'écrit une étape qu'**une fois par vente** (le retour de paiement et le webhook peuvent arriver ensemble).
- Le texte affiché est composé par le site selon le lecteur (`frontend/src/lib/sale-events.ts`) à partir de
  l'évènement et de ses données (`messages.systemEvent`, `transactionId`, `meta`) ; `content` garde une version neutre.
- L'état montré dans la conversation vient de `GET /conversations/:id` → `transaction` (lecture seule de la même
  table). Le **code de remise n'y figure jamais** : il reste sur la page de la vente, visible de l'acheteur seul.
- Temps réel : la passerelle diffuse le message à la conversation ouverte et réveille les deux boîtes (`inbox`), ce qui
  fait relire l'état de la vente.

## Conversation ou page « Achats et ventes » ? Le choix

Trois options ont été pesées :

1. **Tout déplacer dans la conversation** et faire de « Achats et ventes » une simple redirection. Écarté : l'étiquette
   (colis, adresses, tarif, PDF), le code de remise, le litige, l'avis et le récapitulatif financier sont des
   formulaires et des documents ; les empiler dans un fil de messages les rend introuvables, et la page sert aussi de
   trace comptable quand l'annonce ou la conversation n'existe plus.
2. **Dupliquer toute l'interface des deux côtés.** Écarté : deux interfaces à maintenir, deux fois les mêmes risques.
3. **Retenu — la conversation pour suivre et agir en un geste, la page de la vente comme dossier complet.**
   - Conversation : le récit (messages automatiques), l'étape en cours et ses actions en un clic (disponibilité, prêt
     pour la remise, réception, suivre le colis).
   - Page de la vente : montants, chronologie, étiquette et numéro de suivi, code de remise, annulation, litige, avis.
   - Chaque côté renvoie à l'autre (« Détails de la vente → » / « Conversation et suivi »), et comme les routes sont
     les mêmes, **une action faite d'un côté se voit aussitôt de l'autre**.

La confirmation de disponibilité est une étape d'**information** : elle rassure l'acheteur et ne bloque rien
(expédier sans avoir cliqué vaut confirmation), pour ne jamais retarder une vente ni casser les ventes en cours.

## Retour de la page de paiement

- Succès : `success_url = /compte/transactions/:id?paiement=retour` → bandeau **« Paiement réussi »** (montant, ce
  qui se passe ensuite, lien vers la conversation). Si la banque n'a pas encore répondu : « Paiement en cours de
  vérification… », la page se met à jour seule.
- Abandon ou refus : `cancel_url = /compte/transactions/:id?paiement=annule` (avant : l'annonce avec un message
  fugitif) → bandeau **« Paiement non abouti : rien n'a été débité »**, quoi vérifier (plafond, validation de la banque,
  autre moyen de paiement), **Reprendre le paiement** et **Abandonner cet achat** (`POST /transactions/:id/abandon` :
  la page de paiement est fermée chez le fournisseur, l'annonce redevient achetable tout de suite).
- Limite connue de Stripe Checkout (et de PayPal via Stripe) : quand une carte est **refusée**, Stripe garde
  l'acheteur sur sa page avec le motif pour qu'il réessaie avec un autre moyen — il n'existe pas d'adresse de retour
  « en cas d'échec ». L'acheteur revient sur Trocoin par le lien « ← » de la page Stripe (notre `cancel_url`), ou tout
  seul à l'expiration de la session ; dans les deux cas il arrive sur la page ci-dessus, jamais sur une page vide.
- Tests : le fournisseur simulé sait jouer une page de paiement hors du site (`/dev/mock-checkout/:id`, hors
  production uniquement) avec les mêmes adresses de retour — `e2e/25-retour-paiement.spec.ts`.

## Que devient l'annonce pendant la vente ? (AUDIT §58)

| Moment | Annonce | Pour l'acheteur / le public | Pour le vendeur |
|---|---|---|---|
| Paiement reçu (fonds bloqués) | passe **« Vendue »** | badge « Vendu », plus de bouton Acheter ni de contact, sortie des résultats ; la page reste consultable | badge « Vendu » ; ne peut pas la remettre en ligne tant que la vente court (le même objet serait payable deux fois) |
| Vente annulée ou remboursée (acheteur, vendeur, délai, médiateur) | **reste « Vendue »** | — | invité à la **remettre en ligne d'un clic** : conversation, page de la vente, ou Mes annonces |
| Article reçu : réception confirmée, code de remise saisi, fonds libérés par le médiateur | **supprimée automatiquement** | page 404, la vente et la conversation gardent leur trace (titre conservé) | idem ; message « votre annonce a été supprimée automatiquement » |
| Réception présumée (acheteur silencieux) | reste « Vendue » pendant la fenêtre de litige, **supprimée à sa clôture** | il peut encore ouvrir un litige | si l'acheteur est remboursé, il peut la remettre en ligne — elle n'est alors pas supprimée |

Pourquoi la remise en ligne n'est pas automatique après une annulation : entre le paiement et l'annulation, le vendeur
a pu vendre ou donner l'objet ailleurs ; une annonce qui reviendrait seule en ligne pourrait être payée pour un objet
qui n'existe plus. Un clic suffit, et le vendeur est prévenu par notification et dans la conversation.

La suppression est celle que ferait le vendeur (`RetentionService.purgeListing`) : photos, favoris et historique
effacés ; la vente payée garde montants, dates et titre de l'annonce ; les avis restent possibles.
