# Étiquettes transporteur — comparatif, recommandation et architecture

Date : 15 septembre 2026. Contexte : le domaine `trocoin.fr` est acheté ; l'impression d'étiquettes
d'envoi dépend d'un compte chez un prestataire que Trocoin n'a pas encore. Ce document couvre la
**phase 1** (recherche, choix, préparation en mode simulation). La phase 2 (intégration réelle)
ne démarre qu'une fois les clés de test fournies.

Convention : **observé** = lu sur une page consultée le 15 septembre 2026 (page citée) ;
**d'après la documentation publique** = repris de sources secondaires ou de la documentation
développeur connue, à confirmer sur le compte une fois ouvert. Les tarifs d'envoi eux-mêmes
(Colissimo, Mondial Relay) ne sont pas repris ici : ils viennent de la cotation en direct.

## 1. Besoin

- Vendeur particulier ou pro, petit volume au démarrage (quelques envois par jour au plus).
- Deux transporteurs minimum : **Colissimo** (domicile et point de retrait) et **Mondial Relay**
  (point relais), les plus utilisés par les particuliers en France ; envoi à domicile et point relais.
- Par API : cotation à partir du poids et des dimensions, achat de l'étiquette (PDF 10 × 15 cm),
  numéro de suivi, suivi du colis, recherche de points relais.
- Sans engagement ni abonnement tant que le volume est faible ; paiement à l'étiquette.
- Un environnement de test gratuit pour développer sans expédier.

## 2. Comparatif

| Critère | Boxtal (agrégateur) | Sendcloud (agrégateur) | Colissimo + Mondial Relay en direct |
|---|---|---|---|
| Coût d'usage | **Sans abonnement ni engagement, paiement à l'envoi** aux tarifs négociés de la plateforme, aucun frais d'édition d'étiquette (d'après la documentation publique et les pages Boxtal citées) | Plan **Free à 0 €/mois** limité à 50 étiquettes par mois ; au-delà **Lite 35 €/mois** (26 € en annuel) **+ 0,12 € par étiquette**, puis Growth 119 €, Premium 219 €, Pro 799 € (observé sur la page Tarifs) | Aucun abonnement plateforme, mais **contrat professionnel** chez chaque transporteur (Colissimo Entreprise : contrat et numéro de contrat ; Mondial Relay : compte pro « Connect » avec code enseigne / clé privée) : deux contrats à négocier et deux intégrations à maintenir |
| Simplicité d'intégration | API REST JSON : **v3** pour les commandes d'expédition, étiquettes, suivi et points relais ; **v1** (identifiant + mot de passe) pour la cotation multi-transporteurs. Une seule authentification pour tous les transporteurs. Bibliothèques PHP officielles, SDK communautaires. Environnement de test dédié (`shipping.boxtal.build`) | API REST v2/v3 bien documentée, SDK, webhooks ; une seule authentification ; mais l'API n'apporte de tarifs négociés que sur les plans payants | Colissimo : web service d'affranchissement (SOAP/REST, spécifications PDF) ; Mondial Relay : API v1 SOAP (code enseigne, clé privée) et API v2 « Connect » JSON (login, mot de passe, CustomerID, sandbox `connect-api.mondialrelay.com`). Deux formats, deux jeux d'identifiants, deux suivis |
| Transporteurs couverts | Colissimo, Chronopost, **Mondial Relay**, UPS, DHL, FedEx… (une quinzaine) | Plus de 80, dont Colissimo, Mondial Relay, Chronopost, DPD | Les deux visés, et seulement eux |
| Points relais | Recherche par API (offre liée au contrat activé) | Recherche par API | API de chaque transporteur |
| Délai d'activation | **Compte gratuit ouvert en ligne** ; clés API v1/v3 dans l'espace client ; compte de test gratuit (d'après la documentation publique). Pas de commercial à rencontrer | Compte gratuit immédiat ; plan Free utilisable tout de suite | Colissimo Entreprise : ouverture de contrat par un interlocuteur commercial, identifiants envoyés à l'ouverture (observé dans les spécifications) ; Mondial Relay : compte pro puis activation API dans l'espace Connect (plusieurs jours à quelques semaines) |
| Facturation des envois | Prélevée par Boxtal sur le compte (carte ou prépaiement) | Facture Sendcloud mensuelle | Facture de chaque transporteur |
| Risque | Dépendance à un intermédiaire ; tarifs négociés sans garantie de rester les plus bas | Abonnement dès que le volume dépasse 50 étiquettes par mois ; l'API tarifaire complète est sur les plans payants | Délais et volumes minimaux des contrats pro ; deux intégrations |

Sources consultées le 15 septembre 2026 : page Tarifs Sendcloud (observée : plans, prix par
étiquette, limites mensuelles) ; pages de présentation de Boxtal et de sa bibliothèque PHP
(observées : compte gratuit, environnement de test, cotation / commande / étiquette / suivi,
paiement à l'envoi sans abonnement) ; spécifications du web service d'affranchissement Colissimo
(observées : contrat et identifiants transmis à l'ouverture) ; guides d'identifiants Mondial Relay
Connect (observés : compte pro, sandbox et production, code enseigne / clé privée). Le portail
`developer.boxtal.com` se charge en JavaScript et n'a pas pu être lu automatiquement : le détail
des routes v3 est repris **d'après la documentation publique** et sera confirmé avec les clés.

## 3. Recommandation : Boxtal

Raisons, par ordre d'importance :

1. **Coût nul à volume nul** : pas d'abonnement, pas de frais par étiquette ; on ne paie que
   l'affranchissement. Avec Sendcloud, la première centaine d'étiquettes mensuelles fait basculer
   sur 35 €/mois + 0,12 € l'étiquette ; en direct, il faut deux contrats pro avant le premier envoi.
2. **Une seule intégration** couvre Colissimo et Mondial Relay (et Chronopost, UPS… si besoin
   plus tard) : un `BoxtalShippingProvider` derrière `IShippingProvider`, au lieu de deux
   fournisseurs à maintenir.
3. **Compte et environnement de test gratuits** ouverts en ligne, sans interlocuteur commercial :
   la phase 2 peut démarrer dès que les clés de test existent.
4. Société française, documentation et support en français, étiquettes au format 10 × 15 cm
   attendu par les bureaux de poste et les points relais.

Réserve : les tarifs négociés Boxtal ne sont pas garantis contractuellement ; si un jour le volume
justifie un contrat Colissimo direct, l'interface `IShippingProvider` permet de le brancher sans
toucher au parcours.

## 4. Ce que l'utilisateur doit faire pour obtenir des clés de test (à transmettre séparément)

1. Créer un compte Boxtal (gratuit) sur boxtal.com avec l'adresse de l'entreprise Trocoin.
2. Dans l'espace client, ouvrir la rubrique API / intégrations et générer :
   - une **clé API v3** (commandes d'expédition, étiquettes, suivi, points relais) ;
   - les **identifiants API v1** (cotation multi-transporteurs), si Boxtal les distingue encore.
3. Demander ou activer l'accès à l'**environnement de test** (`shipping.boxtal.build`) et noter
   l'URL et les identifiants de test à part des identifiants de production.
4. Activer les offres Colissimo et Mondial Relay sur le compte ; noter les **codes d'offre**
   (`SHIPPING_OFFER_CODE`) qui apparaissent dans le portail développeur : ils sont obligatoires
   pour créer une expédition et chercher des points relais.
5. Renseigner l'adresse d'expédition par défaut de Trocoin (mentions légales) et un moyen de
   paiement pour la production (aucun pour le test).
6. Transmettre : URL de test, clé v3 de test, identifiants v1 de test, codes d'offre. Rien ne
   doit être collé dans une conversation ni commité : les valeurs vont dans les variables
   d'environnement Render (noms exacts et valeurs à copier : §7 ; les codes d'offre seront lus
   par l'API au lieu d'être configurés, si le compte les expose).

## 5. Architecture livrée en phase 1 (mode simulation)

Même principe que l'e-mail (`IEmailProvider`, Resend / mock / none) et le paiement.

- **Fournisseur interchangeable** : `src/shipping/shipping-provider.interface.ts`
  (`IShippingProvider` : `quote`, `searchRelayPoints`, `createLabel`, `track` ;
  `ShippingProviderError` avec un code : `adresse_invalide`, `transporteur_indisponible`,
  `etiquette_impossible`, `non_configure`, `reseau`).
- **`MockShippingProvider`** (`mock-shipping.provider.ts`) : tarifs indicatifs par tranche de poids
  (Colissimo domicile / point relais, Mondial Relay point relais, 30 kg maximum), trois points
  relais fictifs par code postal, **étiquette PDF 10 × 15 cm** marquée « SIMULATION » générée sans
  dépendance (`pdf-label.ts` : texte, cadres, code-barres décoratif dérivé du numéro), numéro de
  suivi `SIM` + 10 chiffres, suivi qui progresse avec le temps. Pannes simulées par
  `SHIPPING_MOCK_FAIL=etiquette|adresse` et par le code postal `99999`.
- **`UnconfiguredShippingProvider`** (`SHIPPING_PROVIDER=none`) : répond « non configuré » (503) ;
  c'est la valeur de production tant qu'aucun compte n'existe. `mock` est interdit en production
  (contrôle au démarrage, comme pour l'e-mail).
- **Modèle de données** : entité `Shipment` (`shipment.entity.ts`, table `shipments`, migration
  `1789450000000-Expeditions`) — une expédition par transaction : transporteur, mode (domicile /
  point relais), poids et dimensions, adresses expéditeur et destinataire (JSON), point relais,
  code d'offre, prix en centimes, numéro et URL de suivi, étiquette (URL chez le prestataire ou
  PDF conservé en base pour la simulation), référence prestataire, statut (`en_creation`,
  `etiquette_prete`, `expediee`, `livree`, `echec`) et dernière erreur.
- **API** (`shipping.controller.ts`, session requise) :
  - `POST /transactions/:id/shipment/quote` — vendeur : tarifs pour le colis déclaré, sur le
    transporteur choisi par l'acheteur à l'achat ;
  - `GET /transactions/:id/shipment/relay-points?postalCode=` — vendeur : points relais ;
  - `POST /transactions/:id/shipment` — vendeur : achat de l'étiquette ; le numéro de suivi est
    reporté sur la transaction, « Confirmer l'expédition » n'exige plus de saisie ;
  - `GET /transactions/:id/shipment` — vendeur et acheteur : état, prix, suivi (jamais le PDF) ;
  - `GET /transactions/:id/shipment/label.pdf` — vendeur seul ;
  - `GET /transactions/:id/shipment/tracking` — vendeur et acheteur ; un numéro saisi à la main
    donne un suivi minimal (numéro seul).
- **Cas d'erreur sans blocage** : un refus du prestataire laisse l'expédition en `echec` avec la
  raison, répond 502 (ou 400 pour une adresse refusée, 503 si non configuré) et ne touche pas à la
  transaction ; le vendeur réessaie ou saisit son numéro de suivi comme aujourd'hui. Une seule
  étiquette par vente (409 ensuite). Rien d'exposé aux visiteurs.
- **Tests** : `test/phase18.e2e-spec.ts` (cotation par poids et droits, étiquette PDF et suivi,
  échec puis nouvel essai, remise en main propre et saisie manuelle).
- **Non fait volontairement en phase 1** : aucun écran (le parcours vendeur / acheteur, le champ
  poids et dimensions au dépôt et les tests navigateur sont la phase 2) ; le front de production
  continue d'afficher la saisie manuelle du numéro de suivi.

## 6. Plan de la phase 2 (après les clés de test)

1. `BoxtalShippingProvider` derrière `IShippingProvider` : cotation (v1 ou v3 selon ce que le
   compte expose), création d'expédition avec le code d'offre, récupération de l'étiquette (URL
   → stockée dans `labelUrl`, relayée par l'API au vendeur), suivi, points relais ; `mock` reste
   disponible pour le développement et les tests, `none` pour la production sans compte.
2. Dépôt d'annonce : champs **poids** et **dimensions** (facultatifs, valeur par défaut 1 kg /
   petit colis ; masqués pour dons, services, immobilier, emploi, locations).
3. Paiement : l'acheteur saisit son **adresse de livraison complète** (ou choisit un point relais)
   au moment de l'achat — aujourd'hui seuls la commune et le code postal existent sur le profil.
   Cette adresse remplit `recipient` ; l'adresse d'expédition du vendeur est demandée une fois puis
   mémorisée sur le profil.
4. Écran vendeur (transaction en fonds bloqués, envoi) : choix relais / domicile, tarif calculé
   automatiquement d'après le poids et les dimensions de l'annonce, bouton « Télécharger
   l'étiquette (PDF) », numéro de suivi affiché, « Confirmer l'expédition » sans ressaisie.
5. Écran acheteur (Achats et ventes) : statut d'expédition, numéro de suivi et lien de suivi,
   point relais choisi.
6. Tests navigateur : génération d'étiquette en simulation, échec de génération (message clair,
   saisie manuelle toujours possible), affichage du suivi côté acheteur.
7. Production : `SHIPPING_PROVIDER=boxtal` et les clés de **production** seulement après un envoi
   réel réussi en test ; le coût de l'étiquette est à la charge du vendeur (prélevé sur son
   versement ou payé à part : décision à prendre avant l'ouverture).

## 7. Variables d'environnement Boxtal (phase 2, comptes de test créés le 15 septembre 2026)

Deux applications existent sur le portail développeur : « transport-test » (API v1, cotation) et
« Trocoin - Test » (API v3, étiquettes, suivi, points relais). Convention du projet : préfixe du
prestataire puis rôle de la valeur (`RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `S3_ACCESS_KEY_ID`).

| Variable | Application Boxtal | Valeur à copier | Rôle |
|---|---|---|---|
| `BOXTAL_V3_ACCESS_KEY` | Trocoin - Test (API v3) | la **clé d'accès** (*access key*) affichée sur la fiche de l'application | identifiant de l'application v3 |
| `BOXTAL_V3_SECRET_KEY` | Trocoin - Test (API v3) | la **clé secrète** (*secret key*), révélée par l'icône œil ou affichée une seule fois à la création | secret de l'application v3 |
| `BOXTAL_V1_LOGIN` | transport-test (API v1) | l'**identifiant** (*login*) de l'application | authentification HTTP Basic de l'API v1 |
| `BOXTAL_V1_PASSWORD` | transport-test (API v1) | le **mot de passe** (*password*), révélé par l'icône œil | authentification HTTP Basic de l'API v1 |
| `BOXTAL_ENV` | — | `sandbox` (défaut) ; `production` seulement avec des applications de production | choix des serveurs : `api.boxtal.build` / `test.envoimoinscher.com` ou `api.boxtal.com` / `www.envoimoinscher.com` |
| `SHIPPING_PROVIDER` | — | `boxtal` | active le fournisseur (tant que la phase 2 n'est pas déployée : mêmes réponses que `none`) |

Ce qui n'est **pas** à copier : le nom ou l'identifiant numérique de l'application, l'e-mail du
compte Boxtal, le mot de passe du compte Boxtal lui-même (l'API v1 s'authentifie avec les
identifiants de l'application, pas ceux du compte).

Mécanisme (d'après le SDK public de l'API v3 et la bibliothèque PHP officielle de l'API v1,
consultés le 15 septembre 2026 ; le portail lui-même se charge en JavaScript et n'a pas pu être lu) :
- API v3 : `POST {base}/iam/account-app/token` avec `Authorization: Basic base64(accessKey:secretKey)`
  → `{ accessToken, expiresIn }`, puis `Authorization: Bearer …` sur `shipping-orders`,
  `parcel-points`, suivi ; sandbox `https://api.boxtal.build`, production `https://api.boxtal.com`.
- API v1 : `Authorization: Basic base64(login:password)` sur `api/v1/cotation` (test
  `https://test.envoimoinscher.com`, production `https://www.envoimoinscher.com`) ; en-tête
  `Api-Version`. L'hôte de test sera confirmé au premier appel réel (repli sur `api.boxtal.build`).

Le démarrage de l'API vérifie la présence des quatre identifiants quand `SHIPPING_PROVIDER=boxtal`
et refuse toute valeur de `BOXTAL_ENV` autre que `sandbox` ou `production`. Aucune de ces valeurs
n'est journalisée ni renvoyée par une route.

## 8. Phase 2 — état au 16 septembre 2026

### Livré dans le code

- `BoxtalShippingProvider` (`src/shipping/boxtal-shipping.provider.ts`) derrière `IShippingProvider`,
  `MockShippingProvider` conservé (`SHIPPING_PROVIDER=mock`, pile e2e). API v1 : cotation en `GET
  api/v1/cotation` (HTTP Basic identifiant + mot de passe de l'application, en-tête `Api-Version 1.3.7`,
  réponse XML lue sans dépendance) ; API v3 : `POST /iam/account-app/token` (Basic clé d'accès : clé
  secrète → jeton porteur mis en cache), `POST /shipping/v3.1/shipping-order` (colis en kg / cm,
  adresses, `pickupPointCode` pour un relais, étiquette `PDF_10x15`), `GET …/shipping-document`
  (téléchargement du PDF), `GET …/tracking`, `DELETE …` (annulation), `GET /shipping/v3.1/parcel-point`.
  Codes d'offre v3 : `BOXTAL_OFFER_*` s'ils sont renseignés, sinon `opérateur_service` de la cotation.
- Adresse de livraison de l'acheteur au paiement (`transactions.shippingAddress`, vue des deux
  parties, transmise au prestataire, jamais publique) ; colis déclaré au dépôt (`listings.weightGrams`,
  `lengthCm`, `widthCm`, `heightCm`, facultatifs). Ventes antérieures sans adresse : parcours manuel
  inchangé, le vendeur peut saisir l'adresse dans le panneau d'étiquette.
- Parcours vendeur (mode, colis prérempli, adresses, tarif, point relais, achat, PDF, numéro repris
  dans « Confirmer l'expédition ») et acheteur (état, numéro et lien de suivi). Erreurs du
  prestataire affichées dans le panneau, sans jamais bloquer la vente.
- `GET /shipping/diagnostic` (sandbox seulement, 5 appels / 10 min) : jeton, cotation, points relais,
  essais d'hôte et d'ordre des clés, lectures sans effet sur l'hôte de production si le sandbox refuse,
  et `?label=1` pour une commande de test avec annulation.
- Tests : `test/phase20.e2e-spec.ts` (faux Boxtal v1 + v3 : cotation, points relais, étiquette,
  suivi, annulation, erreurs typées ; adresse au paiement ; colis au dépôt) et
  `e2e/17-expedition.spec.ts` (parcours complet et échec géré, fournisseur simulé).

### Premier test réel (clés Render, 16 septembre 2026)

| Étape | Hôte sandbox | Hôte de production | Constat |
|---|---|---|---|
| Jeton v3 (clé d'accès : clé secrète) | `api.boxtal.build` → 401 | `api.boxtal.com` → **200** | les clés sont valides, mais pour l'API de production |
| Cotation v1 (identifiant + mot de passe) | `test.envoimoinscher.com` → 401 | `www.envoimoinscher.com` → **200, 27 offres** | dont Mondial Relay point relais 4,21 €, Colissimo point retrait 9,14 €, Colissimo domicile 11,04 € (colis 900 g, Lyon → Paris) |
| Points relais v3 | — | `api.boxtal.com` → **200** | relais réels autour de 75017 (lockers à 370–490 m) |
| Achat d'étiquette | non tenté | **non tenté** | une commande sur l'hôte de production est un vrai achat |

Lecture : les deux applications « transport-test » et « Trocoin - Test » ont été créées dans le
compte Boxtal ordinaire (production). Le bac à sable Boxtal est un **compte à part**, ouvert sur
`shipping.boxtal.build`, dont les applications parlent à `api.boxtal.build` /
`test.envoimoinscher.com`. Avec `BOXTAL_ENV=sandbox`, Trocoin n'achètera jamais d'étiquette sur
l'hôte de production : les formats d'échange sont validés par les lectures ci-dessus, l'achat de test
attend des clés de bac à sable.

### Deuxième test réel (compte sandbox `shipping.boxtal.build`, 16 septembre 2026, 12 h 33)

Clés d'un compte ouvert sur `shipping.boxtal.build` (Render : `BOXTAL_ENV=sandbox`, `SHIPPING_PROVIDER=boxtal`).
`GET https://api.trocoin.fr/shipping/diagnostic?label=1` :

| Étape | Hôte | Résultat |
|---|---|---|
| Jeton v3 (clé d'accès : clé secrète) | `api.boxtal.build` | **200**, jeton obtenu |
| Cotation v1 (identifiant + mot de passe) | `test.envoimoinscher.com` | **200, 23 offres** (Mondial Relay relais 5,02 €, Colissimo relais 7,86 €, Mondial Relay domicile 9,72 €, Colissimo Access 9,73 €…) |
| Points relais v3 | `api.boxtal.build` | **200**, lockers réels autour de 75017 (370–490 m) |
| Sonde des codes d'offre (`GET /shipping/v3.2/parcel-point-by-shipping-offer`) | `api.boxtal.build` | `MONR_DomicileFrance` → **400 ValidationException.ValidShippingOfferCode** ; `MONR-DomicileFrance` → **200** (idem pour POFR-ColissimoAccess, POFR-ColissimoPickupStation, MONR-CpourToi) |
| Commande d'expédition (`POST /shipping/v3.1/shipping-order`) | `api.boxtal.build` | **201** avec `MONR-DomicileFrance` : commande `2609161233MONR50HZFR`, 9,72 € TTC |
| Étiquette (`GET …/shipping-document`) | `api.boxtal.build` | **PDF de 3 508 octets** (« Test Carrier / Test Service », code-barres 2609161233MONR50HZFR, expéditeur Lyon → destinataire Paris) |
| Suivi (`GET …/tracking`) | `api.boxtal.build` | état « étiquette créée », aucun évènement |
| Annulation (`DELETE …/shipping-order/{id}`) | `api.boxtal.build` | **annulée** (rien ne reste dans le compte sandbox) |
| Listage des offres (`GET/POST /shipping/v3.x/shipping-offer`, `/contract`) | `api.boxtal.build` | 404 : l'API v3 n'expose pas les offres du compte ; elles se lisent dans le portail développeur |

**Cause de l'échec du premier essai (12 h 09) et correction** : la commande v3 était refusée
(`422 NoShippingOfferException`) parce que Trocoin construisait le code d'offre v3 à partir de la
cotation v1 avec un tiret bas (`MONR_DomicileFrance`, forme `opérateur_service` de l'API v1),
alors que l'API v3 attend `OPÉRATEUR-Service` avec un tiret (`MONR-DomicileFrance`). Le code dérivé
utilise maintenant le tiret (`rawQuote`, `boxtal-shipping.provider.ts`) ; les variables
`BOXTAL_OFFER_*` restent prioritaires si elles sont renseignées. La sonde en lecture seule et les
essais successifs de codes font désormais partie de la route de diagnostic.

**Parcours utilisateur réel (vendeur → étiquette → acheteur)** : préparé en production le 16
septembre 2026 (deux comptes de test, annonce livrable « Enceinte Bluetooth JBL Flip 6 (test
étiquette) », achat Colissimo avec adresse de livraison, transaction `5b87cd20…` en attente de
paiement). Le paiement passe par Stripe Checkout en mode test : la saisie d'une carte (même de test)
n'est pas faite par l'assistant ; une fois la transaction payée, le panneau « Étiquette d'envoi »
du vendeur achète l'étiquette sur le sandbox Boxtal et l'acheteur voit le suivi. Le parcours
lui-même est couvert par `e2e/17-expedition.spec.ts` (fournisseur simulé, mêmes écrans).

### À faire côté utilisateur pour finir le test d'achat

1. Créer un compte de test sur `shipping.boxtal.build` (distinct du compte boxtal.com).
2. Y créer une application API v3 et une application API v1, comme précédemment.
3. Remplacer sur Render `BOXTAL_V3_ACCESS_KEY`, `BOXTAL_V3_SECRET_KEY`, `BOXTAL_V1_LOGIN`,
   `BOXTAL_V1_PASSWORD` par les valeurs du compte de test (`BOXTAL_ENV=sandbox` inchangé).
4. Signaler que c'est fait : `GET /shipping/diagnostic?label=1` achètera alors une étiquette de test
   (Lyon → Paris, 900 g), téléchargera le PDF, lira le suivi et annulera la commande.

Passage en production, plus tard : garder les applications actuelles (elles fonctionnent sur
`api.boxtal.com`), mettre `BOXTAL_ENV=production`, et décider qui paie l'étiquette (prélevée sur le
versement du vendeur ou facturée à part).

## 9. Lieu de réception choisi par l'acheteur : domicile, point relais, bureau de poste, consigne (AUDIT §57)

Avant, le mode se déduisait du transporteur (« Colissimo à domicile », « Mondial Relay en point relais ») et le point
relais était choisi par le **vendeur** à l'achat de l'étiquette. Désormais l'**acheteur** choisit, au paiement, parmi
ce que le transporteur propose réellement autour de son adresse.

- `GET /shipping/pickup-options?listingId=…&postalCode=…&city=…` (membre connecté, 40 appels / 10 min) : pour Colissimo
  et Mondial Relay, `domicile` et `pointRelais` viennent de la **cotation réelle** du colis de l'annonce (offres Boxtal
  `HOME` / `PICKUP_POINT`), et `points` de la recherche de points du prestataire — jamais une liste écrite à la main.
  `city` est facultative. **Sans attente (AUDIT §61)** : une seule cotation sert les deux transporteurs, cotation et
  points sont demandés en parallèle, et les réponses sont gardées en mémoire (tarifs 10 min, points 30 min, demandes
  en cours partagées, échecs jamais gardés) — la même mémoire sert au paiement. La fiche annonce précharge ces options
  dès que le code postal de l'acheteur est connu (dernier achat ou profil) : à l'ouverture de la fenêtre, tout est là.
- Points : d'abord `GET /shipping/v3.2/parcel-point-by-shipping-offer` (points valables pour l'offre de retrait du
  transporteur — `MONR-CpourToi`, `POFR-ColissimoPickupStation`, ou `BOXTAL_OFFER_*` s'ils sont renseignés), à défaut
  `GET /shipping/v3.1/parcel-point` filtré par réseau.
- Nature de chaque point (`relais`, `bureau_poste`, `consigne`) : `classifyPickupPoint` lit le type fourni par le
  prestataire s'il existe, sinon le nom commercial publié par le transporteur (« LOCKER … », « CONSIGNE … », « PICKUP
  STATION … », « BUREAU DE POSTE … », « LA POSTE … ») ; sans indice, c'est un relais commerçant. Chez Boxtal, il n'y a
  pas d'offre « bureau de poste » ou « consigne » distincte : ce sont des **points de l'offre de retrait**, d'où le
  choix présenté à l'acheteur — « À domicile », « En point relais », « En bureau de poste / consigne automatique » —
  chacun affiché seulement s'il existe autour de son adresse.
- Le point envoyé par le navigateur est **relu chez le prestataire** avant tout paiement (`resolvePickupPoint`) : point
  inconnu → 400, aucun débit ; la fiche gardée sur la vente (`transactions.pickupPoint`) est celle du prestataire.
- À l'étiquette, le mode et le point de l'acheteur sont **imposés** (`createLabel`), le vendeur ne les change pas ; le
  panneau du vendeur les affiche. Ventes antérieures (sans `deliveryMode`) : parcours d'origine, le vendeur choisit.
- Prestataire absent ou en panne : l'achat n'est pas bloqué — les deux modes restent proposés sans liste de points, et
  le vendeur choisit le point à l'étiquette comme avant.
- `GET /shipping/diagnostic` (sandbox) gagne `nature_des_points` : noms des champs d'un point, réseaux, répartition par
  nature et exemples, pour vérifier le classement sur des données réelles.

## 10. La livraison est payée par l'acheteur ; le vendeur génère le bon d'envoi sans rien régler (AUDIT §59)

La question laissée ouverte (« qui paie l'étiquette ? ») est tranchée par le propriétaire, sur le modèle de leboncoin :
**l'acheteur paie la livraison avec son achat**, le vendeur n'avance rien.

### Parcours

1. **Acheteur** — choisit le transporteur (Colissimo ou Mondial Relay), saisit son adresse, puis le lieu de réception
   parmi ce qui existe vraiment autour de chez lui (domicile, point relais, bureau de poste, consigne). Chaque option
   affiche **son prix réel** (`domicilePriceCents`, `pickupPriceCents` de `GET /shipping/pickup-options`, cotation du
   colis de l'annonce). Le récapitulatif ajoute la ligne « Frais de livraison » et le total payé = prix + frais de
   protection + livraison. Sur la page Stripe : une troisième ligne « Frais de livraison … ».
2. **Serveur** — à la création de la vente, la livraison est **recotée** (`ShippingService.quoteForPurchase`) et figée :
   `transactions.shippingFee` (euros) et `shippingQuote` (offre, mode, poids, dimensions). Le garde-fou `expectedTotal`
   couvre aussi la livraison : si le prix affiché n'est plus le bon, 409 `QUOTE_CHANGED` et nouveau devis, aucun débit.
   Adresse exigée pour un envoi ; point de retrait exigé pour un retrait ; annonce **sans poids déclaré → envoi non
   proposé** (aucun prix ferme possible) : la remise en main propre reste possible et le dépôt exige désormais le poids
   dès que « J'accepte d'expédier » est coché.
3. **Vendeur** — voit « Livraison payée par l'acheteur : X € ». D'abord **Confirmer que l'article est disponible**, puis
   **Générer le bon d'envoi (PDF)** : il ne fournit que son adresse d'expéditeur (exigée par le transporteur). Mode, colis,
   destinataire et point de retrait viennent de la vente et ne se changent pas (`createLabel` ignore tout autre champ).
   Il imprime, colle, dépose le colis, puis « Confirmer l'expédition » (numéro repris, aucune saisie).
4. **Acheteur** — reçoit le **numéro de suivi** dès que le bon existe (message automatique « Bon d'envoi généré », fiche
   d'expédition) ; le **PDF n'est accessible qu'au vendeur** (`label.pdf` → 403 pour l'acheteur).

### Où va l'argent de la livraison

- Il est encaissé avec le reste du paiement et **reste chez Trocoin**, dont le compte Boxtal règle le bon d'envoi. Il
  n'entre ni dans la commission, ni dans les frais de protection, ni dans le versement au vendeur (toujours prix −
  commission).
- **Sans marge** : le prix affiché est celui du prestataire, au centime. (Une marge ou un arrondi serait un réglage
  d'une ligne ; non retenu sans demande.)
- Remboursement (annulation avant l'envoi, délai dépassé, décision du médiateur) : **intégral, livraison comprise** —
  un seul paiement, un seul remboursement. Si le bon d'envoi a déjà été généré, il est annulé chez le prestataire quand
  celui-ci le permet (`cancelLabelFor`, au mieux) ; sinon son coût reste à la charge de Trocoin.

### Risques assumés, à surveiller

| Risque | Conséquence | Parade en place |
|---|---|---|
| Colis réel plus lourd que le poids déclaré | le transporteur peut refacturer l'écart au compte Boxtal de Trocoin | poids exigé au dépôt, affiché au vendeur sur le bon (« colis de N g ») ; écart constaté → journal `WARN` |
| Prix du bon supérieur au prix payé (tarif qui bouge entre l'achat et la génération) | écart à la charge de Trocoin | journal `WARN` avec les deux montants ; délai d'expédition de 7 jours |
| Frais Stripe sur la part livraison (≈ 1,5 %) | quelques centimes par vente à la charge de Trocoin | aucun (négligeable ; une marge les couvrirait) |
| Vendeur qui expédie par ses propres moyens | la livraison payée ne sert pas | la saisie manuelle d'un numéro n'est plus qu'un secours replié, avec avertissement ; cas à régler à la main |
| Prestataire en panne | pas de prix ferme | l'envoi n'est pas proposé tant que la cotation échoue (la main propre reste possible) |

Ventes antérieures (sans `shippingQuote`) : parcours d'origine inchangé (le vendeur choisit mode, colis et point).

**Avant l'ouverture réelle** : la production utilise encore le **bac à sable Boxtal** (bons d'envoi factices « Test
Carrier ») et Stripe en mode test. Passer `BOXTAL_ENV=production` avec un compte Boxtal approvisionné est nécessaire
pour que les bons d'envoi soient valables — décision et clés du ressort du propriétaire.
