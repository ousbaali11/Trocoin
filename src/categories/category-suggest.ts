import { Category } from './category.entity';

/**
 * Suggestion de catégorie à partir des mots du titre saisi au dépôt d'une annonce.
 * Dictionnaire de mots-clés par sous-catégorie (racines et pluriels simples), complété par les
 * mots du nom de la catégorie. Score = nombre de mots du titre qui touchent la catégorie ; à
 * égalité, la catégorie la plus spécifique (mot-clé le plus long) passe devant.
 */
const KEYWORDS: Record<string, string[]> = {
  // Immobilier
  'ventes-immobilieres': ['maison', 'appartement', 'villa', 'studio', 't2', 't3', 't4', 'f2', 'f3', 'pavillon', 'duplex', 'loft', '+vente', '+vend', '+a vendre', 'pieces', 'immeuble', 'mas', 'longere'],
  locations: ['+location', '+loue', '+louer', '+loyer', '+a louer', 'appartement', 'studio', 'chambre', 'meuble', 'meublee', 'colocation', 't2', 't3', 't4', 'f2', 'f3', 'pieces'],
  colocations: ['colocation', 'coloc', 'colocataire', 'chambre'],
  'bureaux-commerces': ['bureau', 'bureaux', 'local', 'commerce', 'commercial', 'entrepot', 'boutique', 'atelier', 'fonds'],
  terrains: ['terrain', 'parcelle', 'constructible', 'agricole', 'bois', 'hectare', 'ares'],
  // Véhicules
  voitures: ['voiture', 'auto', 'berline', 'citadine', 'suv', 'break', 'monospace', 'cabriolet', 'peugeot', 'renault', 'citroen', 'dacia', 'volkswagen', 'toyota', 'bmw', 'mercedes', 'audi', 'ford', 'opel', 'fiat', 'tesla', 'clio', '208', '308', 'golf', 'polo', 'twingo', 'megane', 'yaris', 'sandero', 'duster', 'kilometres', 'km', 'diesel', 'essence', 'hybride', 'ct'],
  motos: ['moto', 'scooter', 'roadster', 'trail', 'custom', 'yamaha', 'kawasaki', 'honda', 'ducati', 'ktm', 'harley', 'triumph', 'vespa', 'piaggio', 'cm3', '125', '50cc', 'enduro', 'cross', 'motocross'],
  caravaning: ['camping-car', 'campingcar', 'caravane', 'van', 'amenage', 'fourgon amenage', 'mobil-home', 'mobilhome', 'remorque'],
  utilitaires: ['utilitaire', 'camion', 'fourgon', 'camionnette', 'benne', 'trafic', 'master', 'jumpy', 'jumper', 'transit', 'sprinter', 'kangoo', 'berlingo', 'partner', 'ducato', 'plateau'],
  nautisme: ['bateau', 'voilier', 'jet-ski', 'jetski', 'semi-rigide', 'kayak', 'paddle', 'moteur hors-bord', 'hors-bord', 'annexe', 'catamaran', 'zodiac'],
  'pieces-auto': ['pneu', 'pneus', 'jante', 'jantes', 'pare-choc', 'parechoc', 'phare', 'retroviseur', 'alternateur', 'batterie', 'embrayage', 'moteur', 'boite de vitesses', 'siege auto', 'attelage', 'coffre de toit', 'barres de toit', 'plaquettes', 'disques'],
  // Matériel pro
  btp: ['betonniere', 'echafaudage', 'pelle', 'mini-pelle', 'minipelle', 'tractopelle', 'chantier', 'compacteur', 'nacelle', 'perforateur', 'marteau-piqueur', 'bulldozer', 'chariot elevateur', 'transpalette', 'poids lourd', 'poids lourds'],
  agricole: ['tracteur', 'remorque agricole', 'charrue', 'semoir', 'pulverisateur', 'moissonneuse', 'fenaison', 'presse', 'broyeur', 'girobroyeur', 'cloture', 'abreuvoir', 'elevage', 'kubota', 'massey', 'john deere', 'deutz'],
  'restauration-hotellerie': ['friteuse', 'four professionnel', 'plancha', 'chambre froide', 'vitrine refrigeree', 'lave-vaisselle professionnel', 'machine a cafe', 'percolateur', 'bar', 'restaurant', 'hotel', 'trancheuse', 'inox'],
  'fournitures-bureau': ['photocopieur', 'imprimante professionnelle', 'bureau', 'fauteuil de bureau', 'armoire de bureau', 'papeterie', 'plastifieuse', 'destructeur', 'caisse enregistreuse', 'tpe', 'presentoir', 'mannequin'],
  // Emploi
  'offres-emploi': ['emploi', 'cdi', 'cdd', 'interim', 'recrute', 'recrutement', 'poste', 'embauche', 'alternance', 'apprenti', 'stage', 'temps plein', 'temps partiel', 'serveur', 'vendeur', 'chauffeur', 'livreur', 'commercial', 'developpeur', 'infirmier', 'aide-soignant'],
  formations: ['formation', 'certification', 'diplome', 'cours professionnel', 'permis', 'caces', 'bts', 'cap', 'reconversion'],
  // Mode
  vetements: ['robe', 'jean', 'pantalon', 'pull', 'manteau', 'veste', 'blouson', 'doudoune', 'chemise', 't-shirt', 'tshirt', 'sweat', 'jupe', 'short', 'costume', 'lingerie', 'maillot de bain', 'taille'],
  chaussures: ['chaussure', 'chaussures', 'baskets', 'basket', 'sneakers', 'bottes', 'bottines', 'escarpins', 'sandales', 'nike', 'adidas', 'pointure'],
  'accessoires-bagagerie': ['sac', 'sac a main', 'valise', 'sac a dos', 'portefeuille', 'ceinture', 'echarpe', 'foulard', 'lunettes de soleil', 'chapeau', 'casquette', 'gants', 'parapluie'],
  'montres-bijoux': ['montre', 'bijou', 'bijoux', 'bague', 'collier', 'bracelet', 'boucles', 'or', 'argent', 'diamant', 'rolex', 'seiko', 'swatch'],
  // Maison & jardin
  ameublement: ['canape', 'fauteuil', 'table', 'chaise', 'chaises', 'lit', 'matelas', 'sommier', 'armoire', 'commode', 'bureau', 'etagere', 'bibliotheque', 'buffet', 'meuble', 'meubles', 'tabouret', 'banc', 'ikea', 'salon', 'salle a manger', 'dressing', 'tete de lit'],
  electromenager: ['lave-linge', 'lave linge', 'machine a laver', 'seche-linge', 'lave-vaisselle', 'refrigerateur', 'frigo', 'congelateur', 'four', 'micro-ondes', 'plaque', 'induction', 'aspirateur', 'robot', 'thermomix', 'cafetiere', 'nespresso', 'hotte', 'climatiseur', 'ventilateur', 'fer a repasser', 'bouilloire', 'grille-pain'],
  decoration: ['deco', 'decoration', 'lampe', 'lampe de bureau', 'lampe de chevet', 'applique', 'lampadaire', 'miroir', 'tapis', 'rideau', 'rideaux', 'cadre', 'tableau', 'vase', 'bougie', 'coussin', 'vaisselle', 'assiettes', 'verres', 'couverts', 'plaid', 'horloge', 'luminaire', 'suspension'],
  bricolage: ['perceuse', 'visseuse', 'scie', 'ponceuse', 'meuleuse', 'outil', 'outils', 'outillage', 'bosch', 'makita', 'dewalt', 'echelle', 'escabeau', 'carrelage', 'parquet', 'peinture', 'radiateur', 'chauffage', 'poele', 'chaudiere', 'lavabo', 'robinet', 'porte', 'fenetre', 'vis', 'compresseur'],
  jardinage: ['tondeuse', 'taille-haie', 'debroussailleuse', 'tronconneuse', 'salon de jardin', 'barbecue', 'plancha', 'parasol', 'jardin', 'plantes', 'plante', 'pot', 'jardiniere', 'serre', 'abri de jardin', 'piscine', 'spa', 'tuyau', 'arrosage', 'brouette', 'engrais', 'olivier', 'palmier'],
  // Famille
  puericulture: ['poussette', 'siege auto', 'cosy', 'porte-bebe', 'chaise haute', 'transat', 'baignoire bebe', 'lit parapluie', 'babyphone', 'biberon', 'sterilisateur', 'tire-lait', 'trotteur', 'tapis d eveil', 'yoyo', 'cybex', 'bebe confort', 'maxi-cosi'],
  'mobilier-bebe': ['lit bebe', 'lit enfant', 'berceau', 'commode a langer', 'table a langer', 'lit evolutif', 'parc bebe', 'chambre bebe', 'chambre enfant', 'armoire enfant'],
  'vetements-bebe': ['body', 'pyjama bebe', 'vetements bebe', 'lot bebe', 'naissance', 'mois', 'gigoteuse', 'turbulette', 'combinaison bebe', 'chaussons'],
  // Électronique
  telephonie: ['iphone', 'samsung galaxy', 'smartphone', 'telephone', 'portable', 'xiaomi', 'huawei', 'oneplus', 'pixel', 'coque', 'chargeur', 'ecouteurs', 'airpods', 'montre connectee', 'apple watch', 'go'],
  informatique: ['ordinateur', 'pc', 'portable', 'macbook', 'imac', 'laptop', 'ecran', 'clavier', 'souris', 'imprimante', 'disque dur', 'ssd', 'carte graphique', 'processeur', 'tablette', 'ipad', 'routeur', 'nas', 'webcam'],
  'consoles-jeux-video': ['playstation', 'ps5', 'ps4', 'xbox', 'nintendo', 'switch', 'console', 'manette', 'jeu video', 'jeux video', 'zelda', 'mario', 'fifa', 'gta', 'steam deck', 'casque vr'],
  'image-son': ['television', 'tv', 'tele', 'oled', 'enceinte', 'barre de son', 'casque', 'home cinema', 'ampli', 'platine', 'vinyle', 'appareil photo', 'canon', 'nikon', 'sony', 'objectif', 'projecteur', 'videoprojecteur', 'camera', 'gopro', 'drone', 'hifi'],
  // Loisirs
  livres: ['livre', 'livres', 'roman', 'bd', 'manga', 'bande dessinee', 'tome', 'encyclopedie', 'dictionnaire', 'poche', 'harry potter', 'asterix', 'tintin'],
  'musique-instruments': ['guitare', 'piano', 'clavier', 'batterie', 'synthe', 'synthetiseur', 'violon', 'flute', 'saxophone', 'trompette', 'ukulele', 'ampli guitare', 'micro', 'table de mixage', 'partition', 'yamaha', 'fender', 'gibson'],
  'sports-hobbies': ['velo d appartement', 'tapis de course', 'halteres', 'banc de musculation', 'ski', 'skis', 'snowboard', 'surf', 'planche', 'raquette', 'tennis', 'football', 'ballon', 'rugby', 'golf', 'peche', 'canne a peche', 'tente', 'sac de couchage', 'randonnee', 'chaussures de ski', 'combinaison', 'kayak', 'trottinette', 'rollers', 'skate', 'yoga', 'boxe', 'judo', 'equitation', 'selle'],
  velos: ['velo', 'vtt', 'vtc', 'velo electrique', 'vae', 'velo de route', 'gravel', 'bmx', 'velo enfant', 'velo pliant', 'decathlon', 'rockrider', 'btwin', 'lapierre', 'trek', 'specialized', 'giant', 'cadre', 'pouces'],
  'jeux-jouets': ['jouet', 'jouets', 'lego', 'playmobil', 'poupee', 'peluche', 'puzzle', 'jeu de societe', 'jeux de societe', 'monopoly', 'figurine', 'voiture telecommandee', 'circuit', 'trottinette enfant', 'draisienne', 'barbie', 'pokemon cartes'],
  collection: ['collection', 'timbres', 'pieces', 'monnaie', 'monnaies', 'medaille', 'militaria', 'ancien', 'antiquite', 'vintage', 'carte pokemon', 'cartes a collectionner', 'figurine de collection', 'vinyles collection', 'affiche', 'bd ancienne'],
  // Vacances
  vacances: ['location vacances', 'gite', 'chalet', 'chambre d hotes', 'camping', 'mobil-home vacances', 'semaine', 'vue mer', 'bord de mer', 'montagne', 'piscine privee', 'vacances', 'sejour', 'appartement vacances', 'villa vacances'],
  // Services
  demenagement: ['demenagement', 'demenageur', 'transport de meubles', 'cartons', 'garde-meuble', 'monte-meuble'],
  'reparations-mecaniques': ['mecanicien', 'reparation auto', 'vidange', 'carrosserie', 'pneus montage', 'diagnostic', 'controle technique', 'garage'],
  'jardinerie-bricolage': ['jardinier', 'bricoleur', 'plombier', 'electricien', 'peintre', 'macon', 'menuisier', 'carreleur', 'tonte', 'taille', 'elagage', 'travaux', 'renovation', 'artisan'],
  'services-a-la-personne': ['aide a domicile', 'menage', 'repassage', 'garde d enfants', 'nounou', 'auxiliaire de vie', 'aide aux courses', 'assistance', 'accompagnement'],
  'services-animaux': ['garde de chien', 'garde de chat', 'pet-sitting', 'petsitting', 'promenade chien', 'toilettage', 'pension canine', 'dressage', 'educateur canin'],
  'baby-sitting': ['baby-sitting', 'babysitting', 'baby-sitter', 'babysitter', 'garde enfant', 'garde d enfants', 'nounou', 'sortie d ecole'],
  'artistes-musiciens': ['musicien', 'chanteur', 'chanteuse', 'dj', 'groupe de musique', 'orchestre', 'magicien', 'comedien', 'illustrateur', 'photographe mariage'],
  evenementiel: ['mariage', 'anniversaire', 'evenement', 'traiteur', 'location de salle', 'location de tables', 'chapiteau', 'tente de reception', 'animation', 'photobooth', 'sonorisation'],
  'reparations-electroniques': ['reparation telephone', 'reparation smartphone', 'reparation ordinateur', 'depannage informatique', 'ecran casse', 'reparation console', 'reparation tv'],
  'entraide-voisins': ['entraide', 'coup de main', 'pret de materiel', 'covoiturage courses', 'aide voisin', 'benevole', 'service rendu'],
  billetterie: ['billet', 'billets', 'place de concert', 'places', 'concert', 'festival', 'match', 'spectacle', 'theatre', 'parc d attractions', 'disneyland', 'ticket'],
  evenements: ['brocante', 'vide-grenier', 'vide grenier', 'atelier', 'rencontre', 'salon', 'foire', 'marche de noel', 'conference', 'stage de'],
  covoiturage: ['covoiturage', 'trajet', 'depart', 'arrivee', 'blablacar', 'partage de trajet'],
  'cours-particuliers': ['cours particulier', 'cours particuliers', 'cours de', 'soutien scolaire', 'professeur', 'prof', 'mathematiques', 'maths', 'anglais', 'francais', 'physique', 'guitare cours', 'piano cours', 'aide aux devoirs', 'preparation bac'],
  'autres-services': ['service', 'prestation', 'devis'],
  // Animaux
  'animaux-vente-don': ['chiot', 'chiots', 'chaton', 'chatons', 'chien', 'chat', 'lapin', 'hamster', 'cochon d inde', 'perruche', 'perroquet', 'canari', 'poisson', 'aquarium poissons', 'tortue', 'serpent', 'gecko', 'cheval', 'poney', 'jument', 'poule', 'poules', 'chevre', 'mouton', 'lof', 'loof', 'race', 'eleveur', 'portee'],
  'accessoires-animaux': ['cage', 'niche', 'panier chien', 'arbre a chat', 'litiere', 'aquarium', 'terrarium', 'laisse', 'harnais', 'croquettes', 'gamelle', 'selle cheval', 'clapier', 'poulailler', 'transport chat', 'caisse de transport'],
  'animaux-perdus': ['perdu', 'perdue', 'trouve', 'trouvee', 'disparu', 'disparue', 'recherche chat', 'recherche chien', 'egare'],
  'animaux-dons': ['donne', 'a donner', 'don', 'adoption', 'adopter', 'sauvetage', 'refuge'],
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[''`]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singular(w: string): string {
  return w.length >= 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w;
}

export interface CategorySuggestion {
  slug: string;
  name: string;
  rootSlug?: string;
  rootName?: string;
  score: number;
}

/** Jusqu'à `limit` catégories (feuilles) classées par score décroissant ; vide si rien ne correspond. */
export function suggestCategories(title: string, categories: Category[], limit = 3): CategorySuggestion[] {
  const text = ` ${normalize(title)} `;
  if (text.trim().length < 3) return [];
  const words = text.trim().split(' ').map(singular);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const hasChildren = new Set(categories.filter((c) => c.parentId).map((c) => c.parentId!));
  const results: CategorySuggestion[] = [];
  for (const c of categories) {
    if (hasChildren.has(c.id)) continue; // seules les feuilles reçoivent des annonces
    const keys = [...(KEYWORDS[c.slug] || []), ...normalize(c.name).split(' ').filter((w) => w.length >= 4)];
    let score = 0;
    let best = 0;
    for (const raw of keys) {
      // Un mot-clé préfixé par « + » est décisif (louer / vendre) : il pèse le double
      const strong = raw.startsWith('+');
      const key = normalize(strong ? raw.slice(1) : raw);
      if (!key) continue;
      const hit = key.includes(' ') || key.includes('-') ? text.includes(` ${key} `) || text.includes(` ${key}s `) : words.includes(singular(key));
      if (hit) {
        score += (key.includes(' ') ? 2 : 1) * (strong ? 2 : 1);
        best = Math.max(best, key.length);
      }
    }
    if (score > 0) {
      const root = c.parentId ? byId.get(c.parentId) : undefined;
      results.push({ slug: c.slug, name: c.name, rootSlug: root?.slug, rootName: root?.name, score: score + best / 100 });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit).map((r) => ({ ...r, score: Math.round(r.score * 100) / 100 }));
}
