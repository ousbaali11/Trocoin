/* Données de démonstration pour tester l'interface (API lancée avec SMS_PROVIDER=mock).
 * Usage : node test/seed-demo.js  — idempotent côté comptes (même numéros), crée de nouvelles annonces à chaque exécution. */
const zlib = require('zlib');
const B = process.env.API || 'http://localhost:3000';

const json = (r) => r.json();
const post = (p, body, tok) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) }).then(json);
const get = (p, tok) => fetch(B + p, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} }).then(json);

/** PNG uni (w x h, couleur RGB) — assez pour des vignettes réalistes. */
function png(w, h, [r, g, b]) {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { const shade = 1 - (x / w) * 0.25; row[1 + x * 3] = r * shade; row[2 + x * 3] = g * shade; row[3 + x * 3] = b * shade; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function login(phone) {
  const r1 = await post('/auth/register/phone', { phoneNumber: phone });
  if (r1.statusCode === 429) { console.log('cooldown, réutilisation impossible pour', phone); }
  const { code } = await get('/dev/last-otp/' + encodeURIComponent(phone));
  const r = await post('/auth/otp/verify', { phoneNumber: phone, code });
  if (!r.accessToken) throw new Error('login ' + phone + ': ' + JSON.stringify(r));
  return { token: r.accessToken, id: r.user.id };
}

async function upload(listingId, token, colors) {
  const fd = new FormData();
  colors.forEach((c, i) => fd.append('files', new Blob([png(640, 480, c)], { type: 'image/png' }), `photo${i}.png`));
  const r = await fetch(`${B}/listings/${listingId}/photos`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
  if (!r.ok) console.log('upload', r.status, await r.text());
}

const LISTINGS = [
  { slug: 'ameublement', title: 'Canapé 3 places en velours vert', price: 450, condition: 'tres_bon_etat', city: 'Lyon', cp: '69003', lat: 45.76, lng: 4.85, desc: 'Canapé confortable, velours vert bouteille, pieds bois. Aucune tache, non fumeur. À venir chercher (3e étage avec ascenseur).', attrs: { type_meuble: 'Canapé / Fauteuil', matiere: 'Velours', couleur: 'Vert' }, colors: [[31, 59, 46], [44, 83, 65]], delivery: false },
  { slug: 'telephonie', title: 'iPhone 13 128 Go noir, très bon état', price: 420, condition: 'tres_bon_etat', city: 'Villeurbanne', cp: '69100', lat: 45.77, lng: 4.88, desc: 'Batterie 89 %, aucune rayure sur l\'écran, coque offerte. Facture disponible. Envoi possible en Colissimo.', attrs: { marque: 'Apple', modele: 'iPhone 13', stockage: '128 Go', couleur: 'Noir', debloque: true }, colors: [[30, 27, 22], [60, 60, 60]], delivery: true },
  { slug: 'voitures', title: 'Peugeot 208 1.2 PureTech 2019, 58 000 km', price: 11900, condition: 'bon_etat', city: 'Bron', cp: '69500', lat: 45.73, lng: 4.91, desc: 'Entretien Peugeot, contrôle technique de moins de 3 mois, 2 pneus neufs. Non fumeur, jamais accidentée.', attrs: { marque: 'Peugeot', modele: '208', annee: 2019, kilometrage: 58000, carburant: 'Essence', boite: 'Manuelle', puissance_fiscale: 5, portes: '5', couleur: 'Gris', controle_technique: true }, colors: [[120, 120, 130], [90, 90, 100]], delivery: false },
  { slug: 'velos', title: 'VTT électrique Rockrider E-ST 500, taille M', price: 890, condition: 'bon_etat', city: 'Paris', cp: '75011', lat: 48.86, lng: 2.38, desc: 'Acheté en 2023, 1 200 km, batterie 420 Wh, révisé. Vendu avec chargeur et antivol.', attrs: { type_velo: 'Électrique', taille_cadre: 'M', marque: 'Rockrider' }, colors: [[216, 162, 59], [185, 131, 42]], delivery: false },
  { slug: 'locations', title: 'T2 meublé 38 m² proche métro, balcon', price: 780, condition: undefined, city: 'Lyon', cp: '69007', lat: 45.74, lng: 4.84, desc: 'Appartement lumineux au 4e étage avec ascenseur, cuisine équipée, balcon exposé sud. Charges 60 €. Disponible au 1er octobre.', attrs: { type_bien: 'Appartement', surface: 38, pieces: 2, chambres: 1, etage: 4, ascenseur: true, exterieur: 'Balcon', dpe: 'C', ges: 'B', meuble: true, charges: 60, depot_garantie: 780, disponible_le: '01/10/2026' }, colors: [[203, 216, 196], [150, 170, 140]], delivery: false },
  { slug: 'vetements', title: 'Manteau en laine camel Sézane, taille 38', price: 95, condition: 'tres_bon_etat', city: 'Nantes', cp: '44000', lat: 47.22, lng: -1.55, desc: 'Porté une saison, laine et cachemire, coupe droite. Envoi soigné sous 48 h.', attrs: { univers: 'Femme', type_vetement: 'Manteau / Veste', taille: '38', marque: 'Sézane', couleur: 'Camel', matiere: 'Laine' }, colors: [[190, 150, 100], [170, 130, 80]], delivery: true },
  { slug: 'consoles-jeux-video', title: 'PlayStation 5 édition standard + 2 manettes', price: 380, condition: 'bon_etat', city: 'Marseille', cp: '13006', lat: 43.29, lng: 5.38, desc: 'Console achetée en 2022, fonctionne parfaitement, avec 2 manettes DualSense et câbles d\'origine.', attrs: { plateforme: 'PlayStation 5', type_produit: 'Console' }, colors: [[240, 240, 245], [200, 200, 210]], delivery: true },
  { slug: 'jardinage', title: 'Tondeuse thermique Honda 46 cm', price: 220, condition: 'bon_etat', city: 'Toulouse', cp: '31000', lat: 43.6, lng: 1.44, desc: 'Moteur Honda GCV 160, tractée, bac 55 L. Révisée au printemps, démarre au premier coup.', attrs: { type_jardin: 'Tondeuse' }, colors: [[111, 138, 102], [80, 110, 70]], delivery: false },
  { slug: 'offres-emploi', title: 'Vendeur(se) en boutique de vélos — CDI', price: undefined, priceType: 'sur_demande', condition: undefined, city: 'Lyon', cp: '69002', lat: 45.75, lng: 4.83, desc: 'Boutique indépendante recherche un(e) vendeur(se) passionné(e), temps plein, 35 h, week-end par roulement. Expérience mécanique appréciée.', attrs: { contrat: 'CDI', temps: 'Temps plein', secteur: 'Commerce', experience: '1 à 3 ans', teletravail: false }, colors: [[181, 74, 44], [150, 60, 35]], delivery: false },
  { slug: 'livres', title: 'Lot de 12 romans policiers (Fred Vargas, Lemaitre)', price: undefined, priceType: 'gratuit', condition: 'bon_etat', city: 'Rennes', cp: '35000', lat: 48.11, lng: -1.68, desc: 'Je donne un lot de romans lus une fois. À récupérer sur place, pas d\'envoi.', attrs: { genre: 'Roman' }, colors: [[247, 243, 234], [222, 213, 192]], delivery: false },
  { slug: 'puericulture', title: 'Poussette Yoyo+ noire avec habillage pluie', price: 260, condition: 'bon_etat', city: 'Bordeaux', cp: '33000', lat: 44.84, lng: -0.58, desc: 'Poussette compacte cabine, châssis 2021, hamac 6 mois+. Quelques traces d\'usage sur les roues.', attrs: { type_produit: 'Poussette', marque: 'Babyzen' }, colors: [[50, 50, 55], [80, 80, 85]], delivery: true },
  { slug: 'informatique', title: 'MacBook Air M2 13" 16 Go / 512 Go', price: 1050, condition: 'tres_bon_etat', city: 'Lille', cp: '59000', lat: 50.63, lng: 3.06, desc: 'Acheté en 2024, 40 cycles de batterie, aucune marque. Boîte et chargeur d\'origine. Paiement sécurisé accepté.', attrs: { type_produit: 'Ordinateur portable', marque: 'Apple', processeur: 'Apple M2', ram: '16 Go', stockage: '512 Go SSD' }, colors: [[200, 200, 205], [160, 160, 170]], delivery: true },
];

(async () => {
  const alice = await login('+33612000001');
  const bob = await login('+33612000002');
  const garage = await login('+33612000003');
  await fetch(B + '/users/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + alice.token }, body: JSON.stringify({ displayName: 'Camille', city: 'Lyon', postalCode: '69003' }) });
  await fetch(B + '/users/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bob.token }, body: JSON.stringify({ displayName: 'Julien', city: 'Paris', postalCode: '75011' }) });
  const pro = await post('/users/me/become-pro', { siret: '73282932000074', shopName: 'Garage des Brotteaux' }, garage.token);
  if (pro.statusCode && pro.statusCode >= 400 && !/déjà/.test(pro.message)) console.log('become-pro', pro.message);
  await fetch(B + '/users/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + garage.token }, body: JSON.stringify({ displayName: 'Garage des Brotteaux', city: 'Lyon', postalCode: '69006', shopDescription: 'Garage indépendant depuis 1998 : véhicules d\'occasion révisés et garantis 6 mois, reprise de votre ancien véhicule.', shopAddress: '12 rue Vendôme, 69006 Lyon', shopHours: 'Lun–Ven 8h30–18h30, Sam 9h–12h', shopWebsite: 'https://example.org' }) });

  const owners = [alice, bob, garage];
  let n = 0;
  for (const [i, L] of LISTINGS.entries()) {
    const owner = L.slug === 'voitures' ? garage : owners[i % 2];
    const res = await post('/listings', { title: L.title, description: L.desc, categorySlug: L.slug, price: L.price, priceType: L.priceType || 'fixe', condition: L.condition, attributes: L.attrs, city: L.city, postalCode: L.cp, latitude: L.lat, longitude: L.lng, deliveryAvailable: L.delivery }, owner.token);
    if (!res.id) { console.log('KO', L.title, JSON.stringify(res.message)); continue; }
    await upload(res.id, owner.token, L.colors);
    n += 1;
  }
  // Une annonce bloquée par la pré-modération (pour la file admin) et un signalement
  const flagged = await post('/listings', { title: 'Réplique montre de luxe AAA+', description: 'Copie parfaite, indiscernable de l\'originale. Prix imbattable.', categorySlug: 'montres-bijoux', price: 120, city: 'Nice', postalCode: '06000' }, bob.token);
  const all = await get('/listings?page_size=50');
  const target = all.items.find((l) => l.userId === alice.id);
  if (target) await post('/reports', { listingId: target.id, reason: 'annonce_mensongere', details: 'Les photos ne correspondent pas à la description.' }, bob.token);
  // Une conversation
  if (target) await post('/conversations', { listingId: target.id, message: 'Bonjour, est-ce toujours disponible ? Je peux passer ce week-end.' }, bob.token);
  console.log(`OK : ${n} annonces créées (+1 en attente de modération : ${flagged.status}), 3 comptes : Camille +33612000001, Julien +33612000002, Garage des Brotteaux (pro) +33612000003. Admin : +33611223344.`);
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
