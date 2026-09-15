/**
 * Référentiel marque → modèles pour les véhicules (voitures, motos, utilitaires).
 *
 * Fichier statique maintenu à la main (pas d'API tierce) : marques présentes sur le marché
 * français de l'occasion, modèles courants des 25 dernières années. Chaque marque se termine
 * par « Autre » pour les modèles rares ; la marque « Autre » accepte n'importe quel modèle de
 * la liste générique. Pour ajouter un modèle : compléter le tableau de la marque, rien d'autre
 * à modifier (le schéma de catégorie et le formulaire lisent ce fichier).
 */

const AUTRE = 'Autre';

export const MODELES_VOITURES: Record<string, string[]> = {
  Abarth: ['500', '595', '695', '124 Spider', AUTRE],
  'Alfa Romeo': ['147', '156', '159', '166', 'Brera', 'Giulia', 'Giulietta', 'GT', 'GTV', 'Junior', 'MiTo', 'Spider', 'Stelvio', 'Tonale', AUTRE],
  'Aston Martin': ['DB9', 'DB11', 'DB12', 'DBS', 'DBX', 'Rapide', 'Vantage', AUTRE],
  Audi: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'e-tron', 'e-tron GT', 'Q2', 'Q3', 'Q4 e-tron', 'Q5', 'Q7', 'Q8', 'R8', 'RS3', 'RS4', 'RS5', 'RS6', 'S3', 'S4', 'S5', 'TT', AUTRE],
  Bentley: ['Bentayga', 'Continental', 'Flying Spur', 'Mulsanne', AUTRE],
  BMW: ['Série 1', 'Série 2', 'Série 3', 'Série 4', 'Série 5', 'Série 6', 'Série 7', 'Série 8', 'i3', 'i4', 'i5', 'i7', 'iX', 'iX1', 'iX3', 'M2', 'M3', 'M4', 'M5', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z3', 'Z4', AUTRE],
  BYD: ['Atto 3', 'Dolphin', 'Han', 'Seal', 'Seal U', 'Tang', AUTRE],
  Chevrolet: ['Aveo', 'Camaro', 'Captiva', 'Corvette', 'Cruze', 'Kalos', 'Lacetti', 'Matiz', 'Orlando', 'Spark', 'Trax', AUTRE],
  Chrysler: ['300C', 'Crossfire', 'Grand Voyager', 'PT Cruiser', 'Sebring', 'Voyager', AUTRE],
  Citroën: ['AX', 'Berlingo', 'BX', 'C1', 'C2', 'C3', 'C3 Aircross', 'C3 Picasso', 'C4', 'C4 Cactus', 'C4 Picasso', 'C4 SpaceTourer', 'C5', 'C5 Aircross', 'C5 X', 'C6', 'C8', 'C-Crosser', 'C-Zéro', 'DS3', 'DS4', 'DS5', 'ë-C4', 'Grand C4 Picasso', 'Jumper', 'Jumpy', 'Nemo', 'Saxo', 'SpaceTourer', 'Xantia', 'Xsara', 'Xsara Picasso', 'ZX', AUTRE],
  Cupra: ['Ateca', 'Born', 'Formentor', 'Leon', 'Tavascan', 'Terramar', AUTRE],
  Dacia: ['Bigster', 'Dokker', 'Duster', 'Jogger', 'Lodgy', 'Logan', 'Sandero', 'Spring', AUTRE],
  Daihatsu: ['Charade', 'Copen', 'Cuore', 'Sirion', 'Terios', 'YRV', AUTRE],
  Dodge: ['Caliber', 'Challenger', 'Charger', 'Journey', 'Nitro', 'RAM', AUTRE],
  DS: ['DS 3', 'DS 3 Crossback', 'DS 4', 'DS 5', 'DS 7', 'DS 7 Crossback', 'DS 9', 'N°8', AUTRE],
  Ferrari: ['296', '458', '488', '812', 'California', 'F8', 'Portofino', 'Purosangue', 'Roma', 'SF90', AUTRE],
  Fiat: ['500', '500C', '500L', '500X', '600', 'Bravo', 'Croma', 'Doblo', 'Ducato', 'Fiorino', 'Freemont', 'Grande Punto', 'Idea', 'Multipla', 'Panda', 'Punto', 'Qubo', 'Scudo', 'Sedici', 'Stilo', 'Tipo', 'Ulysse', AUTRE],
  Ford: ['B-Max', 'C-Max', 'EcoSport', 'Edge', 'Escort', 'Explorer', 'Fiesta', 'Focus', 'Fusion', 'Galaxy', 'Grand C-Max', 'Ka', 'Ka+', 'Kuga', 'Mondeo', 'Mustang', 'Mustang Mach-E', 'Puma', 'Ranger', 'S-Max', 'Tourneo', 'Transit', AUTRE],
  Honda: ['Accord', 'Civic', 'CR-V', 'CR-Z', 'e', 'FR-V', 'HR-V', 'Insight', 'Jazz', 'Legend', 'S2000', 'ZR-V', AUTRE],
  Hyundai: ['Accent', 'Atos', 'Bayon', 'Coupé', 'Elantra', 'Getz', 'i10', 'i20', 'i30', 'i40', 'Ioniq', 'Ioniq 5', 'Ioniq 6', 'ix20', 'ix35', 'Kona', 'Matrix', 'Santa Fe', 'Sonata', 'Trajet', 'Tucson', 'Veloster', AUTRE],
  Infiniti: ['Q30', 'Q50', 'Q70', 'QX30', 'QX50', 'QX70', AUTRE],
  Isuzu: ['D-Max', 'Trooper', AUTRE],
  Jaguar: ['E-Pace', 'F-Pace', 'F-Type', 'I-Pace', 'S-Type', 'X-Type', 'XE', 'XF', 'XJ', 'XK', AUTRE],
  Jeep: ['Avenger', 'Cherokee', 'Commander', 'Compass', 'Gladiator', 'Grand Cherokee', 'Patriot', 'Renegade', 'Wrangler', AUTRE],
  Kia: ['Carens', 'Carnival', 'Cee\'d', 'Cerato', 'EV3', 'EV6', 'EV9', 'Niro', 'Optima', 'Picanto', 'ProCeed', 'Rio', 'Sorento', 'Soul', 'Sportage', 'Stinger', 'Stonic', 'Venga', 'XCeed', AUTRE],
  Lada: ['Granta', 'Kalina', 'Niva', 'Priora', 'Vesta', AUTRE],
  Lamborghini: ['Aventador', 'Gallardo', 'Huracán', 'Revuelto', 'Urus', AUTRE],
  Lancia: ['Delta', 'Lybra', 'Musa', 'Phedra', 'Thema', 'Thesis', 'Voyager', 'Y', 'Ypsilon', AUTRE],
  'Land Rover': ['Defender', 'Discovery', 'Discovery Sport', 'Freelander', 'Range Rover', 'Range Rover Evoque', 'Range Rover Sport', 'Range Rover Velar', AUTRE],
  Lexus: ['CT', 'ES', 'GS', 'IS', 'LBX', 'LC', 'LS', 'NX', 'RC', 'RX', 'RZ', 'UX', AUTRE],
  Lotus: ['Elise', 'Eletre', 'Emira', 'Evora', 'Exige', AUTRE],
  Maserati: ['Ghibli', 'GranCabrio', 'GranTurismo', 'Grecale', 'Levante', 'MC20', 'Quattroporte', AUTRE],
  Mazda: ['2', '3', '5', '6', 'CX-3', 'CX-30', 'CX-5', 'CX-60', 'CX-7', 'CX-80', 'MX-30', 'MX-5', 'RX-8', AUTRE],
  'Mercedes-Benz': ['Classe A', 'Classe B', 'Classe C', 'Classe E', 'Classe G', 'Classe S', 'Classe V', 'Citan', 'CLA', 'CLK', 'CLS', 'EQA', 'EQB', 'EQC', 'EQE', 'EQS', 'GLA', 'GLB', 'GLC', 'GLE', 'GLK', 'GLS', 'ML', 'SL', 'SLC', 'SLK', 'Sprinter', 'Vito', AUTRE],
  MG: ['MG3', 'MG4', 'MG5', 'EHS', 'HS', 'Marvel R', 'ZS', AUTRE],
  Mini: ['Aceman', 'Cabrio', 'Clubman', 'Countryman', 'Coupé', 'Mini 3 portes', 'Mini 5 portes', 'Paceman', 'Roadster', AUTRE],
  Mitsubishi: ['ASX', 'Colt', 'Eclipse Cross', 'Grandis', 'L200', 'Lancer', 'Outlander', 'Pajero', 'Space Star', AUTRE],
  Nissan: ['370Z', 'Almera', 'Ariya', 'Cube', 'GT-R', 'Juke', 'Leaf', 'Micra', 'Murano', 'Navara', 'Note', 'NV200', 'Pathfinder', 'Patrol', 'Pixo', 'Primera', 'Pulsar', 'Qashqai', 'Terrano', 'X-Trail', AUTRE],
  Opel: ['Adam', 'Agila', 'Ampera', 'Antara', 'Astra', 'Cascada', 'Combo', 'Corsa', 'Crossland', 'Frontera', 'Grandland', 'Insignia', 'Karl', 'Meriva', 'Mokka', 'Movano', 'Signum', 'Tigra', 'Vectra', 'Vivaro', 'Zafira', AUTRE],
  Peugeot: ['106', '107', '108', '1007', '2008', '205', '206', '207', '208', '3008', '306', '307', '308', '309', '4007', '4008', '405', '406', '407', '408', '5008', '508', '605', '607', '806', '807', 'Bipper', 'Boxer', 'Expert', 'iOn', 'Partner', 'RCZ', 'Rifter', 'Traveller', AUTRE],
  Porsche: ['718 Boxster', '718 Cayman', '911', 'Boxster', 'Cayenne', 'Cayman', 'Macan', 'Panamera', 'Taycan', AUTRE],
  Renault: ['Arkana', 'Austral', 'Avantime', 'Captur', 'Clio', 'Espace', 'Fluence', 'Grand Scénic', 'Kadjar', 'Kangoo', 'Koleos', 'Laguna', 'Latitude', 'Mégane', 'Modus', 'Rafale', 'Safrane', 'Scénic', 'Symbioz', 'Talisman', 'Trafic', 'Twingo', 'Twizy', 'Vel Satis', 'Wind', 'Zoé', AUTRE],
  'Rolls-Royce': ['Cullinan', 'Dawn', 'Ghost', 'Phantom', 'Spectre', 'Wraith', AUTRE],
  Saab: ['9-3', '9-5', '900', '9000', AUTRE],
  Seat: ['Alhambra', 'Altea', 'Arona', 'Arosa', 'Ateca', 'Cordoba', 'Exeo', 'Ibiza', 'Leon', 'Mii', 'Tarraco', 'Toledo', AUTRE],
  Skoda: ['Citigo', 'Elroq', 'Enyaq', 'Fabia', 'Kamiq', 'Karoq', 'Kodiaq', 'Octavia', 'Rapid', 'Roomster', 'Scala', 'Superb', 'Yeti', AUTRE],
  Smart: ['#1', '#3', 'Forfour', 'Fortwo', 'Roadster', AUTRE],
  SsangYong: ['Korando', 'Kyron', 'Rexton', 'Rodius', 'Tivoli', 'XLV', AUTRE],
  Subaru: ['BRZ', 'Forester', 'Impreza', 'Legacy', 'Levorg', 'Outback', 'Solterra', 'XV', AUTRE],
  Suzuki: ['Across', 'Alto', 'Baleno', 'Celerio', 'Grand Vitara', 'Ignis', 'Jimny', 'Kizashi', 'Liana', 'S-Cross', 'Splash', 'Swace', 'Swift', 'SX4', 'Vitara', 'Wagon R+', AUTRE],
  Tesla: ['Cybertruck', 'Model 3', 'Model S', 'Model X', 'Model Y', 'Roadster', AUTRE],
  Toyota: ['Auris', 'Avensis', 'Aygo', 'Aygo X', 'bZ4X', 'C-HR', 'Camry', 'Celica', 'Corolla', 'Corolla Verso', 'GR86', 'GT86', 'Highlander', 'Hilux', 'iQ', 'Land Cruiser', 'Mirai', 'MR2', 'Previa', 'Prius', 'Proace', 'RAV4', 'Supra', 'Urban Cruiser', 'Verso', 'Yaris', 'Yaris Cross', AUTRE],
  Volkswagen: ['Amarok', 'Arteon', 'Beetle', 'Bora', 'Caddy', 'California', 'Caravelle', 'Coccinelle', 'Eos', 'Fox', 'Golf', 'Golf Plus', 'Golf Sportsvan', 'ID.3', 'ID.4', 'ID.5', 'ID.7', 'ID. Buzz', 'Jetta', 'Lupo', 'Multivan', 'Passat', 'Phaeton', 'Polo', 'Scirocco', 'Sharan', 'T-Cross', 'T-Roc', 'Taigo', 'Tiguan', 'Touareg', 'Touran', 'Transporter', 'up!', AUTRE],
  Volvo: ['C30', 'C40', 'C70', 'EX30', 'EX90', 'S40', 'S60', 'S80', 'S90', 'V40', 'V50', 'V60', 'V70', 'V90', 'XC40', 'XC60', 'XC70', 'XC90', AUTRE],
  // Voitures sans permis
  Aixam: ['City', 'Coupé', 'Crossline', 'Crossover', 'e-City', 'Minauto', AUTRE],
  Ligier: ['JS50', 'JS60', 'Myli', 'Nova', 'Optima', 'X-Too', AUTRE],
  Microcar: ['Dué', 'M.Go', 'MC1', 'MC2', 'Flex', AUTRE],
  [AUTRE]: [AUTRE],
};

export const MODELES_MOTOS: Record<string, string[]> = {
  Aprilia: ['RS 125', 'RS 660', 'RS4', 'RSV4', 'Shiver', 'SR', 'Tuareg', 'Tuono', AUTRE],
  Benelli: ['502C', 'BN 125', 'Imperiale 400', 'Leoncino', 'TRK 502', 'TRK 702', 'TNT', AUTRE],
  Beta: ['Alp', 'RR', 'RR Enduro', 'Xtrainer', AUTRE],
  BMW: ['C 400', 'C 650', 'CE 04', 'F 650 GS', 'F 700 GS', 'F 750 GS', 'F 800 GS', 'F 800 R', 'F 850 GS', 'F 900 R', 'F 900 XR', 'G 310 GS', 'G 310 R', 'K 1200', 'K 1300', 'K 1600', 'R 1150 GS', 'R 1200 GS', 'R 1200 R', 'R 1200 RT', 'R 1250 GS', 'R 1250 R', 'R 1250 RT', 'R 1300 GS', 'R nineT', 'S 1000 R', 'S 1000 RR', 'S 1000 XR', AUTRE],
  Brixton: ['Cromwell 125', 'Cromwell 1200', 'Crossfire 500', 'Felsberg 125', AUTRE],
  CFMoto: ['300 SR', '450 MT', '650 GT', '650 MT', '650 NK', '700 CL-X', '800 MT', 'Ibex 800', AUTRE],
  Ducati: ['Diavel', 'Hypermotard', 'Monster', 'Multistrada', 'Panigale', 'Scrambler', 'Streetfighter', 'SuperSport', AUTRE],
  Fantic: ['Caballero', 'XEF', 'XMF', 'XX', AUTRE],
  'Gas Gas': ['EC', 'ES', 'MC', 'SM', 'TXT', AUTRE],
  'Harley-Davidson': ['Breakout', 'Fat Bob', 'Fat Boy', 'Heritage Classic', 'Iron 883', 'Low Rider', 'Nightster', 'Pan America', 'Road Glide', 'Road King', 'Softail', 'Sportster', 'Street Bob', 'Street Glide', AUTRE],
  Honda: ['Africa Twin', 'CB 125 R', 'CB 500 F', 'CB 500 X', 'CB 650 R', 'CB 750 Hornet', 'CB 1000 R', 'CBF', 'CBR 125', 'CBR 500 R', 'CBR 600 RR', 'CBR 650 R', 'CBR 1000 RR', 'CMX 500 Rebel', 'CRF', 'Forza 125', 'Forza 350', 'Forza 750', 'Goldwing', 'Hornet', 'Integra', 'MSX 125', 'NC 700', 'NC 750', 'NT 1100', 'PCX 125', 'SH 125', 'Shadow', 'Transalp', 'Varadero', 'VFR', 'X-ADV', AUTRE],
  Husqvarna: ['701', 'FE', 'Norden 901', 'Svartpilen', 'TE', 'Vitpilen', AUTRE],
  Indian: ['Chief', 'Chieftain', 'FTR', 'Scout', 'Springfield', AUTRE],
  Kawasaki: ['ER-6', 'KLX', 'KX', 'Ninja 125', 'Ninja 400', 'Ninja 650', 'Ninja 1000', 'Ninja ZX-10R', 'Ninja ZX-6R', 'Versys 650', 'Versys 1000', 'Vulcan S', 'W800', 'Z 125', 'Z 400', 'Z 650', 'Z 750', 'Z 800', 'Z 900', 'Z 1000', 'Z H2', 'ZZR', AUTRE],
  KTM: ['125 Duke', '390 Duke', '690 Duke', '790 Duke', '890 Duke', '990 Duke', '1290 Super Duke', '390 Adventure', '790 Adventure', '890 Adventure', '1290 Super Adventure', 'EXC', 'RC 125', 'RC 390', 'SMC', 'SX', AUTRE],
  Kymco: ['Agility', 'AK 550', 'Dink', 'Downtown', 'Like', 'People', 'X-Town', 'Xciting', AUTRE],
  Mash: ['Black Seven', 'Cafe Racer', 'Dirt Track', 'Falcone', 'Seventy', 'X-Ride', AUTRE],
  'Moto Guzzi': ['California', 'Griso', 'Stelvio', 'V7', 'V85 TT', 'V9', 'V100 Mandello', AUTRE],
  'MV Agusta': ['Brutale', 'Dragster', 'F3', 'F4', 'Superveloce', 'Turismo Veloce', AUTRE],
  Peugeot: ['Django', 'Kisbee', 'Metropolis', 'Pulsion', 'Satelis', 'Speedfight', 'Tweet', 'Vivacity', 'XP6', AUTRE],
  Piaggio: ['Beverly', 'Liberty', 'Medley', 'MP3', 'X10', 'X-Evo', 'Zip', AUTRE],
  'Royal Enfield': ['Bullet', 'Classic 350', 'Continental GT', 'Himalayan', 'Hunter 350', 'Interceptor', 'Meteor', 'Scram 411', 'Shotgun', 'Super Meteor', AUTRE],
  Sherco: ['SE', 'SEF', 'SM', 'Trial', AUTRE],
  Suzuki: ['Address', 'Bandit', 'Burgman', 'DL 650 V-Strom', 'DL 1000 V-Strom', 'DL 1050 V-Strom', 'DR-Z', 'GSF', 'GSR', 'GSX-8S', 'GSX-R 600', 'GSX-R 750', 'GSX-R 1000', 'GSX-S 750', 'GSX-S 1000', 'Hayabusa', 'Intruder', 'RM-Z', 'SV 650', 'V-Strom 800', AUTRE],
  SYM: ['Cruisym', 'Fiddle', 'Jet', 'Joymax', 'Maxsym', 'Orbit', 'Symphony', AUTRE],
  Triumph: ['Bonneville', 'Daytona', 'Rocket 3', 'Scrambler', 'Speed Triple', 'Speed Twin', 'Sprint', 'Street Triple', 'Thruxton', 'Tiger 660', 'Tiger 800', 'Tiger 900', 'Tiger 1200', 'Trident', AUTRE],
  Vespa: ['GTS', 'GTV', 'LX', 'Primavera', 'PX', 'Sprint', AUTRE],
  Voge: ['300 AC', '300 R', '500 DS', '525 DSX', '650 DS', '900 DSX', AUTRE],
  Yamaha: ['FJR 1300', 'FZ6', 'FZ8', 'MT-03', 'MT-07', 'MT-09', 'MT-10', 'MT-125', 'NMAX', 'R1', 'R125', 'R3', 'R6', 'R7', 'Ténéré 700', 'TMAX', 'Tracer 7', 'Tracer 9', 'Tracer 900', 'TZR', 'WR', 'XJ6', 'XJR', 'XMAX', 'XSR 125', 'XSR 700', 'XSR 900', 'XT 660', 'YZ', 'YZF', AUTRE],
  Zontes: ['125 G1', '125 U', '310 T', '350 T', '703 F', AUTRE],
  [AUTRE]: [AUTRE],
};

export const MODELES_UTILITAIRES: Record<string, string[]> = {
  Citroën: ['Berlingo', 'C15', 'C25', 'Jumper', 'Jumpy', 'Nemo', 'ë-Berlingo', 'ë-Jumpy', AUTRE],
  Dacia: ['Dokker Van', 'Duster Société', 'Logan Van', AUTRE],
  Fiat: ['Doblo Cargo', 'Ducato', 'E-Ducato', 'Fiorino', 'Scudo', 'Talento', AUTRE],
  Ford: ['E-Transit', 'Ranger', 'Tourneo Connect', 'Tourneo Custom', 'Transit', 'Transit Connect', 'Transit Courier', 'Transit Custom', AUTRE],
  Isuzu: ['D-Max', 'N-Series', AUTRE],
  Iveco: ['Daily', 'Eurocargo', AUTRE],
  MAN: ['TGE', AUTRE],
  Maxus: ['Deliver 9', 'eDeliver 3', 'eDeliver 9', 'T90', AUTRE],
  'Mercedes-Benz': ['Citan', 'eSprinter', 'eVito', 'Sprinter', 'Vito', 'Classe X', AUTRE],
  Mitsubishi: ['L200', AUTRE],
  Nissan: ['e-NV200', 'Interstar', 'Navara', 'NV200', 'NV250', 'NV300', 'NV400', 'Primastar', 'Townstar', AUTRE],
  Opel: ['Combo', 'Movano', 'Vivaro', 'Zafira Life', AUTRE],
  Peugeot: ['Bipper', 'Boxer', 'e-Expert', 'e-Partner', 'Expert', 'Partner', AUTRE],
  Renault: ['Express', 'Kangoo', 'Kangoo E-Tech', 'Master', 'Trafic', AUTRE],
  'Renault Trucks': ['Master', 'Trafic', 'D', AUTRE],
  Toyota: ['Hilux', 'Proace', 'Proace City', 'Proace Max', AUTRE],
  Volkswagen: ['Amarok', 'Caddy', 'Crafter', 'ID. Buzz Cargo', 'Transporter', AUTRE],
  [AUTRE]: [AUTRE],
};

/** Liste des marques (clés) dans l'ordre alphabétique, « Autre » en dernier. */
export function marquesOf(map: Record<string, string[]>): string[] {
  return Object.keys(map)
    .filter((m) => m !== AUTRE)
    .sort((a, b) => a.localeCompare(b, 'fr'))
    .concat(AUTRE);
}

/** Union de tous les modèles : valeurs acceptées quand la marque n'est pas renseignée. */
export function tousModelesOf(map: Record<string, string[]>): string[] {
  return Array.from(new Set(Object.values(map).flat()));
}
