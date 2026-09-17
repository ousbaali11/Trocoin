# Le paiement sécurisé Trocoin expliqué, chiffres à l'appui

Document de référence (AUDIT §51, 17 septembre 2026) pour comprendre où va l'argent d'une vente, ce que
paie l'acheteur, ce que reçoit le vendeur, ce que garde Trocoin, et ce que coûte réellement le prestataire
de paiement. Il sert aussi de support pour un comptable (voir §7). Tous les montants ci-dessous sont
calculés avec le **barème en vigueur par défaut** : commission vendeur **8 %**, frais de protection
acheteur **5 % + 0,50 €, plafonnés à 15 €**. Ce barème est désormais réglable par l'admin (§6).

Exemple suivi tout au long du document : **un article affiché 10,00 €**, payé par carte bancaire
française standard, remis en main propre ou expédié.

## 1. Résumé en une ligne

| Qui | Montant | Calcul |
|---|---|---|
| L'acheteur paie | **11,00 €** | 10,00 € + frais de protection (10 × 5 % + 0,50 € = 1,00 €) |
| Le vendeur reçoit | **9,20 €** | 10,00 € − commission (10 × 8 % = 0,80 €) |
| Trocoin garde, brut | **1,80 €** | 1,00 € de frais acheteur + 0,80 € de commission vendeur |
| Stripe prélève sur la part de Trocoin | **≈ 0,54 €** | 0,42 € sur le paiement + 0,12 € sur le virement au vendeur (détail §4) |
| Trocoin garde, net de Stripe | **≈ 1,26 €** | avant le forfait de 2 € par vendeur actif et par mois (§4) |

Point essentiel : **les frais de Stripe ne sont pas déduits de la part du vendeur ni ajoutés à celle de
l'acheteur. Ils sortent de ce que garde Trocoin**, et aucun calcul du code ne les anticipe (§5).

## 2. Où va l'argent, étape par étape, avec les délais réels

Modèle en place depuis AUDIT §39, dit « paiements et transferts distincts » : l'argent de l'acheteur arrive
sur le **solde Stripe de la plateforme Trocoin**, y reste pendant le séquestre, puis la part du vendeur lui
est virée à la confirmation. Les délais sont ceux du code (`src/payments/payments.service.ts`), réglables
par variables d'environnement.

| # | Étape | Où est l'argent | Délai appliqué aujourd'hui |
|---|---|---|---|
| 1 | **Autorisation**. L'acheteur valide sur la page de paiement hébergée par Stripe (carte, ou PayPal une fois actif). | Toujours sur le compte de l'acheteur : 11,00 € sont **réservés**, pas débités (`capture_method: manual`). | Immédiat. La page de paiement expire après 30 min si elle n'est pas validée. |
| 2 | **Capture sur le solde de Trocoin**. | 11,00 € débités et crédités au solde Stripe de Trocoin, **moins les frais Stripe du paiement** (0,42 €). | Au plus tard **24 h** après l'autorisation (`ESCROW_CAPTURE_AFTER_HOURS`), plus tôt dès que le vendeur expédie, se déclare prêt, ou qu'un litige s'ouvre. Pendant ces 24 h, une annulation libère simplement l'autorisation : aucun débit, aucun frais. |
| 3 | **Séquestre**. Le vendeur expédie (numéro de suivi) ou remet l'objet (code à 6 chiffres donné par l'acheteur). | Sur le solde de Trocoin. | Le vendeur a **7 jours** pour expédier ou remettre (`ESCROW_SHIP_DEADLINE_DAYS`) ; passé ce délai, la vente est annulée et l'acheteur remboursé intégralement (11,00 €). |
| 4 | **Confirmation**. L'acheteur confirme la réception, ou le code de remise est saisi, ou la réception est présumée. | Déclenche le virement. | Réception présumée **7 jours après l'expédition** sans confirmation ni litige (`ESCROW_AUTO_CONFIRM_DAYS`), avec rappels à l'acheteur 48 h et 24 h avant. Après une confirmation automatique, l'acheteur garde **7 jours** pour ouvrir un litige (`ESCROW_DISPUTE_WINDOW_DAYS`). |
| 5 | **Virement différé au vendeur** (`Transfer` Stripe, adossé au paiement d'origine). | 9,20 € passent du solde de Trocoin au **compte Stripe Express du vendeur**. 1,80 € restent sur le solde de Trocoin. | À la confirmation. Si le vendeur n'a pas encore créé son compte de versement, le virement reste en attente et est retenté automatiquement (tâche toutes les 15 min). |
| 6 | **Versement bancaire** (`Payout` Stripe). | 9,20 € partent du compte Stripe du vendeur vers son **IBAN**. | Calendrier par défaut de Stripe pour les comptes Express français : versements automatiques quotidiens, fonds disponibles quelques jours ouvrés après le paiement, et délai plus long (7 à 14 jours) pour le **tout premier** versement d'un nouveau compte. Le code ne règle pas ce calendrier : il se lit et se change dans le Dashboard Stripe. |
| 6 bis | Versement de Trocoin. | Le solde restant de Trocoin (1,80 € moins les frais Stripe) part vers le compte bancaire de Trocoin. | Même calendrier Stripe, côté compte plateforme. |

Remboursement : avant capture, l'autorisation est libérée (0 € de frais). Après capture, Trocoin rembourse
11,00 € depuis son solde ; **Stripe ne rend pas ses frais de traitement** (0,42 € perdus). Après virement au
vendeur, le virement est d'abord annulé (le compte du vendeur est débité de 9,20 €), puis l'acheteur
remboursé.

## 3. Ce que voient l'acheteur et le vendeur

**L'acheteur ne paie pas 10,00 € : il paie 11,00 €**, et il le voit en détail avant de payer.

- Sur la fiche annonce, le bouton indique « Acheter · 11,00 € » et, dessous, « Paiement sécurisé :
  10,00 € + 1,00 € de frais de protection ».
- Dans la fenêtre de confirmation, trois lignes : **Prix de l'article 10,00 €**, **Frais de protection
  acheteur 1,00 €**, **Total à payer 11,00 €**. La formule des frais n'y figure pas (choix du propriétaire,
  AUDIT §53) : elle se lit dans le centre d'aide.
- Sur la page de paiement hébergée par Stripe, **deux lignes** depuis AUDIT §51 : l'article (10,00 €) et
  « Frais de protection acheteur Trocoin » (1,00 €). Auparavant, une seule ligne de 11,00 € au nom de
  l'article.
- Si le barème change entre l'affichage et le clic sur « Payer », le serveur refuse (409) et la fenêtre
  affiche le nouveau total : l'acheteur n'est jamais débité d'un montant qu'il n'a pas vu.

**Le vendeur ne reçoit pas le prix plein : il reçoit 9,20 €.** L'acheteur ne voit ni ce montant ni la
commission (retirés de la fenêtre de paiement, AUDIT §53) ; le vendeur les voit sur la fiche de sa
transaction : « Prix de l'article 10,00 € · Commission Trocoin (8 %) − 0,80 € · Montant versé 9,20 € ».

Plafond : les frais de protection ne dépassent jamais 15 €. Pour un article à 1 000 €, l'acheteur paie
1 015,00 € (et non 1 050,50 €), le vendeur reçoit 920,00 €, Trocoin garde 95,00 € brut.

## 4. Les frais réels de Stripe sur cet exemple

Barème public français de Stripe, relu sur stripe.com/fr/pricing et stripe.com/fr/connect/pricing le
17 septembre 2026. Il peut changer et un tarif négocié peut s'y substituer : la référence reste le
Dashboard Stripe de Trocoin.

| Frais | Barème | Sur la vente à 10 € | Qui le paie |
|---|---|---|---|
| Paiement par carte standard de l'Espace économique européen | 1,5 % + 0,25 € | 11,00 × 1,5 % + 0,25 = 0,415 → **0,42 €** | Trocoin (prélevé sur son solde à la capture) |
| Carte premium EEE (cartes « haut de gamme », professionnelles) | 2,8 % + 0,25 € | 0,308 + 0,25 → 0,56 € | Trocoin |
| Carte britannique | 2,5 % + 0,25 € | 0,275 + 0,25 → 0,53 € | Trocoin |
| Carte internationale | 3,15 % + 0,25 € (+ 2 % si conversion de devise) | 0,347 + 0,25 → 0,60 € | Trocoin |
| PayPal via Stripe (une fois actif) | 0,2 % + 0,10 € pour Stripe **plus les frais propres de PayPal** | 0,022 + 0,10 → 0,12 € + frais PayPal (à lire sur le compte marchand PayPal, non publiés par Stripe) | Trocoin |
| Connect, virement vers le vendeur | 0,25 % + 0,10 € par versement | 9,20 × 0,25 % + 0,10 = 0,123 → **0,12 €** | Trocoin |
| Connect, compte vendeur actif | **2 € par compte et par mois** où au moins un versement bancaire part | 2,00 € répartis sur toutes les ventes du vendeur ce mois-là | Trocoin |
| Litige bancaire (rétrofacturation) reçu | 20,00 € par litige | 0 € en temps normal | Trocoin |

Résultat pour la vente à 10,00 € par carte standard :

```
Trocoin garde brut            1,80 €
− frais Stripe du paiement    0,42 €
− frais Connect du virement   0,12 €
= net par vente               1,26 €
− forfait compte actif        2,00 € par vendeur et par mois (une seule fois, quel que soit le nombre de ventes)
```

Conséquence à connaître : **un vendeur qui ne fait qu'une vente à 10 € dans le mois coûte plus à Trocoin
qu'il ne rapporte** (1,26 − 2,00 = −0,74 €). Il faut environ deux ventes à 10 € par vendeur actif dans le
mois, ou une seule vente d'environ 20 € et plus, pour couvrir ce forfait. À l'inverse, pour un article à
100 € : Trocoin garde 5,50 + 8,00 = 13,50 € brut, Stripe prend 1,83 € sur le paiement (105,50 × 1,5 % +
0,25) et 0,33 € sur le virement, soit 11,34 € net avant forfait.

## 5. Où ces montants sont calculés dans le code, et où ils ne le sont pas

| Élément | Où | Ce qui est fait |
|---|---|---|
| Frais acheteur, commission, total, net vendeur | `computeQuote()` dans `src/payments/payments.service.ts` | `commission = prix × taux`, `frais = min(prix × taux + fixe, plafond)`, arrondis au centime ; taux lus dans les réglages système (`SettingsService.fees()`). |
| Montants figés d'une vente | `createTransaction()` : colonnes `amount`, `commission`, `buyerFee`, `feeRates` de `transactions` | Calculés une fois, à la création. Toute la suite (affichage, virement, remboursement) relit ces colonnes ; rien n'est recalculé avec le barème du jour (`quoteOfTransaction()`). |
| Montant débité à l'acheteur | `createCheckout()` / `createPaymentIntent()` dans `src/payments/stripe-payment.provider.ts` | `amountEuros = prix + frais acheteur` (11,00 €), en capture différée, sur le compte plateforme. |
| Montant viré au vendeur | `payoutSeller()` → `transfer()` | `amount − commission` (9,20 €), adossé au paiement d'origine (`source_transaction`). |
| Part de Trocoin | nulle part explicitement | C'est **ce qui reste** sur le solde de la plateforme après le virement : 11,00 − 9,20 = 1,80 €. |
| **Frais Stripe** | **nulle part** | Aucune ligne du code ne calcule, ne stocke ni ne déduit les frais Stripe. Stripe les prélève lui-même sur le solde de la plateforme. Le tableau de bord admin (« Revenus plateforme ») additionne commission + frais acheteur : c'est un chiffre **brut**, avant frais Stripe. |

Donc, à la question « les frais Stripe sont-ils déjà déduits de ce que garde Trocoin ? » : **non dans le
code, oui dans la réalité**. Le code affiche et enregistre 1,80 € ; le solde Stripe de Trocoin n'augmente
que de 1,80 − 0,42 − 0,12 = 1,26 €, et le forfait mensuel par vendeur actif vient encore en déduction. Le
montant net exact de chaque vente se lit dans le Dashboard Stripe (rapport « Balance » / frais), pas dans
Trocoin. Un rapprochement automatique (relecture de `balance_transaction.fee` après la capture) est
possible mais n'existe pas aujourd'hui.

Ancien modèle (« destination », ventes antérieures à AUDIT §39) : la part de Trocoin passait par
`application_fee_amount` et les fonds allaient directement chez le vendeur à la capture. Il n'est plus
utilisé pour les nouvelles ventes ; le code le garde pour dénouer les anciennes.

## 6. Commission et frais réglables par l'admin (AUDIT §51)

Console d'administration → Configuration → « Monétisation et formules » → panneau **« Commission et frais
du paiement sécurisé »** : pourcentage de commission vendeur, pourcentage et montant fixe des frais de
protection acheteur, plafond de ces frais.

- Le panneau affiche à part la **valeur en vigueur**, un exemple chiffré pour 10 €, et la date et
  l'auteur de la dernière modification.
- Un changement ne vaut que pour les **transactions créées après** : chaque transaction porte ses
  montants et son barème (`feeRates`) ; une vente en cours, terminée, ou une page de paiement déjà ouverte
  ne sont jamais recalculées. Un total déjà affiché mais pas encore payé est protégé par le refus 409
  décrit au §3.
- Chaque changement est inscrit au **journal d'audit** (`settings.update`) : admin, date, adresse IP, et
  pour chaque réglage l'ancienne et la nouvelle valeur (`{"commission_percent":{"from":8,"to":10}}`).
- Bornes : pourcentages de 0 à 30 %, fixe de 0 à 20 €, plafond de 0 à 500 €, deux décimales au plus.
- Les textes publics (centre d'aide, page « Versements ») lisent le barème en vigueur : plus de chiffre
  écrit en dur.

## 7. Ce que ce document ne tranche pas

Savoir si ce mécanisme crée un risque fiscal, comptable ou réglementaire pour Trocoin ne relève ni du code
ni d'une IA. Questions à poser à un expert-comptable, ce document en main :

1. Trocoin encaisse 11,00 € sur son solde et en reverse 9,20 € : le chiffre d'affaires est-il 1,80 €
   (commission d'intermédiaire) ou 11,00 € ? Comment comptabiliser les fonds de tiers en séquestre ?
2. La commission de 8 % et les frais de protection sont-ils soumis à TVA, et à quel taux, pour des
   vendeurs particuliers et professionnels ?
3. Les frais Stripe (paiement, Connect, forfait mensuel, litiges) : charges de Trocoin, avec quelle
   TVA (Stripe facture depuis l'Irlande) ?
4. Détention de fonds pour compte de tiers : le recours à Stripe Connect (établissement de paiement
   agréé) suffit-il, ou un statut d'agent de paiement est-il requis ?
5. Obligations DAC7 (déclaration des revenus des vendeurs au-delà de 30 ventes ou 2 000 € par an).
