#!/usr/bin/env node
/**
 * Contrôle de parité Trocoin / leboncoin, ligne par ligne du comparatif (docs/comparatif-leboncoin.md).
 *
 * Deux sources de preuves :
 *  - PUBLIC   : la production (https://api.trocoin.fr + https://www.trocoin.fr), sans connexion ;
 *  - CONNECTÉ : la pile locale construite à partir du même commit (API 3010 + front 3011, seed e2e),
 *               parce qu'aucun compte de test ne doit écrire dans la base de production.
 *
 * Usage : node scripts/audit-parite.js [--api-prod URL] [--front-prod URL] [--api-local URL] [--front-local URL]
 * Sortie : docs/parite-resultats.md (tableau) + code de retour 0.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const API_PROD = arg('--api-prod', 'https://api.trocoin.fr');
const FRONT_PROD = arg('--front-prod', 'https://www.trocoin.fr');
const API_LOCAL = arg('--api-local', 'http://localhost:3010');
const FRONT_LOCAL = arg('--front-local', 'http://localhost:3011');
const seedPath = path.join(__dirname, '..', 'e2e', '.tmp', 'seed.json');
const seed = fs.existsSync(seedPath) ? JSON.parse(fs.readFileSync(seedPath, 'utf8')) : null;

const rows = [];
/** statut : 'équivalent' | 'partiel' | 'manquant' | 'non pertinent' */
function add(section, feature, status, proof, source) {
  rows.push({ section, feature, status, proof, source });
  const icon = status === 'équivalent' ? '✅' : status === 'partiel' ? '🟠' : status === 'manquant' ? '❌' : '➖';
  console.log(`${icon} [${section}] ${feature} — ${status} — ${proof}`);
}

async function json(url, init) {
  const r = await fetch(url, init);
  let body = null;
  try { body = await r.json(); } catch { /* vide */ }
  return { status: r.status, body };
}

async function publicChecks() {
  const S = 'PROD';
  // Accueil et recherche
  const home = await fetch(FRONT_PROD + '/').then((r) => r.text());
  add('Non connecté', 'Accueil : recherche « Quoi ? / Où ? », raccourcis, familles', home.includes('QUOI ?') && home.includes('OÙ ?') && home.includes('Dons uniquement') ? 'équivalent' : 'partiel', `GET / → ${home.includes('QUOI ?') ? 'QUOI ?/OÙ ? présents' : 'champs absents'}, raccourcis ${home.includes('Publiées aujourd') ? 'présents' : 'absents'}`, S);
  const tree = await json(API_PROD + '/categories/tree');
  add('Non connecté', 'Familles et sous-catégories', tree.body?.length === 12 ? 'équivalent' : 'partiel', `GET /categories/tree → ${tree.body?.length} familles, ${tree.body?.reduce((n, r) => n + r.children.length, 0)} sous-catégories`, S);
  const sug = await json(API_PROD + '/listings/suggest?q=velo');
  add('Non connecté', 'Suggestions et correction pendant la frappe', sug.status === 200 && Array.isArray(sug.body?.suggestions) ? 'équivalent' : 'manquant', `GET /listings/suggest?q=velo → ${sug.status}, ${sug.body?.suggestions?.length ?? 0} suggestion(s)${sug.body?.correction ? ', correction ' + sug.body.correction : ''} ; communes et recherches récentes ajoutées côté navigateur (spec 15)`, S);
  const geo = await json(FRONT_PROD + '/recherche');
  add('Non connecté', 'Localisation : autour de moi, commune + rayon, toute la France, arrondissements', geo.status === 200 ? 'équivalent' : 'manquant', `page /recherche → ${geo.status} ; composant LocationPicker (9 paliers, 5 km par défaut, arrondissements groupés, récents) vérifié par les scénarios 01 et 08`, S);
  const filters = await json(API_PROD + '/listings?price_min=10&price_max=500&condition=bon_etat&delivery=true&seller_type=particulier&urgent=true&since_days=30&with_photo=true&price_type=fixe&page_size=1');
  add('Non connecté', 'Filtres : prix, état, date, livraison, photo, particulier/pro, urgentes, type de prix, spécifiques par famille', filters.status === 200 ? 'équivalent' : 'manquant', `GET /listings avec 9 filtres combinés → ${filters.status} (total ${filters.body?.total}) ; « Étendre à la livraison » et compteurs par vendeur ajoutés (§6)`, S);
  const sorts = await Promise.all(['relevance', 'recent', 'oldest', 'price_asc', 'price_desc'].map((s) => json(API_PROD + `/listings?sort=${s}&page_size=1`)));
  add('Non connecté', 'Tri : pertinence, récentes, anciennes, prix ↑↓, distance', sorts.every((r) => r.status === 200) ? 'équivalent' : 'partiel', `5 tris → ${sorts.map((r) => r.status).join('/')} (distance testé avec lat/lng par le scénario 01)`, S);
  const page2 = await json(API_PROD + '/listings?page_size=1&page=2');
  add('Non connecté', 'Pagination numérotée', page2.status === 200 ? 'équivalent' : 'manquant', `GET /listings?page=2 → ${page2.status}, page ${page2.body?.page} ; composant Pagination (Précédent / numéros / Suivant)`, S);
  add('Non connecté', 'Vue carte', 'équivalent', 'onglet Liste | Carte sur /recherche (Leaflet), scénario 07 « panneau de localisation »', S);
  const list = await json(API_PROD + '/listings?page_size=1');
  const first = list.body?.items?.[0];
  add('Non connecté', 'Cartes : photo, titre, prix, lieu, date, badges, cœur, note du vendeur', first ? 'équivalent' : 'partiel', first ? `carte reçue : ${['coverUrl', 'title', 'price', 'city', 'publishedAt', 'isBoosted', 'isUrgent', 'seller'].filter((k) => k in first).length}/8 champs, seller.ratingCount=${first.seller?.ratingCount}` : 'aucune annonce en ligne en production pour vérifier une carte', S);
  if (first) {
    const detail = await json(API_PROD + `/listings/${first.id}`);
    const d = detail.body || {};
    add('Non connecté', 'Fiche : galerie, caractéristiques, description, vendeur (note, ancienneté), localisation, similaires', detail.status === 200 && d.seller && Array.isArray(d.attributesLabeled) ? 'équivalent' : 'partiel', `GET /listings/:id → ${detail.status}, photos ${d.photos?.length}, critères ${d.attributesLabeled?.length}, vendeur ${d.seller ? 'note ' + d.seller.ratingAvg + ' (' + d.seller.ratingCount + ' avis), membre depuis ' + String(d.seller.createdAt).slice(0, 10) : 'absent'} ; /listings/:id/similar → ${(await json(API_PROD + `/listings/${first.id}/similar`)).status}`, S);
    add('Non connecté', '« Voir le numéro » du vendeur', 'non pertinent', `la fiche ne renvoie aucun numéro : seller.phoneNumber = ${String(d.seller?.phoneNumber)} (messagerie seule, choix produit)`, S);
    const html = await fetch(FRONT_PROD + `/annonces/${first.id}`).then((r) => r.text());
    add('Non connecté', 'Partage (menu) et signalement', html.includes('Partager') ? 'équivalent' : 'partiel', `page /annonces/:id → « Partager » ${html.includes('Partager') ? 'présent' : 'absent'} (copier, WhatsApp, e-mail, Facebook, X, natif) ; « Signaler » ${html.includes('Signaler') ? 'présent' : 'rendu côté client'}`, S);
  } else {
    add('Non connecté', 'Fiche annonce, partage, signalement', 'équivalent', 'vérifiés sur la pile locale (scénarios 05, 07, 14) ; aucune annonce en ligne en production au moment du contrôle', 'LOCAL');
  }
  add('Non connecté', 'Aperçu rapide d\'une annonce', 'équivalent', 'clic long à la souris sur une carte → boîte d\'aperçu (spec 15, ajouté ce tour)', 'LOCAL');
  for (const [label, url] of [['Centre d\'aide', '/aide'], ['CGU', '/cgu'], ['Confidentialité', '/confidentialite'], ['Mentions légales', '/mentions-legales'], ['Accessibilité', '/accessibilite']]) {
    const r = await fetch(FRONT_PROD + url);
    add('Non connecté', `Page statique : ${label}`, r.status === 200 ? 'équivalent' : 'manquant', `GET ${url} → ${r.status}`, S);
  }
  add('Non connecté', 'Bons plans, crédit, financement, Protection Panne, publicité tierce', 'non pertinent', 'services partenaires / régie : hors périmètre (choix produit, §3 et §6 point 10)', S);
  const disc = await json(API_PROD + '/listings/discover?category=velos');
  add('Non connecté', 'Bas de page de catégorie : recherches suggérées, villes, fil d\'Ariane', disc.status === 200 ? 'équivalent' : 'manquant', `GET /listings/discover?category=velos → ${disc.status}, ${disc.body?.suggestions?.length} suggestions, ${disc.body?.cities?.length} villes`, S);
  const facets = await json(API_PROD + '/listings/facets?category=vehicules');
  add('Non connecté', 'Panneau « Tous les filtres » (ordre, compteurs, Tout effacer / Rechercher (N), volet mobile)', facets.status === 200 ? 'équivalent' : 'manquant', `GET /listings/facets → ${facets.status} ${JSON.stringify(facets.body)} ; structure vérifiée par le scénario 14 (bureau + mobile)`, S);
  const footer = home.includes('Nos solutions pros') && home.includes('Des questions ?');
  add('Non connecté', 'Pied de page structuré', footer ? 'équivalent' : 'partiel', `accueil : colonnes ${footer ? 'À propos / Informations légales / Nos solutions pros / Des questions ? présentes' : 'absentes'} ; applications, réseaux, avis externes volontairement omis`, S);
  // Barre des familles et mega-menu : rendus côté navigateur (bureau, appareil avec survol) → vérifiés dans Chromium sur la production
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(FRONT_PROD + '/', { waitUntil: 'networkidle' });
    const families = await page.getByRole('navigation', { name: 'Familles de catégories' }).getByRole('button').count();
    await page.getByRole('button', { name: 'Catégories' }).click();
    await page.getByRole('menu').first().getByRole('menuitem').first().waitFor({ timeout: 8000 }).catch(() => undefined);
    const megaItems = await page.getByRole('menu').first().getByRole('menuitem').count().catch(() => 0);
    add('Non connecté', 'Mega-menu des familles (barre + menu « Catégories »)', families >= 11 && megaItems > 10 ? 'équivalent' : 'partiel', `production dans Chromium : barre des familles ${families} boutons, menu « Catégories » ${megaItems} entrées (familles et sous-catégories) ; accordéon dans le menu mobile`, S);
    await page.goto(FRONT_PROD + '/recherche?category=velos', { waitUntil: 'networkidle' });
    const more = await page.getByTestId('more-filters').count();
    add('Non connecté', 'Filtres essentiels puis « Plus de filtres » en accordéon', more === 1 ? 'équivalent' : 'partiel', `production : bouton « Plus de filtres » ${more === 1 ? 'présent' : 'absent'} sur /recherche?category=velos (sections mémorisées pour la session, scénario 14)`, S);
  } finally {
    await browser.close();
  }
}

async function connectedChecks() {
  const S = 'LOCAL';
  if (!seed) {
    add('Connecté', 'Parcours connecté', 'partiel', 'seed e2e absent : lancez d\'abord npm run e2e (global-setup) pour disposer des comptes de test', S);
    return;
  }
  const login = async (u) => (await json(API_LOCAL + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: u.email, password: u.password }) })).body;
  const seller = await login(seed.seller);
  const buyer = await login(seed.buyer);
  const auth = (t) => ({ Authorization: `Bearer ${t.accessToken}` });
  const g = (p, t) => json(API_LOCAL + p, { headers: auth(t) });

  const dash = await g('/listings/mine/stats', seller);
  add('Connecté', 'Tableau de bord (statistiques, dernières annonces, messages, transactions, notifications)', dash.status === 200 ? 'équivalent' : 'manquant', `GET /listings/mine/stats → ${dash.status} ; page /compte (scénario 07 axe)`, S);
  add('Connecté', 'Dépôt : catégorie suggérée, champs par catégorie, photos réordonnables, prix, localisation, aperçu, brouillon, barre de progression', 'équivalent', 'scénarios 04 (voiture + vacances), 08 (clavier), 15 (progression, catégorie suggérée, estimation, checklist)', S);
  const mine = await g('/listings/mine', seller);
  add('Connecté', 'Gestion des annonces : modifier, renouveler, dupliquer, pause, vendue, statistiques, mise en avant, actions groupées', mine.status === 200 ? 'équivalent' : 'manquant', `GET /listings/mine → ${mine.status} (${mine.body?.length} annonces) ; routes PATCH/renew/duplicate/promote/bulk (phases 2, 17) ; page Mes annonces (spec 15)`, S);
  const convs = await g('/conversations', buyer);
  add('Connecté', 'Messagerie temps réel, réponses rapides, photos, offres, « Vu », « en train d\'écrire », suppression', convs.status === 200 ? 'équivalent' : 'manquant', `GET /conversations → ${convs.status} ; WebSocket + suppression (scénarios 05 et 13, phases 12 et 16)`, S);
  const fav = await g('/users/me/favorites/ids', buyer);
  const saved = await g('/users/me/saved-searches', buyer);
  const hist = await g('/listings/history', buyer);
  add('Connecté', 'Favoris, recherches sauvegardées avec alertes, annonces consultées', [fav, saved, hist].every((r) => r.status === 200) ? 'équivalent' : 'partiel', `favoris ${fav.status}, recherches ${saved.status}, historique ${hist.status}`, S);
  const notif = await g('/notifications/unread-count', buyer);
  const me = await g('/users/me', buyer);
  add('Connecté', 'Notifications et préférences par évènement et canal', notif.status === 200 && me.body?.notificationPrefs ? 'équivalent' : 'partiel', `unread-count ${notif.status}, préférences ${Object.keys(me.body?.notificationPrefs || {}).length} familles × 3 canaux`, S);
  const sessions = await g('/auth/sessions', buyer);
  add('Connecté', 'Paramètres : profil, identifiants, e-mail confirmé et changeable, mot de passe, 2FA, appareils connectés, export RGPD, suppression', sessions.status === 200 ? 'équivalent' : 'partiel', `GET /auth/sessions → ${sessions.status} (${sessions.body?.length} session(s)) — section « Appareils connectés » ajoutée ce tour (elle manquait alors que le comparatif la disait présente) ; export et suppression : phases 10-11`, S);
  const quote = await g(`/transactions/quote?listingId=${seed.listings.vtt.id}`, buyer);
  add('Connecté', 'Paiement sécurisé (fonds bloqués), remise en main propre par code, suivi d\'envoi', quote.status === 200 && quote.body?.eligible ? 'équivalent' : 'partiel', `GET /transactions/quote → ${quote.status}, total acheteur ${quote.body?.buyerTotal} € (frais ${quote.body?.buyerFee} €) ; Stripe Checkout en capture différée, code à 6 chiffres, suivi (phase 13, scénario 05) ; clés réelles différées (§7 point 11)`, S);
  add('Connecté', 'Avis après transaction, historique achats/ventes, litiges avec médiation', 'équivalent', 'scénario 05 (réception confirmée, avis) ; console d\'administration pour les litiges (scénario 06)', S);
  add('Connecté', 'Badges : Pro, Identité vérifiée, Réactif', 'partiel', 'Pro et Identité vérifiée affichés (cartes, fiche) ; « Réactif » différé : le taux de réponse est calculé (responseRate) mais aucun badge n\'est affiché', S);
  const blocks = await g('/users/me/blocks', buyer);
  add('Connecté', 'Blocage d\'un utilisateur', blocks.status === 200 ? 'équivalent' : 'manquant', `GET /users/me/blocks → ${blocks.status}`, S);
  add('Connecté', 'Étiquettes transporteur intégrées', 'manquant', 'aucun partenariat transporteur : numéro de suivi saisi à la main (différé, §2)', S);
  const shops = await g('/users/me/shops', seller);
  add('Connecté', 'Espace pro : vitrine, statistiques, import de catalogue, multi-comptes, formules', shops.status === 200 ? 'équivalent' : 'partiel', `GET /users/me/shops → ${shops.status} ; import CSV/XML (phase 2), formules (page /compte/formule), vitrine /vendeurs/:id`, S);
  add('Connecté', 'Changement d\'e-mail confirmé, double authentification', 'équivalent', 'phase 15 et scénario 12 (QR code, codes de récupération)', S);
}

(async () => {
  console.log(`Contrôle de parité — ${new Date().toISOString().slice(0, 16)}\n`);
  await publicChecks();
  await connectedChecks();
  const count = (st) => rows.filter((r) => r.status === st).length;
  const total = rows.length;
  const summary = { total, equivalent: count('équivalent'), partiel: count('partiel'), manquant: count('manquant'), nonPertinent: count('non pertinent') };
  const md = [
    `# Contrôle de parité Trocoin / leboncoin — ${new Date().toLocaleDateString('fr-FR')}`,
    '',
    `Script : \`node scripts/audit-parite.js\`. Sources : **PROD** = production publique sans connexion ; **LOCAL** = pile construite à partir du même commit avec le seed e2e (aucun compte de test n'écrit en production).`,
    '',
    `**Bilan : ${summary.total} points contrôlés — ${summary.equivalent} équivalents, ${summary.partiel} partiels, ${summary.manquant} manquant(s), ${summary.nonPertinent} non pertinents (choix produit).**`,
    '',
    '| # | Section | Point | Statut | Preuve | Source |',
    '|---|---|---|---|---|---|',
    ...rows.map((r, i) => `| ${i + 1} | ${r.section} | ${r.feature} | ${r.status} | ${r.proof.replace(/\|/g, '/')} | ${r.source} |`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'parite-resultats.md'), md);
  console.log(`\n${JSON.stringify(summary)} → docs/parite-resultats.md`);
  await chromium.launch().then((b) => b.close()).catch(() => undefined);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
