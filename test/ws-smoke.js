/* Vérification manuelle du temps réel contre un serveur lancé (npm run dev).
 * Usage : node test/ws-smoke.js  (SMS_PROVIDER=mock requis) */
const { io } = require('socket.io-client');
const B = process.env.API || 'http://localhost:3000';
const j = (r) => r.json();
const post = (p, body, tok) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) }).then(j);
const get = (p, tok) => fetch(B + p, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} }).then(j);

async function login(phone) {
  await post('/auth/register/phone', { phoneNumber: phone });
  const { code } = await get('/dev/last-otp/' + encodeURIComponent(phone));
  const r = await post('/auth/otp/verify', { phoneNumber: phone, code });
  return { token: r.accessToken, id: r.user.id };
}

(async () => {
  const suffix = String(Date.now()).slice(-6);
  const seller = await login('+336' + suffix + '01');
  const buyer = await login('+336' + suffix + '02');
  const listing = await post('/listings', { title: 'Test WS ' + suffix, description: 'Annonce de test temps réel.', categorySlug: 'ameublement', price: 10, city: 'Lyon', postalCode: '69001' }, seller.token);
  const conv = await post('/conversations', { listingId: listing.id }, buyer.token);

  const bad = io(B, { auth: { token: 'invalide' } });
  await new Promise((res) => { bad.on('connect_error', res); bad.on('disconnect', res); });
  bad.close();
  console.log('OK  token invalide déconnecté');

  const sSeller = io(B, { auth: { token: seller.token } });
  const sBuyer = io(B, { auth: { token: buyer.token } });
  await Promise.all([new Promise((r) => sSeller.on('connect', r)), new Promise((r) => sBuyer.on('connect', r))]);
  const joined = await sSeller.emitWithAck('join', { conversationId: conv.id });
  if (!joined.ok) throw new Error('join vendeur: ' + JSON.stringify(joined));
  const stranger = await login('+336' + suffix + '03');
  const sStranger = io(B, { auth: { token: stranger.token } });
  await new Promise((r) => sStranger.on('connect', r));
  const refused = await sStranger.emitWithAck('join', { conversationId: conv.id });
  if (refused.ok) throw new Error('un tiers a pu rejoindre la room');
  console.log('OK  tiers refusé :', refused.message);

  const received = new Promise((r) => sSeller.on('message', r));
  const inbox = new Promise((r) => sSeller.on('inbox', r));
  const sent = await sBuyer.emitWithAck('message', { conversationId: conv.id, content: 'Bonjour via WebSocket' });
  const msg = await received;
  await inbox;
  if (msg.content !== 'Bonjour via WebSocket' || sent.messageId !== msg.id) throw new Error('message non reçu');
  console.log('OK  message temps réel reçu par le vendeur + évènement inbox');
  const unread = await get('/conversations/unread-count', seller.token);
  console.log('OK  non-lus vendeur =', unread.unread);
  [sSeller, sBuyer, sStranger].forEach((s) => s.close());
  process.exit(0);
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
