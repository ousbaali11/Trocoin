/**
 * Données de départ pour les sections de découverte en bas des pages de catégorie
 * (« Localisations les plus demandées »). Les villes réellement présentes dans les annonces
 * passent en premier ; cette liste complète jusqu'à 24 entrées tant que le site est jeune.
 * Source : communes les plus peuplées de France (INSEE), ordre décroissant.
 */
export const GRANDES_VILLES = [
  'Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes', 'Montpellier', 'Strasbourg', 'Bordeaux', 'Lille',
  'Rennes', 'Toulon', 'Reims', 'Saint-Étienne', 'Le Havre', 'Dijon', 'Grenoble', 'Angers', 'Villeurbanne', 'Nîmes',
  'Clermont-Ferrand', 'Aix-en-Provence', 'Le Mans', 'Brest', 'Tours', 'Amiens', 'Limoges', 'Annecy', 'Perpignan', 'Metz',
];

export const NB_VILLES = 24;
export const NB_SUGGESTIONS = 24;
