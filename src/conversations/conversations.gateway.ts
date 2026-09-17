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
    // Messages automatiques de suivi de vente (AUDIT §57) : écrits par le service des paiements, hors WebSocket. La
    // conversation ouverte les reçoit aussitôt ; « inbox » réveille les deux boîtes (badge, état de la vente relu).
    this.conversationsService.onSystemMessage((e) => {
      server.to(roomName(e.message.conversationId)).emit('message', e.message);
      for (const uid of [e.buyerId, e.sellerId]) server.to(userRoom(uid)).emit('inbox', { conversationId: e.message.conversationId });
    });
    server.use(async (socket, next) => {
      try {
        const token =
          (socket.handshake.auth?.token as string) ||
          (socket.handshake.query?.token as string);
        if (!token) throw new Error('Token manquant');
        const payload = await this.jwtService.verifyAsync(token);
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
    this.logger.log(`Client connecté : user ${userId}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client déconnecté : ${client.data?.userId ?? 'inconnu'}`);
  }

  @SubscribeMessage('join')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { conversationId: string }) {
    if (!client.data.userId || typeof data?.conversationId !== 'string') {
      return { ok: false, message: 'Requête invalide.' };
    }
    try {
      await this.conversationsService.assertMember(data.conversationId, client.data.userId);
      client.join(roomName(data.conversationId));
      return { ok: true, conversationId: data.conversationId };
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
    if (!client.data.userId || typeof data?.conversationId !== 'string' || typeof data?.content !== 'string') {
      return { ok: false, message: 'Requête invalide.' };
    }
    try {
      const message = await this.conversationsService.postMessage(
        data.conversationId,
        client.data.userId,
        data.content,
      );
      this.server.to(roomName(data.conversationId)).emit('message', message);
      // Réveil de l'autre participant même s'il n'a pas rejoint la room (badge non-lus)
      const conv = await this.conversationsService.assertMember(data.conversationId, client.data.userId);
      const otherId = conv.buyerId === client.data.userId ? conv.sellerId : conv.buyerId;
      this.server.to(userRoom(otherId)).emit('inbox', { conversationId: data.conversationId });
      // L'expéditeur reçoit aussi le message en retour d'accusé (utile s'il n'a pas encore rejoint la room)
      return { ok: true, messageId: message.id, message };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}
