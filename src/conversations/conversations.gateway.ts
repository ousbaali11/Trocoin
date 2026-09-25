import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { resolveCorsOrigins } from '../config/env.validation';
import { UsersService } from '../users/users.service';
import { ConversationsService } from './conversations.service';

function roomName(conversationId: string) {
  return `conversation:${conversationId}`;
}
function userRoom(userId: string) {
  return `user:${userId}`;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Messages par socket et par minute (AUDIT §60) : le canal temps réel échappait à la limite de débit des routes HTTP. */
const WS_MESSAGES_PER_MINUTE = 30;

/**
 * Temps réel : même liste blanche CORS que l'API HTTP, même secret JWT.
 *
 * L'authentification est faite dans un middleware socket.io (`server.use`),
 * qui s'exécute AVANT l'évènement `connection` : ainsi `client.data.userId`
 * est toujours défini quand un handler (`join`, `message`) est appelé, même
 * si le client émet immédiatement après `connect`. (Une version précédente
 * authentifiait dans handleConnection, de façon asynchrone : un `join`
 * précoce était refusé — condition de course constatée dans le navigateur.)
 */
@WebSocketGateway({
  cors: { origin: resolveCorsOrigins(), credentials: true },
})
export class ConversationsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('ConversationsGateway');

  constructor(
    private jwtService: JwtService,
    private conversationsService: ConversationsService,
    private usersService: UsersService,
  ) {}

  afterInit(server: Server) {
    // Accusés de lecture : qu'ils viennent du HTTP (ouverture de la page) ou du WebSocket, la
    // conversation est prévenue en temps réel (« Vu » côté expéditeur).
    this.conversationsService.onMessagesRead((e) => {
      server.to(roomName(e.conversationId)).emit('read', { conversationId: e.conversationId, readerId: e.readerId, readAt: e.readAt.toISOString() });
    });
    // Tout ce qui change dans une conversation (AUDIT §60) — texte, photo, proposition de prix, réponse à une proposition,
    // message automatique de suivi de vente —, d'où qu'il vienne (socket ou route HTTP) : la conversation ouverte le
    // reçoit aussitôt ; « inbox » réveille les deux boîtes (badge de non-lus, liste des conversations, état de la vente).
    this.conversationsService.onMessageEvent((e) => {
      server.to(roomName(e.message.conversationId)).emit(e.kind === 'new' ? 'message' : 'message:update', e.message);
      for (const uid of [e.buyerId, e.sellerId]) server.to(userRoom(uid)).emit('inbox', { conversationId: e.message.conversationId });
    });
    server.use(async (socket, next) => {
      try {
        // AUDIT §69 : jeton lu dans `auth` seulement (jamais dans l'URL, qui finit dans les journaux des proxys)
        const token = socket.handshake.auth?.token as string;
        if (!token) throw new Error('Token manquant');
        const payload = await this.jwtService.verifyAsync(token);
        // Jeton intermédiaire (défi de double authentification) : n'ouvre jamais une session, ni HTTP ni temps réel (AUDIT §69)
        if (payload.purpose) throw new Error('Jeton intermédiaire refusé');
        const user = await this.usersService.findById(payload.sub);
        if (!user || user.deletedAt || user.suspendedAt) throw new Error('Compte indisponible');
        socket.data.userId = user.id;
        next();
      } catch (err) {
        this.logger.warn(`Connexion WS refusée : ${(err as Error).message}`);
        next(new Error('Authentification invalide.'));
      }
    });
  }

  handleConnection(client: Socket) {
    // Le middleware a déjà validé le compte ; on rejoint la room personnelle
    // (badge "boîte de réception" en temps réel).
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      client.disconnect(true);
      return;
    }
    client.join(userRoom(userId));
    this.online.set(userId, (this.online.get(userId) ?? 0) + 1);
    this.logger.log(`Client connecté : user ${userId}`);
  }

  /** Sockets ouverts par membre (AUDIT §62) : « en ligne » = au moins un onglet connecté, sans heure de dernière visite. */
  private readonly online = new Map<string, number>();
  /** Conversations ouvertes par chaque membre (tous onglets) : prévenues quand il se déconnecte, d'où qu'il parte. */
  private readonly roomsOf = new Map<string, Set<string>>();
  isOnline(userId: string): boolean {
    return (this.online.get(userId) ?? 0) > 0;
  }

  /** AUDIT §73 : compte suspendu → ses sockets sont fermés tout de suite (les sessions révoquées ne coupaient pas le temps réel). */
  disconnectUser(userId: string): number {
    let n = 0;
    for (const socket of this.server?.sockets?.sockets?.values() ?? []) {
      if (socket.data?.userId === userId) {
        socket.disconnect(true);
        n += 1;
      }
    }
    return n;
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId as string | undefined;
    if (userId) {
      const left = (this.online.get(userId) ?? 1) - 1;
      if (left > 0) this.online.set(userId, left);
      else {
        this.online.delete(userId);
        // Dernier onglet fermé : les conversations que ce socket avait ouvertes voient la pastille passer à « absent »
        for (const room of this.roomsOf.get(userId) ?? []) this.server.to(room).emit('presence', { userId, online: false });
        this.roomsOf.delete(userId);
      }
    }
    this.logger.log(`Client déconnecté : ${userId ?? 'inconnu'}`);
  }

  @SubscribeMessage('join')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { conversationId: string }) {
    if (!client.data.userId || typeof data?.conversationId !== 'string' || !UUID.test(data.conversationId)) {
      return { ok: false, message: 'Requête invalide.' };
    }
    try {
      await this.conversationsService.assertMember(data.conversationId, client.data.userId);
      // AUDIT §69 : blocage dans un sens ou l'autre → pas de temps réel (présence, frappe, lectures) pour l'un ni l'autre
      if (await this.conversationsService.isBlockedConversation(data.conversationId, client.data.userId)) {
        return { ok: false, message: 'Vous ne pouvez plus échanger avec cet utilisateur.', blocked: true };
      }
      client.join(roomName(data.conversationId));
      client.to(roomName(data.conversationId)).emit('presence', { userId: client.data.userId, online: true });
      if (!this.roomsOf.has(client.data.userId)) this.roomsOf.set(client.data.userId, new Set());
      this.roomsOf.get(client.data.userId)!.add(roomName(data.conversationId));
      const peerId = await this.conversationsService.peerOf(data.conversationId, client.data.userId);
      return { ok: true, conversationId: data.conversationId, peerOnline: !!peerId && this.isOnline(peerId) };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  @SubscribeMessage('leave')
  onLeave(@ConnectedSocket() client: Socket, @MessageBody() data: { conversationId: string }) {
    if (typeof data?.conversationId === 'string') client.leave(roomName(data.conversationId));
    return { ok: true };
  }

  /** Le destinataire signale qu'il a affiché la conversation (messages reçus marqués lus). */
  @SubscribeMessage('read')
  async onRead(@ConnectedSocket() client: Socket, @MessageBody() data: { conversationId: string }) {
    if (!client.data.userId || typeof data?.conversationId !== 'string') return { ok: false, message: 'Requête invalide.' };
    try {
      await this.conversationsService.assertMember(data.conversationId, client.data.userId);
      const readAt = await this.conversationsService.markRead(data.conversationId, client.data.userId);
      return { ok: true, readAt: readAt?.toISOString() ?? null };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  /**
   * Indicateur de frappe : relayé tel quel aux autres membres de la room (jamais stocké).
   * Le client doit avoir rejoint la room (donc être membre vérifié) ; aucun accès base par frappe.
   */
  @SubscribeMessage('typing')
  onTyping(@ConnectedSocket() client: Socket, @MessageBody() data: { conversationId: string; typing: boolean }) {
    if (!client.data.userId || typeof data?.conversationId !== 'string') return { ok: false, message: 'Requête invalide.' };
    if (!client.rooms.has(roomName(data.conversationId))) return { ok: false, message: 'Conversation non rejointe.' };
    client.to(roomName(data.conversationId)).emit('typing', { conversationId: data.conversationId, userId: client.data.userId, typing: data.typing === true });
    return { ok: true };
  }

  @SubscribeMessage('message')
  async onMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; content: string },
  ) {
    if (!client.data.userId || typeof data?.conversationId !== 'string' || !UUID.test(data.conversationId) || typeof data?.content !== 'string') {
      return { ok: false, message: 'Requête invalide.' };
    }
    const now = Date.now();
    const rate = (client.data.rate as { count: number; since: number } | undefined) ?? { count: 0, since: now };
    if (now - rate.since > 60_000) { rate.count = 0; rate.since = now; }
    rate.count += 1;
    client.data.rate = rate;
    if (rate.count > WS_MESSAGES_PER_MINUTE) return { ok: false, message: 'Trop de messages en peu de temps : patientez une minute.' };
    try {
      const message = await this.conversationsService.postMessage(
        data.conversationId,
        client.data.userId,
        data.content,
      );
      // La diffusion (conversation ouverte + réveil des deux boîtes) est faite par l'abonnement ci-dessus, commun à tous les chemins
      // L'expéditeur reçoit aussi le message en retour d'accusé (utile s'il n'a pas encore rejoint la room)
      return { ok: true, messageId: message.id, message };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}
