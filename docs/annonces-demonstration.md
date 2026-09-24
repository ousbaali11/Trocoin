# Annonces de démonstration (catalogue de lancement)

Ce document décrit le catalogue de démonstration de Trocoin : pourquoi il existe, ce qu'il contient, comment il est créé,
et surtout comment sont traités les visiteurs qui écrivent à ces annonces. Aucun identifiant n'y figure.

## Pourquoi

Un site de petites annonces vide ne se remplit pas : personne ne dépose une annonce là où il n'y a rien à voir. Le catalogue
de démonstration donne au site l'apparence d'un site actif au lancement, avec des annonces plausibles dans chaque famille,
réparties selon les volumes réels d'un site généraliste (davantage de véhicules, de mode et de maison-jardin, moins de
matériel professionnel ou de locations de vacances).

## Ce que c'est, et ce que ce n'est pas

- **50 comptes vendeurs fictifs**, prénoms et noms variés (origines française, européenne et arabe, à l'image de la
  diversité réelle des utilisateurs en France). Ce sont de vrais comptes fonctionnels : le propriétaire du site en détient
  les identifiants (remis une seule fois par la console, jamais dans le code ni dans ce document).
- **600 annonces** (10 à 15 par compte), titres, descriptions, prix et attributs cohérents avec chaque sous-catégorie,
  validés contre les mêmes schémas que les dépôts des membres. Répartition : véhicules 95, maison & jardin 95, mode 90,
  loisirs 80, électronique 70, famille 40, immobilier 35, services 30, animaux 20 (accessoires uniquement, aucune vente
  d'animal), matériel professionnel 20, emploi 15, locations de vacances 10.
- **2 à 5 photos par annonce**, uniquement issues de banques d'images libres de droits à usage commercial (Pexels en
  priorité ; à défaut Wikimedia Commons, fichiers CC0), correspondant sincèrement à l'objet décrit. Chaque photo est
  consignée avec sa source, son auteur, sa licence et sa page d'origine (`src/demo-catalogue/data/photos.json`). Aucune
  image n'est copiée depuis un autre site de petites annonces ou une place de marché.
- **Remise en main propre uniquement** : les comptes portent `securePaymentDisabled`, les annonces sont créées sans
  livraison. Le devis de paiement répond « non éligible » et l'achat en ligne est refusé (400) ; la fiche annonce affiche
  le motif à la place du bouton d'achat. Rien ne laisse croire qu'un paiement sécurisé est possible.
- **Numéro jamais affiché** : `phonePublic: false` et, pour un compte de démonstration, « Voir le numéro » répond 404 même
  si la préférence changeait. Les numéros sont pris dans la plage réservée à la fiction par l'ARCEP (06 39 98 XX XX),
  jamais attribuée : aucun vrai numéro n'est exposé.
- **Indicateur interne** : `isDemoAccount: true`, visible uniquement dans la console d'administration (pastille « Démo »
  sur la fiche et dans la liste des utilisateurs), jamais renvoyé par une route publique (annonce, profil, avis).

## Comment le catalogue est créé

Les limites de débit de l'API publique (dépôts, envois de photos, inscriptions par adresse) rendent impossible l'envoi
externe de 600 annonces et de 1 700 photos. Le catalogue est donc créé **côté serveur, par un administrateur**, depuis la
console : *Catalogue de démonstration → Créer le catalogue de démonstration*.

- Le jeu de données est versionné dans `src/demo-catalogue/data/` (comptes sans mot de passe, annonces, photos résolues) ;
  il est produit par `node scripts/demo-catalogue/build.js` (archétypes par sous-catégorie, variantes déterministes,
  attributs validés) puis `node scripts/demo-catalogue/resolve-photos.js` (clé Pexels dans `private/pexels.key`, jamais
  commitée).
- L'exécution est **idempotente et reprend d'elle-même** : comptes retrouvés par leur e-mail, annonces par leur référence
  `demo:<clé>`, photos manquantes seulement. Un redémarrage du serveur en cours de route n'abîme rien : relancer suffit.
- Les photos sont téléchargées depuis leur source puis passent par le traitement des envois de membres (ré-encodage sans
  métadonnées, vignette, stockage courant). Les dates de publication sont réparties sur les 45 derniers jours pour que le
  site ne semble pas avoir été rempli en une fois.
- Les **mots de passe** sont générés à la création et **remis une seule fois** à l'administrateur (bouton « Récupérer les
  identifiants », fichier téléchargé), puis effacés de la mémoire du serveur. En cas de perte, la console permet de
  réinitialiser le mot de passe d'un compte (mot de passe temporaire).
- Toute exécution et toute réponse au nom d'un compte de démonstration sont tracées au journal d'audit.

## Gérer les messages entrants : le choix fait

Avec 600 annonces, il n'est pas réaliste de répondre personnellement et rapidement depuis 50 comptes différents. Deux
options étaient proposées : une réponse automatique (A), ou davantage de comptes réellement surveillés sans automatisation
(B). **Le choix retenu combine la réponse automatique et un suivi centralisé** :

1. **Réponse automatique, une seule fois par conversation**, dès le premier message d'un membre à un compte de
   démonstration : « Bonjour et merci pour votre message ! Cette annonce fait partie du catalogue de lancement de Trocoin :
   elle est gérée par l'équipe du site, qui vous répondra ici dès que possible (en général sous 24 h). Aucun paiement n'est
   demandé sur cette annonce : toute remise se fait en main propre, après échange par cette messagerie. » Elle est
   étiquetée « Réponse automatique du catalogue de démonstration » dans la conversation. Personne ne reçoit un silence
   complet, et personne n'est trompé sur la nature de l'annonce.
2. **Suivi centralisé** : chaque premier message (et chaque relance après une réponse de l'équipe) prévient les
   administrateurs par notification. La page *Catalogue de démonstration* de la console liste toutes les conversations des
   comptes de démonstration, signale celles qui attendent une réponse, montre le fil et permet de **répondre au nom du
   compte, avec la signature « Équipe Trocoin »** (étiquette « Réponse de l'équipe Trocoin » côté membre). Il n'y a donc
   qu'une seule boîte à surveiller, sans se connecter à 50 comptes.

Pourquoi pas l'option B seule : multiplier les comptes ne réduit pas le nombre de messages à traiter, et un délai de
réponse de plusieurs jours sans aucun signal est précisément ce qu'il faut éviter. Pourquoi pas l'option A seule : un
message automatique qui n'est jamais suivi d'une vraie réponse finit par tromper. La combinaison garantit l'honnêteté
immédiate et un vrai suivi humain.

## Retirer le catalogue

Chaque annonce du catalogue porte la référence `demo:<clé>` et chaque compte l'indicateur `isDemoAccount` : la console
permet de retirer les annonces ou de supprimer les comptes comme pour n'importe quel membre (le journal d'audit conserve la
trace). Les 10 comptes de démonstration du premier ensemencement (septembre 2026, 59 annonces) suivent les mêmes règles.
