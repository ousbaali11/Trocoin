import { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { createApp, login, nextPhone, type TestUser } from './utils';

/**
 * Phase 12 : messagerie temps réel — accusés de lecture (« Vu ») et indicateur de frappe
 * relayés par la passerelle WebSocket, sans interrogation périodique.
 */
describe('Phase 12 : accusés de lecture et frappe en temps réel', () => {
  let app: INestApplication;
  let server: any;
  let url: string;
  let seller: TestUser;
  let buyer: TestUser;
  let conversationId: string;
  const sockets: Socket[] = [];

  const connect = (token: string) =>
    new Promise<Socket>((resolve, reject) => {
      const s = io(url, { auth: { token }, transports: ['websocket'], forceNew: true });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  const joinRoom = (s: Socket, id: string) => new Promise<{ ok: boolean }>((r) => s.emit('join', { conversationId: id }, r));
  const waitFor = <T>(s: Socket, event: string, ms = 3000) =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`pas d'évènement « ${event} » en ${ms} ms`)), ms);
      s.once(event, (payload: T) => { clearTimeout(t); resolve(payload); });
    });

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    url = `http://127.0.0.1:${typeof address === 'string' ? 0 : address.port}`;
    server = app.getHttpServer();
    seller = await login(app, nextPhone());
    buyer = await login(app, nextPhone());
    const listing = await request(server).post('/listings').set(seller.auth).send({
      categorySlug: 'consoles-jeux-video', title: 'Console pour test temps réel', description: 'Description assez longue pour la validation du dépôt.', priceType: 'fixe', price: 150, condition: 'bon_etat', attributes: { plateforme: 'PlayStation 5' }, city: 'Lyon', postalCode: '69003',
    }).expect(201);
    const conv = await request(server).post('/conversations').set(buyer.auth).send({ listingId: listing.body.id, message: 'Bonjour, toujours disponible ?' }).expect(201);
    conversationId = conv.body.id;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await app.close();
  });

  it("le vendeur qui affiche la conversation déclenche « read » chez l'acheteur, avec l'horodatage ; les messages sont marqués lus en base", async () => {
    const buyerSocket = await connect(buyer.token);
    const sellerSocket = await connect(seller.token);
    expect((await joinRoom(buyerSocket, conversationId)).ok).toBe(true);
    expect((await joinRoom(sellerSocket, conversationId)).ok).toBe(true);

    // Avant lecture : le message initial de l'acheteur n'est pas lu
    const before = await request(server).get(`/conversations/${conversationId}`).set(buyer.auth).expect(200);
    expect(before.body.messages[0].readAt).toBeNull();

    const readEvent = waitFor<{ conversationId: string; readerId: string; readAt: string }>(buyerSocket, 'read');
    // Le vendeur ouvre la conversation (HTTP) : l'accusé de lecture part par WebSocket
    await request(server).get(`/conversations/${conversationId}`).set(seller.auth).expect(200);
    const e = await readEvent;
    expect(e.conversationId).toBe(conversationId);
    expect(e.readerId).toBe(seller.id);
    expect(new Date(e.readAt).getTime()).toBeGreaterThan(Date.now() - 10_000);
    const after = await request(server).get(`/conversations/${conversationId}`).set(buyer.auth).expect(200);
    expect(after.body.messages[0].readAt).not.toBeNull();

    // Un second affichage sans nouveau message n'émet rien (rien de nouveau à lire)
    let extra = 0;
    buyerSocket.on('read', () => { extra += 1; });
    await request(server).get(`/conversations/${conversationId}`).set(seller.auth).expect(200);
    await new Promise((r) => setTimeout(r, 400));
    expect(extra).toBe(0);
  });

  it("l'évènement « read » émis par le destinataire via WebSocket marque lus les messages et prévient l'expéditeur", async () => {
    const buyerSocket = await connect(buyer.token);
    const sellerSocket = await connect(seller.token);
    await joinRoom(buyerSocket, conversationId);
    await joinRoom(sellerSocket, conversationId);
    // Le vendeur répond ; l'acheteur reçoit le message puis signale l'avoir affiché
    const incoming = waitFor<{ id: string; senderId: string }>(buyerSocket, 'message');
    await new Promise((r) => sellerSocket.emit('message', { conversationId, content: 'Oui, toujours disponible.' }, r));
    expect((await incoming).senderId).toBe(seller.id);
    const readEvent = waitFor<{ readerId: string }>(sellerSocket, 'read');
    const ack = await new Promise<{ ok: boolean; readAt: string | null }>((r) => buyerSocket.emit('read', { conversationId }, r));
    expect(ack.ok).toBe(true);
    expect(ack.readAt).toBeTruthy();
    expect((await readEvent).readerId).toBe(buyer.id);
  });

  it("la frappe est relayée aux autres membres (jamais à soi-même), refusée sans avoir rejoint la room, et un tiers ne peut pas rejoindre", async () => {
    const buyerSocket = await connect(buyer.token);
    const sellerSocket = await connect(seller.token);
    await joinRoom(buyerSocket, conversationId);
    await joinRoom(sellerSocket, conversationId);
    let selfEcho = 0;
    buyerSocket.on('typing', () => { selfEcho += 1; });
    const typing = waitFor<{ conversationId: string; userId: string; typing: boolean }>(sellerSocket, 'typing');
    const ack = await new Promise<{ ok: boolean }>((r) => buyerSocket.emit('typing', { conversationId, typing: true }, r));
    expect(ack.ok).toBe(true);
    const t = await typing;
    expect(t).toEqual({ conversationId, userId: buyer.id, typing: true });
    const stop = waitFor<{ typing: boolean }>(sellerSocket, 'typing');
    buyerSocket.emit('typing', { conversationId, typing: false });
    expect((await stop).typing).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    expect(selfEcho).toBe(0);

    // Socket qui n'a pas rejoint la room : refus, rien relayé
    const other = await connect(seller.token);
    const refused = await new Promise<{ ok: boolean }>((r) => other.emit('typing', { conversationId, typing: true }, r));
    expect(refused.ok).toBe(false);

    // Tiers : impossible de rejoindre la conversation, donc ni frappe ni lecture
    const stranger = await login(app, nextPhone());
    const strangerSocket = await connect(stranger.token);
    expect((await joinRoom(strangerSocket, conversationId)).ok).toBe(false);
    const readRefused = await new Promise<{ ok: boolean }>((r) => strangerSocket.emit('read', { conversationId }, r));
    expect(readRefused.ok).toBe(false);
  });
});
