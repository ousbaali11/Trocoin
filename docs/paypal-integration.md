# PayPal comme second moyen de paiement — conception (phase 1) et mise en œuvre (option 0)

Date : 16 septembre 2026. Aucun code de paiement PayPal n'est écrit dans cette phase : ce document
pose l'architecture, le compromis et ce qu'il faut obtenir avant la phase 2. Sources lues le jour
même : documentation PayPal (checkout « authorize », multiparty / Commerce Platform, seller
onboarding, Payouts), documentation Stripe (« Paiements PayPal », Connect, capture différée).

## 1. Ce que fait Trocoin aujourd'hui (Stripe)

- Un seul fournisseur actif à la fois (`PAYMENT_PROVIDER=stripe|paypal|mock|disabled`) derrière
  `IPaymentProvider` (`createCheckout` / `syncCheckout` / `capture` / `refund` / `parseWebhook`).
- Modèle Stripe Connect **destination charges** : l'acheteur paie sur Stripe Checkout, le montant est
  **autorisé** (capture différée), la commission est retenue (`application_fee_amount`) et le reste va
  au compte Connect Express du vendeur **à la capture**. Chaque vendeur relie donc son propre compte de
  versement (onboarding Express, `stripeAccountId`).
- Échéances du séquestre (AUDIT §37) : date limite de capture lue chez le fournisseur, réception
  présumée, capture avant expiration, annulation par défaut.
- `paypal-payment.provider.ts` est une **simulation** : aucun appel réseau, mêmes identifiants
  fictifs que le mock.

## 2. Comment PayPal traite une place de marché

| Brique PayPal | Rôle | Conditions relevées |
|---|---|---|
| **Orders API v2, `intent=AUTHORIZE`** | autorisation puis capture différée (équivalent du séquestre) | autorisation **valable 29 jours**, capture **garantie pendant la période d'honneur de 3 jours** ; au-delà, « la capture dépend du risque et de la disponibilité des fonds » ; **réautorisation** possible plusieurs fois dans les 29 jours (nouvel identifiant, période d'honneur relancée) |
| **PayPal Commerce Platform (multiparty)** | la plateforme encaisse pour des vendeurs tiers : `payee` = vendeur, `platform_fees` = commission, versement immédiat ou **différé** au vendeur | « appliquer pour des identifiants de production et passer en production **après approbation de votre plateforme ou place de marché** » ; **onboarding de chaque vendeur** par l'API Partner Referrals (lien PayPal, connexion ou création d'un compte PayPal, permissions accordées) ; compte PayPal professionnel exigé pour l'intégration « après paiement » et « Expanded Checkout » |
| **Payouts API** | verser des fonds à des tiers (e-mail, téléphone, identifiant PayPal) depuis le solde PayPal de la plateforme | « compte PayPal professionnel », « accès à PayPal Payouts » (demande à approuver), « identité, e-mail et compte bancaire confirmés », « fonds suffisants dans votre compte » ; le bénéficiaire réclame les fonds avec un compte PayPal (ou en crée un) |
| **Politique d'utilisation acceptable** | encadre l'encaissement pour le compte de tiers | agir comme intermédiaire ou agrégateur de paiement pour des tiers fait partie des activités soumises à **autorisation préalable** de PayPal (à confirmer sur le texte en vigueur avant tout choix B) |

## 3. Les options d'architecture

### Option 0 — PayPal *à travers Stripe* (RETENUE et mise en œuvre le 16 septembre 2026, voir §7)

Stripe propose PayPal comme moyen de paiement pour les comptes Stripe **français** (liste des pays
prise en charge : AT, BE, …, **FR**, …). L'acheteur choisit PayPal sur la page Stripe Checkout, est
redirigé vers PayPal, puis revient ; les fonds arrivent sur le solde Stripe comme une carte.

- **Connect** : « Paiements indirects (destination charges) : pris en charge · Paiements et transferts
  distincts : pris en charge · Paiements directs et `on_behalf_of` : non pris en charge » — exactement
  le modèle de Trocoin. « Les places de marché en ligne doivent soumettre une demande d'inscription
  depuis le Dashboard Stripe pour accéder à PayPal » (approbation manuelle, suivie par e-mail).
- **Capture différée** : PayPal via Stripe accepte l'autorisation puis la capture (« bloque le montant
  pendant 10 jours ; Stripe tente automatiquement de bloquer les fonds pour 10 jours supplémentaires,
  soit un total de 20 jours »). Le mécanisme d'échéances (AUDIT §37) lit déjà la date limite fournie
  par Stripe : il s'applique sans changement.
- **Remboursements** jusqu'à 180 jours, litiges gérés dans le Dashboard Stripe, aucune clé PayPal,
  aucun onboarding supplémentaire pour les vendeurs, aucun second flux comptable.
- Coût : frais PayPal facturés via Stripe (visibles dans les rapports de solde) ; une demande
  d'activation « place de marché » à faire une fois dans le Dashboard Stripe (mode test disponible
  sans compte PayPal).
- Ce qui reste à faire côté code : rien côté API (Checkout propose PayPal dès qu'il est activé dans
  le Dashboard) ; côté front, afficher « Carte ou PayPal » sur le bouton de paiement et, si l'on veut
  un choix explicite, passer `payment_method_types` ou laisser Stripe afficher les deux.

**Pourquoi c'est la plus simple et la plus solide** : un seul prestataire à réconcilier, un seul
séquestre, un seul parcours d'onboarding vendeur (Stripe Express), la protection acheteur et le
remboursement inchangés, et l'obligation « place de marché » traitée par Stripe qui est l'entité
approuvée. La seule dépendance est l'acceptation de la demande PayPal par Stripe.

### Option A — PayPal Commerce Platform en direct (chaque vendeur relie un compte PayPal)

Trocoin devient partenaire PayPal ; chaque vendeur passe l'onboarding Partner Referrals (compte PayPal
personnel ou professionnel selon le mode), les commandes portent `payee` = vendeur et
`platform_fees` = commission, versement différé possible.

- Avantages : modèle nativement conçu pour les places de marché, fonds directement chez le vendeur,
  litiges PayPal gérés par PayPal.
- Inconvénients : **deuxième onboarding** pour chaque vendeur (en plus de Stripe Express), approbation
  de Trocoin comme plateforme PayPal (dossier, délai), deux systèmes de séquestre et de remboursement
  à maintenir, une réautorisation à gérer tous les 3 jours (période d'honneur) pour tenir le séquestre,
  et un vendeur sans compte PayPal ne peut pas recevoir de paiement PayPal (soit on masque PayPal pour
  ses annonces, soit l'acheteur est refusé au moment de payer).

### Option B — Trocoin encaisse sur son propre compte PayPal, reverse par Stripe Connect

L'acheteur paie sur le compte PayPal de Trocoin ; à la confirmation, Trocoin vire le vendeur via son
compte Stripe Connect existant.

- Avantages apparents : aucun onboarding vendeur supplémentaire, un seul compte PayPal.
- Blocages : (1) **conditions PayPal** — encaisser pour le compte de tiers relève de l'intermédiation
  de paiement, activité soumise à autorisation préalable ; sans l'approbation « plateforme », le compte
  peut être limité ou fermé ; (2) **les fonds PayPal ne sont pas sur Stripe** : un transfert Connect se
  fait depuis le solde Stripe, qu'il faudrait réalimenter par virement bancaire (top-up) depuis
  PayPal, avec plusieurs jours de latence et un rapprochement comptable manuel ; (3) un remboursement
  PayPal après versement Stripe suppose une annulation de transfert Connect sur un compte vendeur qui a
  pu retirer ses fonds. Option **déconseillée**.

### Option C — Trocoin encaisse sur PayPal et paie les vendeurs par Payouts PayPal

Variante de B côté PayPal seulement : même problème d'autorisation préalable, plus l'obligation d'un
compte PayPal pour chaque vendeur (le bénéficiaire réclame les fonds avec un compte PayPal), des
frais de Payouts et un solde PayPal à approvisionner. Déconseillée.

## 4. Recommandation

**Option 0 (PayPal via Stripe)**, puis Option A seulement si Stripe refuse la demande « place de
marché » ou si un besoin propre à PayPal apparaît (protection vendeur PayPal, marchés hors Stripe).
Aucune des deux ne demande à Trocoin d'encaisser sur son propre compte PayPal pour reverser ensuite :
c'est le schéma que les conditions PayPal encadrent le plus strictement.

**Décision prise (16 septembre 2026) : Option 0.** L'option A (Commerce Platform en direct) reste possible
plus tard si un besoin propre à PayPal apparaît ; son fournisseur simulé et ses variables restent
déclarés mais inutilisés.

## 5. Ce que l'utilisateur doit faire de son côté

**Pour l'option 0 (Stripe)**
1. Dashboard Stripe → *Paramètres* → *Moyens de paiement* → **PayPal** → *Activer* ; comme place de
   marché (Connect), soumettre la demande depuis cette page et attendre l'e-mail de Stripe.
2. Choisir la *préférence de règlement* (fonds versés sur le solde Stripe, recommandé : les
   remboursements y sont prélevés).
3. Rien à créer chez PayPal : le mode test Stripe simule PayPal ; en production, Stripe relie le
   compte PayPal de l'entreprise lors de l'activation.

**Pour l'option A (PayPal en direct, si retenue)** — identifiants de test à obtenir, à transmettre à part
(jamais dans le dépôt ni dans le chat) :
1. Créer un compte développeur sur **developer.paypal.com** (*Log in to Dashboard*) avec le compte
   PayPal professionnel de Trocoin.
2. *Apps & Credentials* → environnement **Sandbox** → créer une application REST → noter le
   **Client ID** et le **Secret** (→ variables Render `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
   `PAYPAL_ENV=sandbox`).
3. *Testing Tools → Sandbox Accounts* : PayPal fournit un compte **Business** (vendeur / plateforme)
   et un compte **Personal** (acheteur) de test ; noter les identifiants de connexion à
   `sandbox.paypal.com` pour jouer les paiements.
4. Pour le multiparty : demander l'accès **PayPal Commerce Platform / Partner** (formulaire PayPal,
   BN code attribué) et créer un second compte Business sandbox pour simuler un vendeur onboardé.
5. Webhooks : *Apps & Credentials → application → Webhooks* : événements
   `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`,
   `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.AUTHORIZATION.VOIDED` vers
   `https://api.trocoin.fr/transactions/webhook/paypal` ; noter le **Webhook ID** (vérification de
   signature côté API).

## 6. Architecture technique préparée (sans casser Stripe ni le mock)

- `IPaymentProvider` reste le contrat ; `MockPaymentProvider` et `StripePaymentProvider` inchangés.
- **Choix du moyen de paiement par l'acheteur** : aujourd'hui un seul fournisseur global. Pour faire
  cohabiter carte et PayPal, la transaction porte son fournisseur (`transactions.paymentProvider`,
  migration) et `PaymentsService` résout le fournisseur **par transaction** (registre
  `{ stripe, paypal }` au lieu de l'injection unique) : capture, remboursement, webhooks et échéances
  suivent la transaction. `PAYMENT_PROVIDERS=stripe,paypal` liste les fournisseurs actifs ;
  `GET /transactions/quote` renvoie les moyens disponibles ; `POST /transactions` accepte
  `paymentMethod: 'card' | 'paypal'`.
  - Avec l'option 0, ce choix est **porté par Stripe Checkout** (les deux moyens sur la même page) :
    aucun registre nécessaire, `paymentMethod` sert seulement à pré-sélectionner.
- **Fournisseur PayPal réel (option A)** : `createCheckout` → `POST /v2/checkout/orders`
  (`intent=AUTHORIZE`, `purchase_units[].payee`, `payment_instruction.platform_fees`,
  `disbursement_mode=DELAYED`) → URL d'approbation ; `syncCheckout` → `GET /v2/checkout/orders/{id}`
  puis `POST …/authorize` au retour ; `capture` → `POST /v2/payments/authorizations/{id}/capture` ;
  `refund` → `POST …/authorizations/{id}/void` (non capturé) ou `POST /v2/payments/captures/{id}/refund`
  ; `parseWebhook` → `POST /v1/notifications/verify-webhook-signature`.
- **Séquestre** : `captureBefore` = autorisation + 3 jours (période d'honneur) ; nouveau crochet
  optionnel `reauthorize(providerPaymentId)` dans l'interface, appelé par `runEscrowSchedule` quand la
  date limite approche et que la transaction n'est pas résolue (jusqu'à 29 jours), ce que Stripe ne
  permet pas (d'où la capture avant expiration côté Stripe). Les règles fonctionnelles (réception
  présumée, rappels, action par défaut) sont communes.
- **Tests** : faux serveur PayPal (comme `test/phase20` pour Boxtal) — commande créée, approuvée,
  autorisée, capturée, remboursée, annulée, webhook signé / invalide ; puis un vrai passage sandbox
  avec les comptes de test PayPal, comme pour Boxtal.

## 7. Mise en œuvre de l'option 0 (AUDIT §40)

Rien de séparé à intégrer : PayPal est un moyen de paiement supplémentaire **de la session Stripe
Checkout déjà utilisée**, avec le même séquestre sur le solde de la plateforme (AUDIT §39) et le
même virement Connect au vendeur que la carte.

- `src/payments/stripe-payment.provider.ts` : la session Checkout ne fixe volontairement **aucun**
  `payment_method_types` ; Stripe propose les moyens activés dans le Dashboard et compatibles avec la
  capture différée. Aucune restriction à la carte n'existait ; l'intention est désormais écrite noir sur
  blanc. Le moyen réellement utilisé (`payment_method_details.type` : `card`, `paypal`, …) est relu à
  l'autorisation et mémorisé (`transactions.paymentMethod`), affiché au membre et à l'admin.
- Capture différée avec PayPal : autorisation valable 10 jours côté Stripe ; sans importance depuis le
  séquestre sur le solde (capture au plus tard 24 h après le paiement).
- Aucun texte ne suppose une carte : les libellés parlent de « paiement », d'« autorisation » et de
  « moyen de paiement » ; `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_ENV` ne sont pas lus
  pour cette option.
- Côté Dashboard Stripe (action de l'utilisateur, en cours) : *Paramètres → Moyens de paiement → PayPal
  → Activer*, demande « place de marché » (Connect) à approuver par Stripe. Tant qu'elle n'est pas
  approuvée, la page Checkout ne montre que la carte ; dès l'approbation, PayPal apparaît sans
  déploiement, y compris en mode test (Stripe simule PayPal, aucun compte sandbox PayPal requis).
- Vérification : test API `test/phase25.e2e-spec.ts` (moyen `paypal` relu et mémorisé) ; page Checkout
  réelle en mode test ouverte depuis une transaction de production (voir AUDIT §40 pour le résultat
  constaté : PayPal présent ou activation encore en attente).
