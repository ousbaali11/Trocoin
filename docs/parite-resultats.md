# Contrôle de parité Trocoin / leboncoin — 15/09/2026

Script : `node scripts/audit-parite.js`. Sources : **PROD** = production publique sans connexion ; **LOCAL** = pile construite à partir du même commit avec le seed e2e (aucun compte de test n'écrit en production).

**Bilan : 36 points contrôlés — 32 équivalents, 2 partiels, 1 manquant(s), 1 non pertinents (choix produit).**

| # | Section | Point | Statut | Preuve | Source |
|---|---|---|---|---|---|
| 1 | Non connecté | Accueil : recherche « Quoi ? / Où ? », raccourcis, familles | équivalent | GET / → QUOI ?/OÙ ? présents, raccourcis présents | PROD |
| 2 | Non connecté | Familles et sous-catégories | équivalent | GET /categories/tree → 12 familles, 59 sous-catégories | PROD |
| 3 | Non connecté | Suggestions et correction pendant la frappe | équivalent | GET /listings/suggest?q=velo → 200, 0 suggestion(s) ; communes et recherches récentes ajoutées côté navigateur (spec 15) | PROD |
| 4 | Non connecté | Localisation : autour de moi, commune + rayon, toute la France, arrondissements | équivalent | page /recherche → 200 ; composant LocationPicker (9 paliers, 5 km par défaut, arrondissements groupés, récents) vérifié par les scénarios 01 et 08 | PROD |
| 5 | Non connecté | Filtres : prix, état, date, livraison, photo, particulier/pro, urgentes, type de prix, spécifiques par famille | équivalent | GET /listings avec 9 filtres combinés → 200 (total 0) ; « Étendre à la livraison » et compteurs par vendeur ajoutés (§6) | PROD |
| 6 | Non connecté | Tri : pertinence, récentes, anciennes, prix ↑↓, distance | équivalent | 5 tris → 200/200/200/200/200 (distance testé avec lat/lng par le scénario 01) | PROD |
| 7 | Non connecté | Pagination numérotée | équivalent | GET /listings?page=2 → 200, page 2 ; composant Pagination (Précédent / numéros / Suivant) | PROD |
| 8 | Non connecté | Vue carte | équivalent | onglet Liste / Carte sur /recherche (Leaflet), scénario 07 « panneau de localisation » | PROD |
| 9 | Non connecté | Cartes : photo, titre, prix, lieu, date, badges, cœur, note du vendeur | partiel | aucune annonce en ligne en production pour vérifier une carte | PROD |
| 10 | Non connecté | Fiche annonce, partage, signalement | équivalent | vérifiés sur la pile locale (scénarios 05, 07, 14) ; aucune annonce en ligne en production au moment du contrôle | LOCAL |
| 11 | Non connecté | Aperçu rapide d'une annonce | équivalent | clic long à la souris sur une carte → boîte d'aperçu (spec 15, ajouté ce tour) | LOCAL |
| 12 | Non connecté | Page statique : Centre d'aide | équivalent | GET /aide → 200 | PROD |
| 13 | Non connecté | Page statique : CGU | équivalent | GET /cgu → 200 | PROD |
| 14 | Non connecté | Page statique : Confidentialité | équivalent | GET /confidentialite → 200 | PROD |
| 15 | Non connecté | Page statique : Mentions légales | équivalent | GET /mentions-legales → 200 | PROD |
| 16 | Non connecté | Page statique : Accessibilité | équivalent | GET /accessibilite → 200 | PROD |
| 17 | Non connecté | Bons plans, crédit, financement, Protection Panne, publicité tierce | non pertinent | services partenaires / régie : hors périmètre (choix produit, §3 et §6 point 10) | PROD |
| 18 | Non connecté | Bas de page de catégorie : recherches suggérées, villes, fil d'Ariane | équivalent | GET /listings/discover?category=velos → 200, 22 suggestions, 24 villes | PROD |
| 19 | Non connecté | Panneau « Tous les filtres » (ordre, compteurs, Tout effacer / Rechercher (N), volet mobile) | équivalent | GET /listings/facets → 200 {"total":0,"particulier":0,"professionnel":0} ; structure vérifiée par le scénario 14 (bureau + mobile) | PROD |
| 20 | Non connecté | Pied de page structuré | équivalent | accueil : colonnes À propos / Informations légales / Nos solutions pros / Des questions ? présentes ; applications, réseaux, avis externes volontairement omis | PROD |
| 21 | Non connecté | Mega-menu des familles (barre + menu « Catégories ») | équivalent | production dans Chromium : barre des familles 12 boutons, menu « Catégories » 71 entrées (familles et sous-catégories) ; accordéon dans le menu mobile | PROD |
| 22 | Non connecté | Filtres essentiels puis « Plus de filtres » en accordéon | équivalent | production : bouton « Plus de filtres » présent sur /recherche?category=velos (sections mémorisées pour la session, scénario 14) | PROD |
| 23 | Connecté | Tableau de bord (statistiques, dernières annonces, messages, transactions, notifications) | équivalent | GET /listings/mine/stats → 200 ; page /compte (scénario 07 axe) | LOCAL |
| 24 | Connecté | Dépôt : catégorie suggérée, champs par catégorie, photos réordonnables, prix, localisation, aperçu, brouillon, barre de progression | équivalent | scénarios 04 (voiture + vacances), 08 (clavier), 15 (progression, catégorie suggérée, estimation, checklist) | LOCAL |
| 25 | Connecté | Gestion des annonces : modifier, renouveler, dupliquer, pause, vendue, statistiques, mise en avant, actions groupées | équivalent | GET /listings/mine → 200 (5 annonces) ; routes PATCH/renew/duplicate/promote/bulk (phases 2, 17) ; page Mes annonces (spec 15) | LOCAL |
| 26 | Connecté | Messagerie temps réel, réponses rapides, photos, offres, « Vu », « en train d'écrire », suppression | équivalent | GET /conversations → 200 ; WebSocket + suppression (scénarios 05 et 13, phases 12 et 16) | LOCAL |
| 27 | Connecté | Favoris, recherches sauvegardées avec alertes, annonces consultées | équivalent | favoris 200, recherches 200, historique 200 | LOCAL |
| 28 | Connecté | Notifications et préférences par évènement et canal | équivalent | unread-count 200, préférences 5 familles × 3 canaux | LOCAL |
| 29 | Connecté | Paramètres : profil, identifiants, e-mail confirmé et changeable, mot de passe, 2FA, appareils connectés, export RGPD, suppression | équivalent | GET /auth/sessions → 200 (4 session(s)) — section « Appareils connectés » ajoutée ce tour (elle manquait alors que le comparatif la disait présente) ; export et suppression : phases 10-11 | LOCAL |
| 30 | Connecté | Paiement sécurisé (fonds bloqués), remise en main propre par code, suivi d'envoi | équivalent | GET /transactions/quote → 200, total acheteur 905 € (frais 15 €) ; Stripe Checkout en capture différée, code à 6 chiffres, suivi (phase 13, scénario 05) ; clés réelles différées (§7 point 11) | LOCAL |
| 31 | Connecté | Avis après transaction, historique achats/ventes, litiges avec médiation | équivalent | scénario 05 (réception confirmée, avis) ; console d'administration pour les litiges (scénario 06) | LOCAL |
| 32 | Connecté | Badges : Pro, Identité vérifiée, Réactif | partiel | Pro et Identité vérifiée affichés (cartes, fiche) ; « Réactif » différé : le taux de réponse est calculé (responseRate) mais aucun badge n'est affiché | LOCAL |
| 33 | Connecté | Blocage d'un utilisateur | équivalent | GET /users/me/blocks → 200 | LOCAL |
| 34 | Connecté | Étiquettes transporteur intégrées | manquant | aucun partenariat transporteur : numéro de suivi saisi à la main (différé, §2) | LOCAL |
| 35 | Connecté | Espace pro : vitrine, statistiques, import de catalogue, multi-comptes, formules | équivalent | GET /users/me/shops → 200 ; import CSV/XML (phase 2), formules (page /compte/formule), vitrine /vendeurs/:id | LOCAL |
| 36 | Connecté | Changement d'e-mail confirmé, double authentification | équivalent | phase 15 et scénario 12 (QR code, codes de récupération) | LOCAL |
