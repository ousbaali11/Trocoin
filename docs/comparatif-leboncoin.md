# Comparatif fonctionnel Trocoin / leboncoin — 15 septembre 2026

Ce document consolide les relevés faits sur leboncoin.fr les 14 et 15 septembre 2026 (mobile
375 px et bureau, connecté et non connecté ; détails dans `analyse-concurrentielle.md` §3, §10,
§11 et `AUDIT.md` §14) et donne, pour chaque fonctionnalité, son statut sur Trocoin après le tour
de refonte mobile-first. Trocoin garde son identité visuelle : la comparaison porte sur la
complétude fonctionnelle, jamais sur la copie de l'interface.

Statuts : **présent** (déjà là avant ce tour) · **ajouté** (dans ce tour) · **non pertinent**
(choix produit assumé, avec la raison) · **différé** (dépend d'un partenaire ou d'une décision).

## 1. Parcours non connecté

| Fonctionnalité leboncoin | Trocoin | Statut |
|---|---|---|
| Accueil : recherche « Quoi ? / Où ? », raccourcis, familles de catégories | Accueil avec barre réduite, raccourcis (dons, échanges, du jour, livraison), 12 familles | présent |
| Recherche par mot-clé avec suggestions et correction | Suggestions titres + catégories, correction orthographique simple | présent |
| Localisation : autour de moi, commune + rayon (0 à 200 km), toute la France | Identique (9 paliers de rayon, 5 km par défaut) ; « Toute la France » affiché dans le champ | présent (affichage corrigé) |
| Filtres : prix min/max, état, date de publication, livraison, avec photo, particulier/pro, urgentes, type de prix | Tous présents, plus les filtres spécifiques par famille (12 familles) | présent |
| Sous-catégories | Arborescence familles → catégories, filtre et fil d'Ariane | présent |
| Tri : pertinence, date, prix croissant/décroissant, distance | Date, prix, distance présents ; **pertinence** (score plein texte PostgreSQL, puis mises en avant, puis fraîcheur) | ajouté |
| Pagination | Pagination classique (24 par page) ; leboncoin pagine aussi | présent |
| Vue carte | Carte des résultats (Leaflet, positions approximatives) | présent |
| Cartes d'annonce : titre, prix, lieu, date de dépôt, badges Urgent / À la une / Pro, cœur favori | Identique en hiérarchie, palette Trocoin (AUDIT §14 et §16) | présent |
| Fiche annonce : galerie, caractéristiques, description, carte vendeur (note, ancienneté, réactivité), localisation approximative, annonces similaires, annonces du vendeur | Présent, plus le prix moyen constaté de la catégorie | présent |
| Partage d'annonce (menu) | Copier le lien, WhatsApp, e-mail, Facebook, X, partage natif | présent |
| Signalement d'annonce | Motifs fermés + précisions, traité en console d'administration | présent |
| « Voir le numéro » du vendeur | Non : la messagerie est le seul canal (protection des membres) | non pertinent |
| Aperçu rapide d'une annonce (survol sur bureau) | Non observé sur mobile ; la fiche s'ouvre directement | non pertinent |
| Pages statiques : aide, CGU, confidentialité, mentions légales | Centre d'aide (6 rubriques, 22 articles, recherche), pages légales éditables | présent |
| Bons plans, simulation de crédit, financement, Protection Panne | Services partenaires | non pertinent |

## 2. Parcours connecté

| Fonctionnalité leboncoin | Trocoin | Statut |
|---|---|---|
| Tableau de bord | Statistiques, dernières annonces, messages, transactions en cours, notifications | présent |
| Dépôt d'annonce : catégorie, champs par catégorie, photos (ordre, couverture), prix (fixe, négociable, don, échange), localisation, livraison, aperçu, brouillon | Identique, 10 photos réordonnables, brouillon, modération des annonces sensibles | présent |
| Gestion des annonces : modifier, renouveler, dupliquer, mettre en pause, marquer vendue, statistiques | Identique, plus « Mettre en avant » et « Urgent » (gratuits pendant le lancement) | présent |
| Messagerie temps réel, réponses rapides, photos, offres de prix, « Vu », « en train d'écrire » | Identique (WebSocket) | présent |
| Favoris, recherches sauvegardées avec alertes, annonces consultées | Identique | présent |
| Notifications et préférences par évènement et canal | Identique (compte, push, e-mail, SMS pour les critiques) | présent |
| Paramètres : profil, identifiants, mot de passe, sessions, export RGPD, suppression | Identique ; connexion par e-mail, nom d'utilisateur **ou mobile** | présent (mobile ajouté) |
| Paiement sécurisé avec fonds bloqués, remise en main propre par code, suivi d'envoi | Stripe Checkout en capture différée, code de remise à 6 chiffres, numéro de suivi | présent |
| Avis après transaction (donnés / reçus) | Identique | présent |
| Historique d'achats et ventes, litiges avec médiation | Identique (arbitrage en console) | présent |
| Badges : Pro, Identité vérifiée, Réactif | Pro et Identité vérifiée présents ; « Réactif » (taux et délai de réponse) | différé (nécessite un historique de réponses significatif) |
| Blocage d'un utilisateur | Identique | présent |
| Étiquettes transporteur intégrées | Absent | différé (partenariat transporteur) |
| Espace pro : vitrine, statistiques, import de catalogue, multi-comptes, formules | Identique (monétisation désactivée pendant le lancement) | présent |

## 3. Écarts volontairement non repris

- Listes constructeur marque → modèle → finition (véhicules) : référentiel propriétaire.
- Type d'annonce « Demande » : Trocoin ne gère que des offres.
- Accessibilité « renfort de contraste » : les contrastes Trocoin sont conformes AA par défaut.
- Historique des localisations recherchées : pas de traçage côté client.

## 4. Ce que ce tour a ajouté ou corrigé

1. Tri par **pertinence** sur les recherches par mot-clé (`sort=relevance`).
2. Connexion par **numéro de mobile** en plus de l'e-mail et du nom d'utilisateur.
3. Affichage de **« Toute la France »** dans le champ de localisation quand il est choisi.
4. Marges mobiles, cartes compactes, en-tête sur une ligne, fluidité (transitions, squelettes
   de chargement, retours tactiles) : voir `AUDIT.md` §16 et §17.
