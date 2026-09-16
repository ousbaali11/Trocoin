# Audit final de Trocoin — 16 septembre 2026

Passage complet sur **toutes** les pages du site (routing réel de `frontend/src/app`) et sur **toutes** les routes de l'API (contrôleurs NestJS), avec des tests réels sur la pile locale : bureau 1280 px et mobile 375 px, anonyme, acheteur, vendeur, professionnel et administrateur. Résultats du crawl automatisé (erreurs console et exceptions JS, réponses réseau en échec, défilement horizontal, marges mobiles, liens internes morts, unicité du h1, capture d'écran de chaque page) croisés avec une revue manuelle des captures (planches contact) et une relecture du code. Ce document est tenu à jour à chaque livraison ; le bilan chiffré est dans `AUDIT.md` §42.

## 1. Inventaire et statut page par page

46 routes front testées, 122 chargements (rôles × écrans). Statut design : **conforme** = respecte `docs/design-system.md` ; **corrigé** = écart trouvé et corrigé dans ce tour ; **à revoir** = reporté.

| Route | Rôles testés | Bugs / constats (avant) | Corrections | Design / organisation | Constats restants après correction |
|---|---|---|---|---|---|
| `/` | anonyme, acheteur | Compteur « 1 annonces en ligne » (pluriel) ; grille « dernières annonces » presque vide sur un site jeune | Pluriel corrigé ; carte d'invitation « Vendez le vôtre » quand moins de 4 annonces ; bandeau de réassurance sous la recherche | corrigé | aucun |
| `/recherche` | anonyme | Mobile : filtres rapides empilés sur trois lignes ; carte : lieu réduit à rien à côté de « Livraison » | Filtres rapides sur une ligne défilante ; largeur minimale du lieu, l'étiquette passe à la ligne | corrigé | aucun |
| `/annonces/[id]` | anonyme, acheteur | Aucun (fiche revue au §33) ; annonce inconnue → page 404 dédiée | — | conforme | carrousel « annonces similaires » / « autres annonces du vendeur » : bande défilante horizontale (faux positif du contrôle automatique — aucun défilement de page, cartes accessibles par glissement) |
| `/vendeurs/[id]` | anonyme | Aucun | — | conforme | aucun |
| `/a-propos` | anonyme | Aucun | — | conforme | aucun |
| `/accessibilite` | anonyme | Aucun | — | conforme | aucun |
| `/aide` | anonyme | Aucun | — | conforme | aucun |
| `/aide/[slug]` | anonyme | Aucun | — | conforme | aucun |
| `/cgu` | anonyme | Aucun | — | conforme | aucun |
| `/confidentialite` | anonyme | Aucun | — | conforme | aucun |
| `/mentions-legales` | anonyme | Contenu encore en gabarit ([Raison sociale]…) | à compléter par l'éditeur (CMS admin) | conforme | aucun |
| `/connexion` | anonyme | Aucun | — | conforme | aucun |
| `/connexion/sms` | anonyme | Aucun (même écran que la connexion classique : le SMS reste différé) | — | conforme | aucun |
| `/inscription` | anonyme | Aucun | — | conforme | aucun |
| `/mot-de-passe-oublie` | anonyme | Aucun | — | conforme | aucun |
| `/reinitialiser` | anonyme | Aucun (jeton invalide : message clair) | — | conforme | aucun |
| `/confirmer-email` | anonyme | Jeton invalide : message d'erreur brut de validation (« La valeur de le champ token n'est pas valide ») | à revoir (message dédié) — mineur | conforme | aucun |
| `/deposer` | anonyme, acheteur, vendeur | Anonyme : redirection vers la connexion ; connecté : aucun | — | conforme | aucun |
| `/compte` | anonyme, acheteur, vendeur | Mobile : bandeau « confirmez votre e-mail » répété sur chaque page, très encombrant | Bandeau compact sur mobile (détail masqué, bouton conservé) | corrigé | aucun |
| `/compte/annonces` | acheteur, vendeur | Aucun | — | conforme | aucun |
| `/compte/annonces/[id]/modifier` | vendeur | Aucun | — | conforme | aucun |
| `/compte/avis` | acheteur | État vide différent des autres listes (paragraphe dans un panneau) | Composant EmptyState commun, avec action « Voir mes achats et ventes » | corrigé | aucun |
| `/compte/boutique` | vendeur | Mobile : champ fichier natif dépasse ; champ natif hors charte | Bouton « Choisir un fichier » (nom du fichier affiché), champ contraint | corrigé | aucun |
| `/compte/favoris` | acheteur | Aucun | — | conforme | aucun |
| `/compte/formule` | acheteur | Aucun | — | conforme | aucun |
| `/compte/historique` | acheteur | Aucun | — | conforme | aucun |
| `/compte/messages` | acheteur | Annonce supprimée : titre vide | « Cette annonce n'existe plus » (§41) | conforme | aucun |
| `/compte/messages/[id]` | acheteur, vendeur | Mobile : bouton « Envoyer » hors écran (4 éléments sur une ligne non réductibles) | Champ de saisie réductible, libellé « Proposer un prix » masqué sous 480 px (icône + aria-label) | corrigé | aucun |
| `/compte/notifications` | acheteur | Mobile : la date pousse le texte hors écran (débordement 385 px) | Grille étiquette / contenu / date, date sous le contenu sur mobile | corrigé | aucun |
| `/compte/paiements` | acheteur, vendeur | Aucun | — | conforme | aucun |
| `/compte/parametres` | acheteur | Couleur codée en dur (#ecc7bb) sur la zone de suppression | Jeton var(--brick-tint) | corrigé | aucun |
| `/compte/recherches` | acheteur | Aucun | — | conforme | aucun |
| `/compte/transactions` | acheteur | Aucun | — | conforme | aucun |
| `/compte/transactions/[id]` | acheteur, vendeur | Requête d'étiquette en 404 (erreur console) sur toute vente sans étiquette ; texte « acheteur remboursé » sur un paiement jamais finalisé | GET /transactions/:id/shipment renvoie 200 vide ; texte de clôture selon le cas (non finalisé / autorisation libérée / remboursé) | conforme | aucun |
| `/admin` | anonyme, acheteur, admin | Aucun | — | conforme (thème propre §9) | aucun |
| `/admin/annonces` | admin | Mobile : tableau élargit toute la page | Tableaux en défilement interne, conteneur principal min-width 0 | corrigé | aucun |
| `/admin/annonces/[id]` | admin | Aucun | — | conforme | aucun |
| `/admin/journal` | admin | Mobile : tableau élargit la page (bug 500 traité au §41) | idem tableaux | corrigé | aucun |
| `/admin/litiges` | admin | Aucun | — | conforme | aucun |
| `/admin/litiges/[id]` | admin | Aucun | — | conforme | aucun |
| `/admin/pages` | admin | Aucun | — | conforme | aucun |
| `/admin/reglages` | admin | Mobile : tableau des formules (champs) élargit la page | idem tableaux | corrigé | aucun |
| `/admin/signalements` | admin | Aucun | — | conforme | aucun |
| `/admin/utilisateurs` | admin | Mobile : tableau élargit la page ; filtre « supprimés » sans objet depuis §41 | idem tableaux ; filtre retiré | corrigé | aucun |
| `/admin/utilisateurs/[id]` | admin | Mobile : tableau des annonces élargit la page | idem tableaux | corrigé | aucun |
| `/page-inexistante` | anonyme | Aucun (page 404 dédiée) | — | conforme | aucun |

## 2. Sécurité (relecture des routes de l'API)

Inventaire généré depuis les contrôleurs (142 routes) : gardes, throttling, DTO. Toutes les routes sans garde sont des lectures publiques (catégories, recherche, fiche, profil public, avis publics, aide), les routes d'authentification (limitées par IP), le webhook Stripe (signature vérifiée) et les routes `/dev` (module absent en production).

| Point | Constat | Action |
|---|---|---|
| Autorisations (IDOR) | Balayage automatisé (`test/phase27.e2e-spec.ts`) : transactions, expédition, annonces, messagerie, recherches sauvegardées, notifications, console admin — un tiers connecté est refusé partout, un anonyme reçoit 401 | 2 routes répondaient 200 sans effet à un tiers (`DELETE /conversations/:id`, `POST /notifications/:id/read`) : elles répondent désormais 404 / 403 explicites |
| Validation côté serveur | `ValidationPipe` global (`whitelist`, `transform`), un DTO par corps et par query ; `ParseUUIDPipe` sur tous les identifiants | conforme |
| Rate limiting | Throttle global 100 / min / IP + limites dédiées (inscription, connexion, OTP, e-mails, annonces, messages, images, offres, transactions, étiquettes, export, onboarding Stripe) ; nouvelles routes : étiquettes (devis 60 / 10 min, achat 20 / 10 min), stats « mine/stats » (global), admin (global, derrière AdminGuard) | `POST /listings/:id/phone` (« Voir le numéro ») n'avait pas de limite dédiée : 30 / heure ajoutés (anti-collecte de numéros) |
| Secrets côté client | Seules `NEXT_PUBLIC_API_URL` et `NEXT_PUBLIC_SITE_URL` sont exposées ; aucune clé Stripe / Resend / base dans le bundle ; en-têtes `X-Frame-Options: DENY`, `noindex` sur l'admin | conforme |
| Nouvelles fonctionnalités | statistiques par annonce (propres au vendeur), séquestre plateforme (décisions calculées côté API, références Stripe jamais renvoyées au membre), suppression définitive (motif + SUPPRIMER, refus si vente expédiée / litige), journal d'audit (admin seulement, lecture seule) | conforme, couverts par phase 23 → 27 |
| Divers | `GET /transactions/:id/shipment` répondait 404 sur toute vente sans étiquette (bruit console, faux signal d'erreur) | 200 avec corps vide |

## 3. Design et cohérence visuelle

- Revue des 50 pages bureau et 51 pages mobile sur planches contact : mêmes en-tête, pied de page, titres Fraunces, panneaux `--radius`, boutons pilule, palette des jetons. Les pages anciennes (à propos, aide, juridique, connexion, inscription) sont dans la charte.
- Écarts corrigés : couleur codée en dur (paramètres), rayons hors grille (carte aperçu 12 → `--radius`, carte géographique 12 → `--radius`), champ fichier natif (boutique), état vide des avis, bandeau e-mail sur mobile.
- Écarts restants, volontaires : back-office sur son thème propre (`design-system.md` §9) ; tuiles photo du dépôt à 8 px (grille interne).
- Mobile (règle des 12 px) : 4 débordements réels trouvés et corrigés (messagerie, notifications, boutique, tableaux admin) ; toutes les autres pages passent le contrôle automatique des marges.

## 4. Organisation et rangement

- **Actions principales / secondaires** : un seul bouton plein par écran (accent), secondaires en contour : vérifié sur l'accueil, la recherche, la fiche, le dépôt, les pages du compte, la messagerie, la transaction, la console. Aucun écran avec deux accents.
- **Catégories** : une seule source, `GET /categories/tree` (barre de familles, tuiles de l'accueil, mega-menu, dépôt, filtres, sitemap) : cohérentes par construction ; 12 familles, sous-catégories identiques partout.
- **Listes** : Mes annonces, Messages, Favoris, Historique, Recherches, Notifications, Transactions, Avis partagent le même trio (squelette de chargement, `EmptyState` avec action, tri du plus récent) ; les listes admin partagent filtres + pagination `AdminPager`. Avis ramené dans le rang.
- **Formulaires** : libellés et regroupements revus (inscription, dépôt en 5 étapes, paramètres, boutique) ; le champ fichier de la boutique était le seul hors charte.

## 5. Attractivité : les points à plus fort impact

1. **Accueil sur un site jeune** : une grille « dernières annonces » presque vide (1 annonce en production) — corrigé par la carte d'invitation « Vendez le vôtre » et le bandeau de réassurance (paiement conservé jusqu'à la réception, messagerie, modération) sous la recherche.
2. **Photos** : les cartes sans photo (« Pas de photo ») dominent tant que le catalogue est petit ; rien à corriger côté code, mais les premières annonces réelles avec photos comptent plus que tout le reste — à traiter par le contenu.
3. **Pluriel et micro-textes** : « 1 annonces en ligne » corrigé ; textes de clôture de transaction corrigés (rien n'est « remboursé » quand rien n'a été débité).
4. **Recherche mobile** : filtres rapides sur une ligne défilante (au lieu de trois lignes) pour que les résultats apparaissent sans défiler.
5. **Pour un tour séparé** : une accroche de marque au-dessus de la recherche (illustration ou photo, promesse en une phrase) et une rangée « annonces près de chez vous » géolocalisée sur l'accueil.

## 6. Paiement (Stripe et PayPal)

- **Frais** : un seul calcul, côté API (`computeQuote` : frais acheteur 5 % + 0,50 € plafonnés à 15 €, commission vendeur 8 %) ; le front n'additionne rien lui-même (devis avant achat, page transaction acheteur / vendeur, admin, page Paiements, aide) — vérifié par grep et par les tests (phase 24 : 92 € virés pour 100 €).
- **Erreurs de paiement** : carte refusée → message de Stripe sur la page Checkout, l'acheteur y reste ; retour « Annuler » → « Paiement annulé : rien n'a été débité » ; session expirée (30 min) → transaction « Annulée », texte « Paiement non finalisé : rien n'a été débité » (corrigé) ; service indisponible → 503 avec le code d'erreur du fournisseur (§40) ; PayPal absent tant que Stripe ne l'a pas activé (aucune erreur, le bouton n'apparaît pas).
- **PayPal** : activation « place de marché » toujours **en attente** côté Dashboard Stripe au 16 septembre (page Checkout de test : Carte, Klarna, Satispay — voir §40).
- **Séquestre plateforme** : affiché sur la transaction acheteur (« Paiement encaissé par Trocoin le… », « Expédition à faire avant le… », « Fonds versés au vendeur le… »), vendeur (versement en attente si compte absent) et admin (modèle, encaissement, virement, échéance) — captures §39, scénarios rejoués.
