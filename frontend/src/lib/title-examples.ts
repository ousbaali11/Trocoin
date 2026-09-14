/**
 * Exemples de titre par catégorie pour le dépôt d'annonce, rédigés d'après
 * les titres réels observés sur leboncoin le 14 septembre 2026 (une annonce
 * par famille : « Volkswagen Polo 1.0 MPI 80ch », « Maison 4 pièces 99 m² »,
 * « Veste femme noire en cuir T : M ou 38 », « Fauteuil convertible IKEA
 * LYCKSELE », « iPhone 13 Pro avec facture », « Tapis de course », « Chiot
 * chow chow mâle LOF », « Poussette Bébé Confort Haze trio », « Piano
 * Mussard »…). Les exemples ci-dessous sont des reformulations, pas des copies.
 * Clé = slug de catégorie (sous-catégorie prioritaire, puis famille).
 */
const EXAMPLES: Record<string, string> = {
  // Immobilier
  immobilier: "Ex. : Appartement 3 pièces 65 m² avec balcon",
  "ventes-immobilieres": "Ex. : Maison 5 pièces 110 m² avec jardin, Plougastel",
  locations: "Ex. : Appartement 2 pièces 45 m² meublé, proche gare",
  colocations: "Ex. : Chambre 14 m² dans colocation de 3, centre-ville",
  "bureaux-commerces": "Ex. : Local commercial 80 m² avec vitrine, rue passante",
  terrains: "Ex. : Terrain constructible 650 m² viabilisé",
  // Véhicules
  vehicules: "Ex. : Renault Clio 1.0 TCe 90 Zen, 2020, 42 000 km",
  voitures: "Ex. : Peugeot 208 1.2 PureTech 100 Allure, 2019, 45 000 km",
  motos: "Ex. : Yamaha MT-07, 2021, 12 500 km, A2 possible",
  caravaning: "Ex. : Camping-car profilé Chausson 2016, 4 couchages",
  utilitaires: "Ex. : Renault Trafic L2H1 dCi 120, 2018, 98 000 km",
  nautisme: "Ex. : Bateau open Quicksilver 505 avec remorque, moteur 60 ch",
  "pieces-auto": "Ex. : 4 jantes alu 17 pouces Peugeot 3008 avec pneus",
  // Matériel pro
  "materiel-professionnel": "Ex. : Machine à café professionnelle 2 groupes, révisée",
  btp: "Ex. : Mini-pelle Kubota 1,5 t, 2015, 2 300 h",
  agricole: "Ex. : Pulvérisateur porté 800 L, 2009",
  "restauration-hotellerie": "Ex. : Four mixte 10 niveaux + table inox",
  "fournitures-bureau": "Ex. : Lot de 6 fauteuils de bureau ergonomiques",
  // Emploi
  emploi: "Ex. : Électrotechnicien de maintenance (H/F) – CDI",
  "offres-emploi": "Ex. : Vendeur en boulangerie (H/F) – CDI temps plein",
  formations: "Ex. : Formation CACES R489 catégories 1, 3 et 5",
  // Mode
  mode: "Ex. : Veste en cuir femme noire, taille 38",
  vetements: "Ex. : Veste en cuir femme noire, taille 38, très bon état",
  chaussures: "Ex. : Baskets Nike Air Max 90, pointure 42, portées 2 fois",
  "accessoires-bagagerie": "Ex. : Sac à main Longchamp Le Pliage, bleu marine",
  "montres-bijoux": "Ex. : Montre Seiko 5 automatique, bracelet acier",
  // Maison & Jardin
  "maison-jardin": "Ex. : Canapé convertible 3 places IKEA, tissu gris",
  ameublement: "Ex. : Canapé convertible 3 places IKEA, tissu gris",
  electromenager: "Ex. : Lave-linge Bosch 8 kg, classe A, 2022",
  decoration: "Ex. : Miroir rond en rotin 80 cm",
  bricolage: "Ex. : Perceuse-visseuse Bosch 18 V avec 2 batteries",
  jardinage: "Ex. : Tondeuse thermique Honda 46 cm, tractée",
  // Famille
  famille: "Ex. : Poussette trio Bébé Confort, noire, complète",
  puericulture: "Ex. : Poussette trio Bébé Confort Haze, noire",
  "mobilier-bebe": "Ex. : Lit bébé évolutif 70x140 avec matelas",
  "vetements-bebe": "Ex. : Lot de 10 bodies 6 mois, Petit Bateau",
  // Électronique
  multimedia: "Ex. : iPhone 13 Pro 128 Go avec facture et garantie",
  telephonie: "Ex. : iPhone 13 Pro 128 Go, facture et garantie",
  informatique: "Ex. : PC portable Dell 15 pouces, i5, 16 Go RAM, 512 Go SSD",
  "consoles-jeux-video": "Ex. : PS5 édition standard avec 2 manettes et 3 jeux",
  "image-son": "Ex. : TV Samsung 55 pouces 4K, 2021, avec télécommande",
  // Loisirs
  loisirs: "Ex. : Tapis de course pliable, peu servi",
  livres: "Ex. : Lot de 12 romans policiers (Vargas, Lemaitre)",
  "musique-instruments": "Ex. : Piano droit Yamaha, révisé et accordé",
  "sports-hobbies": "Ex. : Tapis de course pliable, moteur 2 CV",
  velos: "Ex. : VTT Rockrider 540, taille M, freins à disque",
  "jeux-jouets": "Ex. : Lego City 60198 complet avec notice",
  collection: "Ex. : Album de timbres France 1960-1990",
  // Vacances
  vacances: "Ex. : Gîte 4 personnes avec piscine, Ardèche",
  // Services
  services: "Ex. : Cours de guitare à domicile, tous niveaux",
  demenagement: "Ex. : Déménagement avec camion 20 m³ et 2 personnes",
  "reparations-mecaniques": "Ex. : Entretien et révision auto à domicile",
  "jardinerie-bricolage": "Ex. : Tonte de pelouse et taille de haies",
  "services-a-la-personne": "Ex. : Aide à domicile pour personnes âgées, le matin",
  "services-animaux": "Ex. : Garde de chien à mon domicile, jardin clos",
  "baby-sitting": "Ex. : Baby-sitting le soir et le week-end, étudiante",
  "artistes-musiciens": "Ex. : Groupe de jazz pour mariage et soirée",
  evenementiel: "Ex. : Location de photobooth pour votre événement",
  "reparations-electroniques": "Ex. : Réparation d'écran de smartphone en 1 h",
  "entraide-voisins": "Ex. : Prêt de perceuse et aide au montage de meubles",
  billetterie: "Ex. : 2 places concert Indochine, Paris, 12 octobre",
  evenements: "Ex. : Vide-grenier de la Croix-Rousse, dimanche 20",
  covoiturage: "Ex. : Lyon → Paris, vendredi 18 h, 2 places",
  "cours-particuliers": "Ex. : Cours de maths lycée, à domicile ou en visio",
  "autres-services": "Ex. : Rédaction de CV et lettre de motivation",
  // Animaux
  animaux: "Ex. : Chiot chow-chow mâle LOF, vacciné, 3 mois",
  "animaux-vente-don": "Ex. : Chiot chow-chow mâle LOF, vacciné, 3 mois",
  "accessoires-animaux": "Ex. : Cage à lapin 120 cm avec accessoires",
  "animaux-perdus": "Ex. : Chat tigré perdu quartier Guillotière, 12/09",
  "animaux-dons": "Ex. : Donne 3 chatons sevrés de 2 mois",
};

const DEFAULT = "Ex. : Objet précis, marque ou modèle, état";

export function titleExample(slug?: string, rootSlug?: string): string {
  if (slug && EXAMPLES[slug]) return EXAMPLES[slug];
  if (rootSlug && EXAMPLES[rootSlug]) return EXAMPLES[rootSlug];
  return DEFAULT;
}
