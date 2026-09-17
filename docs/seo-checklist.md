# Préparation à Google Search Console — état du site

Date : 16 septembre 2026. La vérification de propriété (enregistrement DNS chez OVH) est faite par
l'utilisateur ; ce document tient l'état technique de ce que Google explorera sur
`https://www.trocoin.fr`. Statuts : **en place** (déjà là avant ce tour), **ajouté** (ce tour),
**non pertinent** (avec la raison). Chaque ligne est vérifiable en production par l'adresse citée.

| # | Point | Statut | Détail et preuve |
|---|---|---|---|
| 1 | Sitemap : accueil, recherche, catégories (familles et sous-catégories), pages statiques et aide | en place | `www.trocoin.fr/sitemap.xml` : accueil, `/recherche`, 12 familles + 59 sous-catégories, `/aide` et ses articles, À propos, CGU, Confidentialité, Mentions légales |
| 2 | Sitemap : page Accessibilité | ajouté | `/accessibilite` manquait |
| 3 | Sitemap : toutes les fiches d'annonces en ligne, avec `lastmod` | ajouté | avant : 50 annonces au plus, sans date ; maintenant : pagination par 50 jusqu'à 2 000 annonces (limite prudente, un sitemap accepte 50 000 URL), `lastmod` = date de dernière modification de l'annonce, les plus récentes d'abord |
| 4 | Sitemap : mise à jour automatique à la publication ou au retrait d'une annonce | en place | généré à la demande (`force-dynamic`), l'API ne renvoie que les annonces en ligne ; cache de 10 min sur la liste : une annonce publiée, vendue ou retirée apparaît ou disparaît sous 10 min, sans action |
| 5 | Sitemap : exclusion des pages privées | en place | aucune adresse `/compte/*`, `/connexion`, `/deposer`, `/admin` n'est produite |
| 6 | `robots.txt` : exploration des pages publiques | en place | `Allow: /` |
| 7 | `robots.txt` : blocage des pages privées | ajouté (complété) | déjà `/admin`, `/compte` (messages, paramètres, achats…), `/connexion`, `/deposer` ; ajoutés `/mot-de-passe-oublie`, `/reinitialiser`, `/confirmer-email`. Pas de panier sur Trocoin (achat direct depuis la fiche) |
| 8 | `robots.txt` : adresse complète du sitemap | en place | `Sitemap: https://www.trocoin.fr/sitemap.xml` (domaine canonique forcé en production depuis la bascule, §23 de l'audit) |
| 9 | Titres et descriptions uniques : pages de catégorie | en place | `<title>` « {Catégorie} : annonces d'occasion ({Famille}) », description propre à la catégorie, canonique `/recherche?category={slug}` ; recherches par mot-clé en `noindex` |
| 10 | Titres et descriptions uniques : fiches d'annonces | en place, longueur ajustée | `<title>` « {titre} — {prix} », description = 155 premiers caractères de l'annonce, canonique `/annonces/{id}` ; **ajouté** : titre coupé à 60 caractères avec « … » (les titres vont jusqu'à 150) |
| 11 | Titres et descriptions : autres pages | en place | accueil, aide (par article), pages légales, profils vendeurs (« {nom} — n annonces ») ; scénario `10-seo` vérifie l'unicité titre + description sur 10 pages |
| 12 | Données structurées : `Product` + `Offer` sur les fiches | en place, complété le 17/09/2026 | nom, description, images, catégorie, prix EUR, disponibilité (`InStock` / `SoldOut`), état (`NewCondition` / `UsedCondition`), vendeur, **`shippingDetails`** et **`hasMerchantReturnPolicy`** réels ; `gtin`, `brand`, `review`, `aggregateRating` volontairement absents (voir « Alertes Search Console sur les données structurées ») |
| 13 | Données structurées : `BreadcrumbList` sur les fiches | en place | Accueil › Famille › Catégorie › Annonce |
| 14 | Données structurées : `BreadcrumbList` sur les pages de catégorie | ajouté | Accueil › Famille (› Sous-catégorie), rendu côté serveur sur `/recherche?category=…`, cohérent avec le fil d'Ariane affiché |
| 15 | Données structurées : `Organization` (et `WebSite`) sur l'accueil | en place | nom, URL, logo ; `WebSite` avec l'action de recherche |
| 16 | Statut 404 réel pour une annonce inexistante ou supprimée | en place | `www.trocoin.fr/annonces/00000000-0000-4000-8000-000000000000` → 404 (page « introuvable » servie avec le code 404) ; l'API répond 404 pour une annonce supprimée ou en attente, et 200 avec `noindex` + `SoldOut` pour une annonce vendue ou expirée (fiche conservée pour les liens partagés) |
| 17 | Redirections sans boucle ni statut inattendu | en place | `http://trocoin.fr/…` → 308 `https://trocoin.fr/…` → 308 `https://www.trocoin.fr/…` (2 sauts, final 200) ; `trocoin.vercel.app/…` → 308 `www.trocoin.fr/…` ; `/connexion/sms` → 307 `/connexion` |
| 18 | Canoniques et Open Graph sur le domaine | en place | `metadataBase` = `https://www.trocoin.fr` ; canonique sur l'accueil, les catégories, les fiches, les profils, les articles d'aide |
| 19 | Vitesse et affichage mobile | en place | aucune régression vue pendant ce tour : marges ≥ 12 px et absence de défilement horizontal vérifiées à 360 / 375 / 390 / 414 px par le scénario 11 à chaque CI ; pages statiques et catégories servies depuis le cache Vercel |
| 20 | Indexation des profils vendeurs | en place | `/vendeurs/{id}` indexable, titre et description propres ; `/admin` en `X-Robots-Tag: noindex` |

## Ce qui reste à faire par l'utilisateur

1. Vérifier la propriété du domaine dans Search Console (enregistrement DNS chez OVH).
2. Soumettre `https://www.trocoin.fr/sitemap.xml` dans Search Console (Sitemaps).
3. Après quelques jours, lire les rapports « Pages » (raisons de non-indexation) et « Données
   structurées » (Produits, Fil d'Ariane) ; toute erreur remontée est à traiter dans le code.

## Comment vérifier

```bash
curl -s https://www.trocoin.fr/robots.txt
curl -s https://www.trocoin.fr/sitemap.xml | grep -c "<loc>"
curl -s -o /dev/null -w "%{http_code}\n" https://www.trocoin.fr/annonces/00000000-0000-4000-8000-000000000000
curl -s "https://www.trocoin.fr/recherche?category=velos" | grep -o '<script type="application/ld+json">[^<]*'
```

## Recherche du nom « Trocoin » : ce qui est contrôlable et ce qui ne l'est pas

Mis à jour le 16 septembre 2026.

**Pas activable techniquement, ne pas le redemander au code :**
- Les **liens de site** (sitelinks) sous le premier résultat : Google les génère seul, à partir de la
  structure du site et de la popularité de ses pages, quand la marque est recherchée souvent. Aucune
  balise ne les déclenche ; il n'existe plus de réglage dans Search Console pour les demander.
- L'**encadré de connaissance** (fiche à droite avec logo, description, réseaux) : il vient du
  graphe de connaissances de Google, alimenté par des sources externes (Wikipédia, Wikidata, presse,
  profils officiels). Il dépend de la notoriété, pas du site.

**Fait, parce que c'est sous contrôle :**
| Point | Statut | Détail |
|---|---|---|
| `WebSite` + `SearchAction` sur l'accueil | en place | cible `/recherche?q={search_term_string}` : si Google l'affiche un jour, la barre de recherche du résultat mène bien à la recherche Trocoin |
| `Organization` sur l'accueil | ajusté | nom exact, URL, **logo PNG 512 × 512** (`/logo.png`, le `.ico` ne convenait pas), description ; **pas de `sameAs`** tant qu'aucun profil public sur un réseau social n'existe (rien d'inventé) |
| Titre et description de l'accueil pour une recherche « trocoin » | ajusté | `Trocoin — Les petites annonces entre voisins, en France` (55 caractères) ; description de 149 caractères qui décrit ce que fait le site (achat, vente, don, échange, paiement sécurisé, messagerie) |
| Nom de marque dans le titre des autres pages | en place | modèle `%s · Trocoin` |

Ce qui aide, hors code : des pages citées ailleurs (annuaires, presse, partenaires), un profil
officiel par réseau social utilisé réellement (à ajouter ensuite en `sameAs`), et la propriété
vérifiée dans Search Console pour suivre les requêtes sur la marque.

## Alertes Search Console sur les données structurées `Product` (17 septembre 2026, AUDIT §52)

Google a signalé par e-mail des champs manquants dans le balisage `Product` / `Offer` des fiches. Ce sont des
alertes **non critiques** : les pages restent indexées et éligibles. Règle suivie : ne publier que ce qui est
vrai et visible sur la page ; ne jamais fabriquer une donnée pour faire disparaître une alerte. Le balisage est
construit par `frontend/src/lib/listing-jsonld.ts` ; la page affiche le même contenu dans l'encart « Livraison
et retours ».

### Champs corrigés

| Champ | Ce qui est publié | D'où vient la donnée |
|---|---|---|
| `offers.shippingDetails`, annonce en **remise en main propre seule** | `{"@type":"OfferShippingDetails","doesNotShip":true,"shippingDestination":{"@type":"DefinedRegion","addressCountry":"FR"}}` et `availableDeliveryMethod: OnSitePickup` | la case « Livraison possible » non cochée par le vendeur |
| `offers.shippingDetails`, annonce **livrable** | destination `FR` ; `deliveryTime` : `handlingTime` 0 à 7 jours, `transitTime` 2 à 4 jours ; `availableDeliveryMethod: [OnSitePickup, ParcelService]` | règles réelles de la plateforme : le vendeur a 7 jours pour expédier (séquestre, `ESCROW_SHIP_DEADLINE_DAYS`), transport Colissimo (2 jours) ou Mondial Relay (4 jours) |
| `shippingRate`, annonce livrable **dont le vendeur a déclaré le poids** | `{"@type":"MonetaryAmount","currency":"EUR","minValue":…,"maxValue":…}` : fourchette entre l'offre la moins chère et la plus chère pour ce poids | grille indicative des transporteurs proposés (`src/shipping/indicative-rates.ts`) appliquée au poids déclaré ; la page dit « Envoi estimé entre … et …, à convenir avec le vendeur » |
| `shippingRate`, annonce livrable **sans poids déclaré** | **absent** | le coût n'est pas connu (« frais d'envoi à convenir avec le vendeur ») : aucune valeur n'est inventée. L'alerte « shippingRate manquant » peut donc subsister sur ces fiches, et c'est assumé. |
| `offers.hasMerchantReturnPolicy`, vendeur **particulier** | `{"@type":"MerchantReturnPolicy","applicableCountry":"FR","returnPolicyCategory":"https://schema.org/MerchantReturnNotPermitted"}` | vraie politique : pas de droit de retour ni de rétractation entre particuliers (la page le dit, et rappelle le litige possible avec le paiement sécurisé) |
| `offers.hasMerchantReturnPolicy`, vendeur **professionnel** | **absent** | ses propres conditions et le droit de rétractation légal de 14 jours s'appliquent ; Trocoin ne connaît pas sa politique et ne la déclare pas à sa place |
| Familles qui ne sont pas des biens (immobilier, emploi, services, vacances) | ni `shippingDetails` ni `hasMerchantReturnPolicy` | une offre d'emploi ou une location ne s'expédie pas et ne se « retourne » pas : ces champs n'ont pas de sens |

### Champs laissés vides volontairement

| Champ réclamé | Décision | Pourquoi |
|---|---|---|
| Identifiant global : `gtin`, `gtin8/12/13/14`, `mpn`, `brand` | **laissé vide, définitivement** | Trocoin est une place de marché d'occasion entre particuliers : chaque annonce est un objet unique, sans code-barres normalisé, souvent sans marque identifiable (meuble ancien, lot de vêtements, vélo d'occasion). Le champ ne s'applique pas structurellement, comme sur les sites comparables de petites annonces. Inventer un GTIN ou une marque serait une fausse donnée produit, contraire aux consignes de Google sur les données structurées. `sku` porte l'identifiant interne de l'annonce, ce qui est exact. |
| `review`, `aggregateRating` | **laissé vide tant qu'il n'existe pas d'avis par article** | Trocoin n'a pas de notation par article : seulement une réputation **par vendeur** (avis reçus après une vente, taux de réponse), affichée sur son profil. Publier une note ou un nombre d'avis sur un `Product` reviendrait à attribuer à l'article des avis qui portent sur une personne, ou à en fabriquer : Google traite cela comme du contenu trompeur (action manuelle possible). Si des avis par article existent un jour, le champ sera rempli avec ces vraies données, pas avant. |

Un test navigateur (`e2e/10-seo.spec.ts`) vérifie le balisage des deux cas de livraison et échoue si l'une des
clés `gtin*`, `mpn`, `brand`, `review` ou `aggregateRating` apparaît dans le `Product`.

Après déploiement : dans Search Console → Améliorations → « Extraits de produits » / « Fiches de marchand »,
lancer « Valider la correction » sur les alertes `shippingDetails` et `hasMerchantReturnPolicy`. Les alertes sur
l'identifiant global et les avis resteront affichées comme « améliorations facultatives » : c'est attendu.

