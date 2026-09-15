/**
 * Champs dynamiques par catégorie (équivalent des "critères" leboncoin).
 * Une seule source de vérité, utilisée :
 *  - côté API pour valider `attributes` à la création / modification ;
 *  - côté front (GET /categories/:slug/schema) pour générer le formulaire
 *    de dépôt et les filtres spécifiques.
 */
import { marquesOf, MODELES_MOTOS, MODELES_UTILITAIRES, MODELES_VOITURES, tousModelesOf } from './vehicle-models';

export type FieldType = 'select' | 'number' | 'text' | 'boolean';

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[]; // pour select
  unit?: string; // pour number
  min?: number;
  max?: number;
  maxLength?: number;
  filterable?: boolean; // proposé comme filtre de recherche
  /**
   * Liste dépendante (select) : les options proposées sont `optionsByParent[valeur du champ dependsOn]`
   * (ex. modèles d'une marque). Sans valeur parente, toutes les options de toutes les listes sont acceptées.
   */
  dependsOn?: string;
  optionsByParent?: Record<string, string[]>;
}

const COULEURS = ['Noir', 'Blanc', 'Gris', 'Argent', 'Bleu', 'Rouge', 'Vert', 'Jaune', 'Orange', 'Beige', 'Marron', 'Bordeaux', 'Violet', 'Rose', 'Doré', 'Multicolore', 'Autre'];
const TYPES_VEHICULE = ['4x4 / SUV / Crossover', 'Berline', 'Break', 'Cabriolet', 'Citadine', 'Coupé', 'Minibus', 'Monospace', 'Pick-up', 'Utilitaire', 'Voiture sans permis'];
const EXPOSITIONS = ['Nord', 'Sud', 'Est', 'Ouest', 'Nord-Est', 'Nord-Ouest', 'Sud-Est', 'Sud-Ouest'];
const CARBURANTS = ['Essence', 'Diesel', 'Hybride', 'Hybride rechargeable', 'Électrique', 'GPL', 'Autre'];
const BOITES = ['Manuelle', 'Automatique'];
const DPE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Non soumis'];
const UNIVERS = ['Femme', 'Homme', 'Fille', 'Garçon', 'Bébé', 'Unisexe'];
const SPORTS = ['Fitness / Musculation', 'Running / Athlétisme', 'Football', 'Rugby', 'Basketball', 'Tennis / Padel / Badminton', 'Cyclisme', 'Natation / Plongée', 'Randonnée / Trekking', 'Ski / Snowboard', 'Sports de glisse (surf, skate)', 'Sports de combat / Arts martiaux', 'Golf', 'Équitation', 'Pêche / Chasse', 'Camping / Plein air', 'Danse / Gymnastique', 'Yoga / Pilates', 'Autre'];
const MATIERES = ['Mathématiques', 'Français', 'Anglais', 'Espagnol', 'Allemand', 'Italien', 'Physique-chimie', 'SVT / Biologie', 'Histoire-géographie', 'Philosophie', 'Économie / Gestion', 'Informatique / Programmation', 'Musique', 'Arts plastiques', 'Soutien scolaire (toutes matières)', 'Préparation aux examens', 'Autre'];
// Valeurs relevées sur leboncoin.fr le 15 septembre 2026 (filtre « Type d'animal » de la famille Animaux)
const ANIMAUX = ['Chien', 'Chat', 'Nouvel animal de compagnie (rongeur, reptile, furet…)', 'Équidé', 'Animal de la ferme', 'Oiseau', 'Poisson', 'Autre'];
const AGES_ANIMAL = ['Moins de 3 mois', '3 à 6 mois', '6 mois à 1 an', '1 à 3 ans', '3 à 8 ans', 'Plus de 8 ans'];
const TAILLES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52', 'Unique'];

/** Marque et modèle en listes dépendantes (référentiel statique `vehicle-models.ts`), puis année et kilométrage. */
function vehiculeBase(modeles: Record<string, string[]>): FieldSchema[] {
  return [
    { key: 'marque', label: 'Marque', type: 'select', required: true, options: marquesOf(modeles), filterable: true },
    { key: 'modele', label: 'Modèle', type: 'select', required: true, dependsOn: 'marque', optionsByParent: modeles, filterable: true },
    { key: 'annee', label: 'Année de mise en circulation', type: 'number', required: true, min: 1900, max: 2027, filterable: true },
    { key: 'kilometrage', label: 'Kilométrage', type: 'number', required: true, unit: 'km', min: 0, max: 2_000_000, filterable: true },
  ];
}

const IMMO_BASE: FieldSchema[] = [
  { key: 'type_bien', label: 'Type de bien', type: 'select', required: true, options: ['Appartement', 'Maison', 'Terrain', 'Parking / Box', 'Local commercial', 'Bureau', 'Immeuble', 'Autre'], filterable: true },
  { key: 'surface', label: 'Surface habitable', type: 'number', required: true, unit: 'm²', min: 1, max: 100_000, filterable: true },
  { key: 'pieces', label: 'Nombre de pièces', type: 'number', min: 1, max: 50, filterable: true },
  { key: 'chambres', label: 'Nombre de chambres', type: 'number', min: 0, max: 30, filterable: true },
  { key: 'salles_eau', label: "Nombre de salles d'eau", type: 'number', min: 0, max: 20 },
  { key: 'etage', label: 'Étage', type: 'number', min: -2, max: 80 },
  { key: 'ascenseur', label: 'Ascenseur', type: 'boolean' },
  { key: 'exterieur', label: 'Extérieur', type: 'select', options: ['Aucun', 'Balcon', 'Terrasse', 'Jardin', 'Balcon et jardin'] },
  { key: 'dpe', label: 'Classe énergie (DPE)', type: 'select', required: true, options: DPE, filterable: true },
  { key: 'ges', label: 'Émissions GES', type: 'select', required: true, options: DPE },
];

/** Clé = slug de la catégorie (racine ou sous-catégorie). Les sous-catégories héritent de la racine si absentes. */
export const CATEGORY_SCHEMAS: Record<string, FieldSchema[]> = {
  // ---------- Véhicules ----------
  'vehicules': [],
  'voitures': [
    ...vehiculeBase(MODELES_VOITURES),
    { key: 'type_vehicule', label: 'Type de véhicule', type: 'select', options: TYPES_VEHICULE, filterable: true },
    { key: 'carburant', label: 'Carburant', type: 'select', required: true, options: CARBURANTS, filterable: true },
    { key: 'boite', label: 'Boîte de vitesse', type: 'select', required: true, options: BOITES, filterable: true },
    { key: 'puissance_fiscale', label: 'Puissance fiscale', type: 'number', unit: 'CV', min: 1, max: 100, filterable: true },
    { key: 'puissance_din', label: 'Puissance DIN', type: 'number', unit: 'ch', min: 1, max: 2000, filterable: true },
    { key: 'portes', label: 'Nombre de portes', type: 'select', options: ['2', '3', '4', '5'], filterable: true },
    { key: 'places', label: 'Nombre de places', type: 'number', min: 1, max: 9, filterable: true },
    { key: 'couleur', label: 'Couleur', type: 'select', options: COULEURS, filterable: true },
    { key: 'sellerie', label: 'Sellerie', type: 'select', options: ['Tissu', 'Cuir', 'Cuir partiel', 'Velours', 'Alcantara', 'Autre'] },
    { key: 'critair', label: "Vignette Crit'Air", type: 'select', options: ['0 (électrique)', '1', '2', '3', '4', '5', 'Non classé'] },
    { key: 'controle_technique', label: 'Contrôle technique à jour', type: 'boolean' },
    { key: 'premiere_main', label: 'Première main', type: 'boolean' },
  ],
  'motos': [
    ...vehiculeBase(MODELES_MOTOS),
    { key: 'cylindree', label: 'Cylindrée', type: 'number', required: true, unit: 'cm³', min: 49, max: 3000, filterable: true },
    { key: 'type_moto', label: 'Type', type: 'select', options: ['Roadster', 'Sportive', 'Trail', 'Custom', 'Routière', 'Scooter', '125', 'Cross / Enduro', 'Autre'] },
    { key: 'permis', label: 'Permis requis', type: 'select', options: ['AM', 'A1', 'A2', 'A', 'B'] },
    { key: 'puissance_din', label: 'Puissance DIN', type: 'number', unit: 'ch', min: 1, max: 400, filterable: true },
    { key: 'couleur', label: 'Couleur', type: 'select', options: COULEURS, filterable: true },
  ],
  'utilitaires': [
    ...vehiculeBase(MODELES_UTILITAIRES),
    { key: 'carburant', label: 'Carburant', type: 'select', required: true, options: CARBURANTS, filterable: true },
    { key: 'boite', label: 'Boîte de vitesse', type: 'select', options: BOITES },
    { key: 'ptac', label: 'PTAC', type: 'number', unit: 'kg', min: 500, max: 44_000 },
  ],
  'caravaning': [
    { key: 'type_caravaning', label: 'Type', type: 'select', required: true, options: ['Camping-car', 'Caravane', 'Van aménagé', 'Mobil-home', 'Remorque'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
    { key: 'annee', label: 'Année', type: 'number', min: 1950, max: 2027, filterable: true },
    { key: 'kilometrage', label: 'Kilométrage', type: 'number', unit: 'km', min: 0, max: 1_000_000 },
    { key: 'couchages', label: 'Nombre de couchages', type: 'number', min: 1, max: 10 },
  ],
  'nautisme': [
    { key: 'type_bateau', label: 'Type', type: 'select', required: true, options: ['Voilier', 'Bateau à moteur', 'Semi-rigide', 'Jet-ski', 'Kayak / Paddle', 'Autre'], filterable: true },
    { key: 'longueur', label: 'Longueur', type: 'number', unit: 'm', min: 1, max: 60 },
    { key: 'annee', label: 'Année', type: 'number', min: 1900, max: 2027 },
  ],
  'pieces-auto': [
    { key: 'type_piece', label: 'Type de pièce', type: 'select', required: true, options: ['Pneus / Jantes', 'Moteur', 'Carrosserie', 'Électronique', 'Intérieur', 'Freinage', 'Éclairage', 'Autre'], filterable: true },
    { key: 'compatibilite', label: 'Compatibilité (marque / modèle)', type: 'text', maxLength: 80 },
  ],

  // ---------- Immobilier ----------
  'immobilier': [],
  'ventes-immobilieres': [
    ...IMMO_BASE,
    { key: 'surface_terrain', label: 'Surface du terrain', type: 'number', unit: 'm²', min: 0, max: 10_000_000 },
    { key: 'annee_construction', label: 'Année de construction', type: 'number', min: 1500, max: 2027 },
    { key: 'honoraires', label: 'Honoraires à la charge de l\'acquéreur', type: 'number', unit: '%', min: 0, max: 20 },
    { key: 'type_vente', label: 'Type de vente', type: 'select', options: ['Ancien', 'Neuf', 'Viager'], filterable: true },
    { key: 'exposition', label: 'Exposition', type: 'select', options: EXPOSITIONS, filterable: true },
    { key: 'etat_bien', label: 'État du bien', type: 'select', options: ['À rénover', 'Bon état', 'Neuf / rénové'], filterable: true },
  ],
  'locations': [
    ...IMMO_BASE,
    { key: 'meuble', label: 'Meublé', type: 'boolean', required: true, filterable: true },
    { key: 'charges', label: 'Charges mensuelles', type: 'number', unit: '€', min: 0, max: 10_000 },
    { key: 'depot_garantie', label: 'Dépôt de garantie', type: 'number', unit: '€', min: 0, max: 100_000 },
    { key: 'disponible_le', label: 'Disponible à partir du', type: 'text', maxLength: 20 },
    { key: 'exposition', label: 'Exposition', type: 'select', options: EXPOSITIONS, filterable: true },
  ],
  'colocations': [
    { key: 'surface', label: 'Surface de la chambre', type: 'number', required: true, unit: 'm²', min: 5, max: 200 },
    { key: 'colocataires', label: 'Nombre de colocataires', type: 'number', min: 1, max: 20 },
    { key: 'meuble', label: 'Meublé', type: 'boolean' },
    { key: 'charges', label: 'Charges mensuelles', type: 'number', unit: '€', min: 0, max: 5000 },
    { key: 'dpe', label: 'Classe énergie (DPE)', type: 'select', options: DPE },
  ],
  'bureaux-commerces': [
    { key: 'type_local', label: 'Type', type: 'select', required: true, options: ['Bureau', 'Local commercial', 'Entrepôt', 'Fonds de commerce', 'Terrain'], filterable: true },
    { key: 'surface', label: 'Surface', type: 'number', required: true, unit: 'm²', min: 1, max: 1_000_000, filterable: true },
    { key: 'transaction', label: 'Vente ou location', type: 'select', required: true, options: ['Vente', 'Location'] },
  ],
  'terrains': [
    { key: 'surface_terrain', label: 'Surface', type: 'number', required: true, unit: 'm²', min: 1, max: 100_000_000, filterable: true },
    { key: 'constructible', label: 'Constructible', type: 'boolean', filterable: true },
    { key: 'viabilise', label: 'Viabilisé', type: 'boolean' },
  ],

  // ---------- Emploi ----------
  'emploi': [],
  'offres-emploi': [
    { key: 'contrat', label: 'Type de contrat', type: 'select', required: true, options: ['CDI', 'CDD', 'Intérim', 'Alternance', 'Stage', 'Freelance', 'Saisonnier'], filterable: true },
    { key: 'temps', label: 'Temps de travail', type: 'select', options: ['Temps plein', 'Temps partiel'], filterable: true },
    { key: 'secteur', label: 'Secteur', type: 'text', maxLength: 60 },
    { key: 'experience', label: 'Expérience requise', type: 'select', options: ['Débutant accepté', '1 à 3 ans', '3 à 5 ans', 'Plus de 5 ans'] },
    { key: 'salaire_min', label: 'Salaire brut annuel minimum', type: 'number', unit: '€', min: 0, max: 1_000_000 },
    { key: 'teletravail', label: 'Télétravail possible', type: 'boolean' },
    { key: 'fonction', label: 'Fonction', type: 'text', maxLength: 60, filterable: true },
    { key: 'niveau_etudes', label: "Niveau d'études", type: 'select', options: ['Sans diplôme', 'CAP / BEP', 'Bac', 'Bac +2', 'Bac +3', 'Bac +5 et plus'], filterable: true },
  ],
  'formations': [
    { key: 'type_formation', label: 'Type', type: 'select', required: true, options: ['Diplômante', 'Certifiante', 'Courte', 'En ligne', 'Alternance'] },
    { key: 'duree', label: 'Durée', type: 'text', maxLength: 40 },
  ],

  // ---------- Mode ----------
  'mode': [
    { key: 'univers', label: 'Univers', type: 'select', options: UNIVERS, filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40, filterable: true },
    { key: 'couleur', label: 'Couleur', type: 'text', maxLength: 30 },
  ],
  'vetements': [
    { key: 'univers', label: 'Univers', type: 'select', required: true, options: UNIVERS, filterable: true },
    { key: 'type_vetement', label: 'Type', type: 'select', options: ['Manteau / Veste', 'Pull / Gilet', 'Chemise / Blouse', 'T-shirt / Top', 'Robe', 'Jupe', 'Pantalon / Jean', 'Short', 'Costume', 'Sportswear', 'Lingerie / Pyjama', 'Maillot de bain', 'Autre'] },
    { key: 'taille', label: 'Taille', type: 'select', required: true, options: TAILLES, filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40, filterable: true },
    { key: 'couleur', label: 'Couleur', type: 'select', options: COULEURS, filterable: true },
    { key: 'matiere', label: 'Matière', type: 'text', maxLength: 30 },
  ],
  'chaussures': [
    { key: 'univers', label: 'Univers', type: 'select', required: true, options: UNIVERS, filterable: true },
    { key: 'pointure', label: 'Pointure', type: 'number', required: true, min: 16, max: 52, filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40, filterable: true },
    { key: 'couleur', label: 'Couleur', type: 'select', options: COULEURS, filterable: true },
  ],
  'accessoires-bagagerie': [
    { key: 'type_accessoire', label: 'Type', type: 'select', options: ['Sac', 'Valise', 'Ceinture', 'Écharpe / Foulard', 'Chapeau / Bonnet', 'Lunettes', 'Gants', 'Autre'] },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
  ],
  'montres-bijoux': [
    { key: 'type_bijou', label: 'Type', type: 'select', options: ['Montre', 'Bague', 'Collier', 'Bracelet', 'Boucles d\'oreilles', 'Autre'] },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
    { key: 'matiere', label: 'Matière', type: 'select', options: ['Or', 'Argent', 'Acier', 'Plaqué', 'Fantaisie', 'Autre'] },
  ],

  // ---------- Maison & Jardin ----------
  'maison-jardin': [
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
    { key: 'couleur', label: 'Couleur', type: 'text', maxLength: 30 },
  ],
  'ameublement': [
    { key: 'piece', label: 'Pièce', type: 'select', options: ['Salon', 'Chambre', 'Cuisine', 'Salle de bain', 'Bureau', 'Entrée', 'Chambre enfant', 'Extérieur'], filterable: true },
    { key: 'type_meuble', label: 'Type', type: 'select', options: ['Canapé / Fauteuil', 'Table', 'Chaise', 'Lit / Literie', 'Armoire / Rangement', 'Bureau', 'Étagère', 'Meuble TV', 'Autre'], filterable: true },
    { key: 'matiere', label: 'Matière', type: 'text', maxLength: 30 },
    { key: 'couleur', label: 'Couleur', type: 'select', options: COULEURS, filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
  ],
  'electromenager': [
    { key: 'type_appareil', label: 'Type', type: 'select', options: ['Lave-linge', 'Sèche-linge', 'Lave-vaisselle', 'Réfrigérateur / Congélateur', 'Four / Cuisinière', 'Micro-ondes', 'Aspirateur', 'Petit électroménager', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40, filterable: true },
    { key: 'classe_energie', label: 'Classe énergie', type: 'select', options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
  ],
  'bricolage': [
    { key: 'type_outil', label: 'Type', type: 'select', options: ['Outillage électroportatif', 'Outillage à main', 'Matériaux', 'Quincaillerie', 'Plomberie / Électricité', 'Autre'] },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
  ],
  'jardinage': [
    { key: 'type_jardin', label: 'Type', type: 'select', options: ['Tondeuse', 'Outillage de jardin', 'Mobilier de jardin', 'Plantes', 'Barbecue / Plancha', 'Piscine', 'Autre'] },
  ],

  // ---------- Multimédia ----------
  'multimedia': [
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40, filterable: true },
  ],
  'telephonie': [
    { key: 'type_produit', label: 'Produit', type: 'select', options: ['Smartphone', 'Téléphone fixe', 'Montre connectée', 'Accessoire'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'select', required: true, options: ['Apple', 'Samsung', 'Xiaomi', 'Google', 'Huawei', 'OnePlus', 'Oppo', 'Sony', 'Autre'], filterable: true },
    { key: 'modele', label: 'Modèle', type: 'text', required: true, maxLength: 60, filterable: true },
    { key: 'stockage', label: 'Capacité de stockage', type: 'select', options: ['32 Go', '64 Go', '128 Go', '256 Go', '512 Go', '1 To'], filterable: true },
    { key: 'couleur', label: 'Couleur', type: 'text', maxLength: 30 },
    { key: 'debloque', label: 'Débloqué tout opérateur', type: 'boolean' },
  ],
  'informatique': [
    { key: 'type_produit', label: 'Type', type: 'select', required: true, options: ['Ordinateur portable', 'Ordinateur fixe', 'Tablette', 'Écran', 'Composant', 'Périphérique', 'Imprimante', 'Réseau', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40, filterable: true },
    { key: 'processeur', label: 'Processeur', type: 'text', maxLength: 40 },
    { key: 'ram', label: 'Mémoire vive', type: 'select', options: ['4 Go', '8 Go', '16 Go', '32 Go', '64 Go et plus'] },
    { key: 'stockage', label: 'Stockage', type: 'text', maxLength: 30 },
    { key: 'taille_ecran', label: "Taille d'écran", type: 'number', unit: 'pouces', min: 5, max: 60, filterable: true },
  ],
  'consoles-jeux-video': [
    { key: 'plateforme', label: 'Plateforme', type: 'select', required: true, options: ['PlayStation 5', 'PlayStation 4', 'Xbox Series', 'Xbox One', 'Nintendo Switch', 'PC', 'Rétro', 'Autre'], filterable: true },
    { key: 'type_produit', label: 'Type', type: 'select', options: ['Console', 'Jeu', 'Accessoire'] },
  ],
  'image-son': [
    { key: 'type_produit', label: 'Type', type: 'select', options: ['Téléviseur', 'Enceinte', 'Casque / Écouteurs', 'Appareil photo', 'Vidéoprojecteur', 'Home cinéma', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
  ],

  // ---------- Loisirs ----------
  'loisirs': [],
  'livres': [
    { key: 'genre', label: 'Genre', type: 'select', options: ['Roman', 'Policier / Thriller', 'Science-fiction / Fantasy', 'BD / Manga', 'Jeunesse', 'Scolaire / Universitaire', 'Beaux livres', 'Pratique / Cuisine', 'Histoire / Biographie', 'Autre'], filterable: true },
    { key: 'auteur', label: 'Auteur', type: 'text', maxLength: 60 },
    { key: 'format', label: 'Format', type: 'select', options: ['Poche', 'Grand format', 'Relié', 'Lot de livres'], filterable: true },
  ],
  'musique-instruments': [
    { key: 'type_instrument', label: 'Type', type: 'select', options: ['Guitare', 'Piano / Clavier', 'Batterie / Percussions', 'Vent', 'Cordes', 'DJ / Studio', 'Vinyles / CD', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
    { key: 'niveau', label: 'Niveau', type: 'select', options: ['Débutant', 'Intermédiaire', 'Confirmé', 'Professionnel'], filterable: true },
  ],
  'sports-hobbies': [
    { key: 'sport', label: 'Activité', type: 'select', options: SPORTS, filterable: true },
    { key: 'univers', label: 'Univers', type: 'select', options: ['Homme', 'Femme', 'Enfant', 'Mixte'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40, filterable: true },
    { key: 'type_produit', label: 'Produit', type: 'select', options: ['Matériel', 'Vêtement', 'Chaussures', 'Accessoire', 'Nutrition'], filterable: true },
  ],
  'velos': [
    { key: 'type_velo', label: 'Type', type: 'select', required: true, options: ['VTT', 'Route', 'Ville', 'Électrique', 'Enfant', 'Gravel', 'BMX', 'Pliant', 'Autre'], filterable: true },
    { key: 'taille_cadre', label: 'Taille du cadre', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'Enfant'], filterable: true },
    { key: 'roues', label: 'Taille des roues', type: 'select', options: ['12"', '14"', '16"', '20"', '24"', '26"', '27,5"', '28"', '29"'], filterable: true },
    { key: 'materiau', label: 'Matériau du cadre', type: 'select', options: ['Aluminium', 'Carbone', 'Acier', 'Titane', 'Autre'] },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40, filterable: true },
  ],
  'jeux-jouets': [
    { key: 'age', label: 'Âge conseillé', type: 'select', options: ['0-2 ans', '3-5 ans', '6-9 ans', '10 ans et plus'], filterable: true },
    { key: 'type_jouet', label: 'Type', type: 'select', options: ['Jeu de société', 'Puzzle', 'Poupée / Figurine', 'Construction', 'Éveil', 'Plein air', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
  ],
  'collection': [
    { key: 'type_collection', label: 'Type', type: 'select', options: ['Monnaies', 'Timbres', 'Cartes', 'Figurines', 'Militaria', 'Vintage', 'Autre'], filterable: true },
  ],

  // ---------- Matériel professionnel ----------
  'materiel-professionnel': [
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
    { key: 'annee', label: 'Année', type: 'number', min: 1900, max: 2027 },
  ],
  'btp': [
    { key: 'type_materiel', label: 'Type', type: 'select', options: ['Engin de chantier', 'Poids lourd / Camion', 'Manutention / Levage', 'Échafaudage', 'Outillage', 'Matériaux', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40, filterable: true },
    { key: 'annee', label: 'Année', type: 'number', min: 1900, max: 2027, filterable: true },
    { key: 'heures', label: 'Heures de fonctionnement', type: 'number', min: 0, max: 100_000, filterable: true },
  ],
  'agricole': [
    { key: 'type_materiel', label: 'Type', type: 'select', options: ['Tracteur', 'Remorque', 'Outil de travail du sol', 'Semis / Récolte', 'Fenaison', 'Pulvérisation', 'Élevage', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40, filterable: true },
    { key: 'annee', label: 'Année', type: 'number', min: 1900, max: 2027, filterable: true },
    { key: 'heures', label: 'Heures de fonctionnement', type: 'number', min: 0, max: 100_000, filterable: true },
    { key: 'puissance', label: 'Puissance', type: 'number', unit: 'ch', min: 1, max: 1000, filterable: true },
  ],
  'restauration-hotellerie': [
    { key: 'type_materiel', label: 'Type', type: 'select', options: ['Cuisson', 'Froid', 'Lavage', 'Préparation', 'Mobilier', 'Bar / Café', 'Vaisselle', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
  ],
  'fournitures-bureau': [
    { key: 'type_fourniture', label: 'Type', type: 'select', options: ['Mobilier de bureau', 'Informatique / Bureautique', 'Papeterie', 'Machines (photocopieur, plastifieuse…)', 'Aménagement de commerce', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
    { key: 'quantite', label: 'Quantité', type: 'number', min: 1, max: 10_000 },
  ],

  // ---------- Services ----------
  'services': [
    { key: 'tarif_type', label: 'Type de tarif', type: 'select', options: ['Horaire', 'Forfait', 'Sur devis'], filterable: true },
    { key: 'zone', label: 'Zone d\'intervention', type: 'text', maxLength: 80 },
  ],
  'cours-particuliers': [
    { key: 'matiere', label: 'Matière', type: 'select', required: true, options: MATIERES, filterable: true },
    { key: 'niveau', label: 'Niveau', type: 'select', options: ['Primaire', 'Collège', 'Lycée', 'Supérieur', 'Adulte'], filterable: true },
    { key: 'a_distance', label: 'Cours à distance possible', type: 'boolean' },
  ],
  'jardinerie-bricolage': [
    { key: 'metier', label: 'Métier', type: 'select', options: ['Jardinier', 'Bricoleur', 'Plombier', 'Électricien', 'Peintre', 'Maçon', 'Menuisier', 'Autre'], filterable: true },
    { key: 'siret_presta', label: 'SIRET du prestataire', type: 'text', maxLength: 14 },
  ],
  'demenagement': [
    { key: 'vehicule', label: 'Véhicule', type: 'select', options: ['Utilitaire 3 m³', 'Utilitaire 12 m³', 'Camion 20 m³', 'Bras seulement'], filterable: true },
    { key: 'zone', label: 'Zone d\'intervention', type: 'text', maxLength: 80 },
  ],
  'reparations-mecaniques': [
    { key: 'specialite', label: 'Spécialité', type: 'select', options: ['Mécanique générale', 'Carrosserie', 'Pneumatiques', 'Électronique auto', 'Deux-roues', 'Autre'], filterable: true },
    { key: 'deplacement', label: 'Se déplace à domicile', type: 'boolean' },
  ],
  'reparations-electroniques': [
    { key: 'appareils', label: 'Appareils', type: 'select', options: ['Smartphone', 'Ordinateur', 'Tablette', 'Console', 'Électroménager', 'Autre'], filterable: true },
  ],
  'baby-sitting': [
    { key: 'experience', label: 'Expérience', type: 'select', options: ['Débutant', '1 à 3 ans', 'Plus de 3 ans', 'Diplômé petite enfance'], filterable: true },
    { key: 'vehicule', label: 'Véhiculé', type: 'boolean' },
  ],
  'evenementiel': [
    { key: 'type_prestation', label: 'Type', type: 'select', options: ['DJ / Musicien', 'Photographe', 'Traiteur', 'Location de matériel', 'Animation', 'Autre'], filterable: true },
  ],
  'artistes-musiciens': [
    { key: 'discipline', label: 'Discipline', type: 'select', options: ['Musicien', 'Chanteur', 'DJ', 'Comédien', 'Magicien', 'Peintre / Illustrateur', 'Autre'], filterable: true },
  ],
  'covoiturage': [
    { key: 'depart', label: 'Départ', type: 'text', required: true, maxLength: 60, filterable: true },
    { key: 'arrivee', label: 'Arrivée', type: 'text', required: true, maxLength: 60, filterable: true },
    { key: 'places', label: 'Places disponibles', type: 'number', min: 1, max: 8 },
  ],
  'billetterie': [
    { key: 'type_billet', label: 'Type', type: 'select', options: ['Concert', 'Festival', 'Sport', 'Théâtre / Spectacle', 'Parc / Loisirs', 'Autre'], filterable: true },
    { key: 'date_evenement', label: 'Date de l\'évènement', type: 'text', maxLength: 20 },
  ],
  'evenements': [
    { key: 'type_evenement', label: 'Type', type: 'select', options: ['Brocante / Vide-grenier', 'Concert', 'Atelier', 'Sport', 'Rencontre', 'Autre'], filterable: true },
    { key: 'date_evenement', label: 'Date', type: 'text', maxLength: 20 },
  ],
  'services-a-la-personne': [
    { key: 'type_service', label: 'Type', type: 'select', options: ['Garde d\'enfants', 'Aide à domicile', 'Ménage', 'Garde d\'animaux', 'Bricolage', 'Autre'], filterable: true },
  ],
  'services-animaux': [
    { key: 'type_service', label: 'Type', type: 'select', options: ['Garde à domicile', 'Pension', 'Promenade', 'Toilettage', 'Éducation / Dressage', 'Transport', 'Autre'], filterable: true },
    { key: 'animal', label: 'Animal', type: 'select', options: ['Chien', 'Chat', 'Rongeur', 'Oiseau', 'Cheval', 'Autre'], filterable: true },
    { key: 'tarif_type', label: 'Type de tarif', type: 'select', options: ['Horaire', 'Journée', 'Forfait', 'Sur devis'], filterable: true },
  ],
  'entraide-voisins': [
    { key: 'type_aide', label: 'Type d\'aide', type: 'select', options: ['Courses', 'Bricolage', 'Jardinage', 'Informatique', 'Transport', 'Garde', 'Prêt de matériel', 'Autre'], filterable: true },
  ],

  // ---------- Vacances ----------
  // Référence phase 2 : type d'hébergement (liste), caractéristiques et
  // nombre de voyageurs = champs du dépôt ET filtres de recherche.
  'vacances': [
    { key: 'type_hebergement', label: 'Type d\'hébergement', type: 'select', required: true, options: ['Maisons et villas', 'Appartements', 'Chalets', 'Mobil-homes', 'Chambres d\'hôtes', 'Campings', 'Hôtels', 'Hébergements insolites'], filterable: true },
    { key: 'environnement', label: 'Environnement', type: 'select', options: ['Mer', 'Montagne', 'Campagne', 'Ville', 'Lac / Rivière'], filterable: true },
    { key: 'classement', label: 'Classement', type: 'select', options: ['Non classé', '1 étoile', '2 étoiles', '3 étoiles', '4 étoiles', '5 étoiles'], filterable: true },
    { key: 'voyageurs', label: 'Nombre de voyageurs', type: 'select', required: true, options: ['Solo', 'À deux', 'À quatre', 'À six', 'Plus de six'], filterable: true },
    { key: 'piscine', label: 'Piscine', type: 'boolean', filterable: true },
    { key: 'jardin', label: 'Jardin', type: 'boolean', filterable: true },
    { key: 'animaux_acceptes', label: 'Animaux acceptés', type: 'boolean', filterable: true },
    { key: 'wifi', label: 'Wifi', type: 'boolean', filterable: true },
    { key: 'climatisation', label: 'Climatisation', type: 'boolean', filterable: true },
    { key: 'parking', label: 'Parking', type: 'boolean', filterable: true },
    { key: 'tv', label: 'Télévision', type: 'boolean' },
    { key: 'lave_linge', label: 'Lave-linge', type: 'boolean' },
    { key: 'barbecue', label: 'Barbecue', type: 'boolean' },
    { key: 'chambres', label: 'Chambres', type: 'number', min: 0, max: 30, filterable: true },
  ],

  // ---------- Famille ----------
  'famille': [],
  'puericulture': [
    { key: 'type_produit', label: 'Type', type: 'select', options: ['Poussette', 'Siège auto', 'Porte-bébé', 'Chaise haute', 'Lit parapluie', 'Transat / Balancelle', 'Baignoire / Toilette', 'Repas / Biberons', 'Sécurité', 'Jouet d\'éveil', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
    { key: 'couleur', label: 'Couleur', type: 'select', options: COULEURS, filterable: true },
  ],
  'mobilier-bebe': [
    { key: 'type_meuble', label: 'Type', type: 'select', options: ['Lit', 'Lit évolutif', 'Commode', 'Table à langer', 'Armoire', 'Bureau / Chaise enfant', 'Parc', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
    { key: 'couleur', label: 'Couleur', type: 'select', options: COULEURS, filterable: true },
  ],
  'vetements-bebe': [
    { key: 'taille_bebe', label: 'Taille', type: 'select', required: true, options: ['Prématuré', 'Naissance', '1 mois', '3 mois', '6 mois', '9 mois', '12 mois', '18 mois', '24 mois', '36 mois'], filterable: true },
    { key: 'type_vetement', label: 'Type', type: 'select', options: ['Body', 'Pyjama', 'Ensemble', 'Robe', 'Pantalon', 'Pull / Gilet', 'Manteau / Combinaison', 'Chaussures', 'Lot de vêtements', 'Autre'], filterable: true },
    { key: 'sexe', label: 'Pour', type: 'select', options: ['Fille', 'Garçon', 'Mixte'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40, filterable: true },
  ],

  // ---------- Animaux ----------
  'animaux': [],
  'animaux-vente-don': [
    { key: 'type_animal', label: 'Animal', type: 'select', required: true, options: ANIMAUX, filterable: true },
    { key: 'race', label: 'Race', type: 'text', maxLength: 40, filterable: true },
    { key: 'age', label: 'Âge', type: 'select', options: AGES_ANIMAL, filterable: true },
    { key: 'sexe', label: 'Sexe', type: 'select', options: ['Mâle', 'Femelle', 'Non précisé'], filterable: true },
    // Obligation légale française (loi du 30 novembre 2021) pour chiens et chats
    { key: 'identification', label: 'N° d\'identification (I-CAD) ou SIREN de l\'éleveur', type: 'text', required: true, maxLength: 20 },
    { key: 'vaccine', label: 'Vacciné', type: 'boolean' },
    { key: 'lof', label: 'Inscrit au LOF / LOOF', type: 'boolean' },
  ],
  'accessoires-animaux': [
    { key: 'animal', label: 'Animal concerné', type: 'select', options: ['Chien', 'Chat', 'Rongeur', 'Oiseau', 'Poisson / Aquarium', 'Reptile / Terrarium', 'Cheval', 'Autre'], filterable: true },
    { key: 'type_accessoire', label: 'Type', type: 'select', options: ['Cage / Niche / Enclos', 'Aquarium / Terrarium', 'Alimentation', 'Jouet', 'Transport', 'Toilettage / Soins', 'Sellerie / Équitation', 'Autre'], filterable: true },
    { key: 'marque', label: 'Marque', type: 'text', maxLength: 40 },
  ],
  'animaux-dons': [
    { key: 'type_animal', label: 'Animal', type: 'select', required: true, options: ANIMAUX, filterable: true },
    { key: 'race', label: 'Race', type: 'text', maxLength: 40, filterable: true },
    { key: 'age', label: 'Âge', type: 'select', options: AGES_ANIMAL, filterable: true },
    { key: 'sexe', label: 'Sexe', type: 'select', options: ['Mâle', 'Femelle', 'Non précisé'], filterable: true },
    { key: 'identification', label: 'N° d\'identification (I-CAD) — obligatoire chiens et chats', type: 'text', required: true, maxLength: 20 },
    { key: 'vaccine', label: 'Vacciné', type: 'boolean' },
  ],
  'animaux-perdus': [
    { key: 'situation', label: 'Situation', type: 'select', required: true, options: ['Perdu', 'Trouvé'], filterable: true },
    { key: 'type_animal', label: 'Animal', type: 'select', required: true, options: ['Chien', 'Chat', 'Oiseau', 'Rongeur', 'Autre'], filterable: true },
    { key: 'race', label: 'Race / description', type: 'text', maxLength: 60 },
    { key: 'date_evenement', label: 'Date', type: 'text', maxLength: 20 },
    { key: 'identification', label: 'N° d\'identification (si connu)', type: 'text', maxLength: 20 },
  ],
  'animaux-autres': [],
};

/**
 * Options acceptées pour un select : liste fixe, ou liste dépendante de la valeur d'un autre champ
 * (modèles de la marque choisie ; toutes les listes si la marque est absente ou inconnue).
 */
export function allowedOptions(field: FieldSchema, input: Record<string, unknown>): string[] {
  if (!field.dependsOn || !field.optionsByParent) return field.options ?? [];
  const parent = input[field.dependsOn];
  if (typeof parent === 'string' && field.optionsByParent[parent]) return field.optionsByParent[parent];
  return tousModelesOf(field.optionsByParent);
}

export function getSchemaForSlugs(slug: string, parentSlug?: string): FieldSchema[] {
  const own = CATEGORY_SCHEMAS[slug];
  if (own && own.length > 0) return own;
  if (parentSlug && CATEGORY_SCHEMAS[parentSlug]) return CATEGORY_SCHEMAS[parentSlug];
  return own || [];
}

/**
 * Valide et nettoie les attributs envoyés par le client selon le schéma.
 * - Les clés inconnues sont ignorées (whitelist).
 * - Les champs requis doivent être présents.
 * - Les types / options / bornes sont contrôlés.
 * Renvoie la liste des erreurs (vide si OK) et l'objet nettoyé.
 */
export function validateAttributes(
  schema: FieldSchema[],
  raw: Record<string, unknown> | undefined,
  { requireRequired = true }: { requireRequired?: boolean } = {},
): { errors: string[]; clean: Record<string, string | number | boolean> } {
  const errors: string[] = [];
  const clean: Record<string, string | number | boolean> = {};
  const input = raw || {};

  for (const field of schema) {
    const value = input[field.key];
    if (value === undefined || value === null || value === '') {
      if (field.required && requireRequired) errors.push(`Le champ "${field.label}" est obligatoire.`);
      continue;
    }
    switch (field.type) {
      case 'number': {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) { errors.push(`"${field.label}" doit être un nombre.`); break; }
        if (field.min !== undefined && n < field.min) { errors.push(`"${field.label}" doit être ≥ ${field.min}.`); break; }
        if (field.max !== undefined && n > field.max) { errors.push(`"${field.label}" doit être ≤ ${field.max}.`); break; }
        clean[field.key] = n;
        break;
      }
      case 'boolean': {
        if (typeof value === 'boolean') clean[field.key] = value;
        else if (value === 'true' || value === 'false') clean[field.key] = value === 'true';
        else errors.push(`"${field.label}" doit être vrai ou faux.`);
        break;
      }
      case 'select': {
        const allowed = allowedOptions(field, input);
        if (typeof value !== 'string' || !allowed.includes(value)) {
          errors.push(`"${field.label}" doit être l'une des valeurs proposées.`);
        } else clean[field.key] = value;
        break;
      }
      case 'text': {
        if (typeof value !== 'string') { errors.push(`"${field.label}" doit être un texte.`); break; }
        const trimmed = value.trim();
        if (trimmed.length > (field.maxLength ?? 100)) { errors.push(`"${field.label}" est trop long.`); break; }
        if (/[<>]/.test(trimmed)) { errors.push(`"${field.label}" contient des caractères interdits.`); break; }
        clean[field.key] = trimmed;
        break;
      }
    }
  }
  return { errors, clean };
}
