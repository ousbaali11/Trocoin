# Cahier des charges
## Plateforme de petites annonces — France uniquement

---

## 1. Contexte et objectif

Créer une plateforme web + mobile (iOS/Android) de petites annonces généralistes, concurrente directe de leboncoin, ciblant exclusivement le marché français. L'objectif différenciant : une expérience plus **simple, rapide et premium**, avec un modèle de publication d'annonces **gratuit ou plus abordable**.

Chaque compte doit être rattaché à un numéro de téléphone mobile français (+33 6/7), vérifié par SMS. Aucun numéro étranger n'est accepté à l'inscription.

---

## 2. Utilisateurs cibles

| Profil | Besoin principal |
|---|---|
| Particulier vendeur | Vendre rapidement des objets, gratuitement ou à faible coût |
| Particulier acheteur | Trouver, filtrer, contacter, acheter en confiance |
| Professionnel (garage, agence immo, recruteur, commerçant) | Vitrine boutique, volume d'annonces, statistiques, mise en avant |
| Modérateur / Admin | Superviser, arbitrer les litiges, retirer le contenu interdit |

---

## 3. Périmètre fonctionnel

### 3.1 Comptes & authentification
- Inscription par numéro de téléphone français uniquement (+33), OTP SMS à 6 chiffres, validité 5 min, renvoi limité (anti-spam)
- Refus explicite de tout numéro non-français (indicatif ≠ +33)
- Connexion secondaire par e-mail + mot de passe, ou SSO (Google/Apple), le téléphone FR restant obligatoire pour publier
- Double authentification optionnelle
- Profil : photo, pseudo, localisation (ville/code postal), date d'inscription, badge "pro", note moyenne, taux de réponse
- Gestion RGPD : export des données, suppression de compte, consentement cookies

### 3.2 Dépôt et gestion d'annonce
- Formulaire dynamique selon catégorie (champs spécifiques : kilométrage pour véhicules, surface pour immobilier, taille pour mode…)
- Jusqu'à 10-20 photos, réordonnables, recadrage intégré
- Titre, description, prix (ou "gratuit"/"échange"/"prix sur demande"), état (neuf/bon état/pour pièces…), localisation précise avec rayon de confidentialité
- Brouillon, prévisualisation avant publication
- Expiration automatique (ex : 60 jours), relance/republication en un clic
- Statuts : en ligne, vendue, désactivée, en attente de modération, refusée (avec motif)
- Modification a posteriori, duplication d'annonce

### 3.3 Catégories (arborescence complète, alignée sur les usages du marché français)
1. Véhicules — voitures, motos, caravaning, utilitaires, nautisme, pièces auto
2. Immobilier — vente, location, colocation, bureaux/commerces, terrains
3. Emploi — offres, formations
4. Mode — vêtements, chaussures, accessoires, montres/bijoux
5. Maison & Jardin — ameublement, électroménager, bricolage, jardinage
6. Multimédia — téléphonie, informatique, consoles/jeux
7. Loisirs — livres, musique, sport, jouets
8. Matériel professionnel — BTP, agricole, restauration
9. Services — cours, travaux, évènementiel, services à la personne
10. Vacances — locations saisonnières
11. Famille — puériculture, mobilier bébé
12. Animaux — dons, ventes réglementées (n° SIREN/ICAD obligatoire, conforme loi française)

### 3.4 Recherche & navigation
- Barre de recherche full-text avec suggestions et corrections orthographiques
- Filtres combinés : catégorie, prix (min/max), localisation + rayon, état, date de publication, professionnel/particulier, livraison possible
- Tri : pertinence, prix croissant/décroissant, date
- Recherche sauvegardée + alerte (email/push) sur nouvelle annonce correspondante
- Géolocalisation utilisateur et carte des annonces à proximité

### 3.5 Messagerie
- Chat interne temps réel (texte, photo, proposition de prix)
- Notifications push/email sur nouveau message
- Réponses rapides pré-remplies ("Toujours disponible ?", "Dernier prix ?")
- Blocage utilisateur, signalement de conversation abusive
- Historique des échanges par annonce

### 3.6 Paiement et livraison sécurisés
- Paiement carte bancaire intégré, séquestre des fonds jusqu'à confirmation de réception (protection acheteur/vendeur)
- Génération d'étiquette de livraison (partenariats type Mondial Relay / Colissimo / Chronopost)
- Remise en main propre avec code de validation à l'échange
- Commission plateforme transparente affichée avant validation

### 3.7 Monétisation
- Dépôt d'annonce gratuit pour les particuliers (nombre limité par mois)
- Options payantes à l'unité : mise en avant, "urgent", remontée en tête de liste, annonce sponsorisée
- Abonnements professionnels (paliers : nombre d'annonces, statistiques avancées, badge vérifié, vitrine boutique personnalisée)
- Facturation/TVA conforme, déclaration automatique des revenus vendeurs particuliers (obligation DAC7)

### 3.8 Confiance, avis & sécurité
- Évaluation acheteur ↔ vendeur après transaction (note + commentaire)
- Badge "identité vérifiée" (pièce d'identité, pour catégories sensibles : véhicules, immobilier)
- Détection automatique de contenu interdit (mots-clés, images) + modération humaine
- Signalement d'annonce par les utilisateurs, avec motifs (contrefaçon, arnaque, catégorie interdite, doublon)
- Liste noire d'objets interdits conforme à la réglementation française (armes, médicaments, espèces protégées, contrefaçons, etc.)

### 3.9 Favoris & suivi
- Ajout aux favoris, liste d'annonces suivies
- Historique de recherche et d'annonces consultées

### 3.10 Espace professionnel / vitrine
- Page boutique personnalisable (logo, description, horaires, localisation)
- Import en masse d'annonces (flux CSV/XML, utile pour concessionnaires/agences)
- Statistiques de performance (vues, contacts, conversions)
- Gestion multi-utilisateurs pour une même structure

### 3.11 Back-office administrateur
- Tableau de bord modération (file d'attente, actions en masse)
- Gestion des utilisateurs (suspension, vérification, support)
- Gestion des litiges transaction/livraison
- Statistiques globales (trafic, taux de conversion, revenus)
- CMS pour pages légales (CGU, CGV, politique de confidentialité)

### 3.12 Notifications
- Push mobile, e-mail, et SMS pour les évènements critiques (code OTP, litige, paiement)
- Centre de notifications in-app avec préférences granulaires

---

## 4. Exigences non fonctionnelles

- **Performance** : temps de chargement < 2s sur mobile, recherche instantanée (< 300ms)
- **Scalabilité** : architecture capable d'absorber des pics saisonniers (rentrée, soldes)
- **Disponibilité** : 99.9% SLA visé
- **SEO** : pages d'annonces indexables, URLs propres, données structurées (schema.org/Product)
- **Accessibilité** : conformité RGAA (niveau AA visé)
- **Sécurité** : chiffrement des données sensibles, protection anti-fraude, rate-limiting sur l'API, conformité RGPD/CNIL
- **Multi-plateforme** : site web responsive + applications natives (ou React Native) iOS/Android

---

## 5. Contraintes légales (France)

- RGPD / CNIL : consentement, portabilité, droit à l'oubli
- Loi DAC7 : déclaration automatique des revenus des vendeurs particuliers dépassant les seuils légaux
- CGU/CGV conformes au droit français, mentions légales, médiateur de la consommation
- Vérification renforcée pour les annonces véhicules (carte grise) et immobilier (mandat, DPE)
- Modération stricte des catégories réglementées (animaux, alcool, tabac, armes — interdiction totale ou vérification documentaire)
- Ne pas reproduire le nom, le logo, la charte graphique ni le contenu de leboncoin — seul le concept de plateforme d'annonces est libre de droit

---

## 6. Parcours utilisateurs prioritaires

1. **Vendeur particulier** : inscription → vérification téléphone FR → dépôt d'annonce → réception messages → vente → évaluation
2. **Acheteur** : recherche → filtres → contact vendeur → négociation → paiement sécurisé/livraison ou RDV → évaluation
3. **Professionnel** : inscription pro → abonnement → import annonces en masse → suivi statistiques → gestion vitrine

---

## 7. Roadmap proposée

| Phase | Contenu | Durée estimée |
|---|---|---|
| MVP | Compte + OTP FR, dépôt d'annonce, recherche/filtres simples, messagerie de base | 3-4 mois |
| V1 | Paiement séquestre, livraison, avis, favoris/alertes, back-office modération | 2-3 mois |
| V2 | Espace pro/vitrine, mise en avant payante, statistiques, appli mobile native | 2-3 mois |
| V3 | Optimisations SEO/perf, IA anti-fraude, recommandations personnalisées | Continu |

---

## 8. Indicateurs de succès (KPIs)

- Nombre d'annonces actives / nouvelles annonces par jour
- Taux de conversion contact → transaction
- Temps moyen de vente d'une annonce
- Taux de rétention utilisateur à 30/90 jours
- Volume de transactions sécurisées via la plateforme
