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
| 12 | Données structurées : `Product` + `Offer` sur les fiches | en place | nom, description, images, catégorie, prix EUR, disponibilité (`InStock` / `SoldOut`), état (`NewCondition` / `UsedCondition`), vendeur |
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
