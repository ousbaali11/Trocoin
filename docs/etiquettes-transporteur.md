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
