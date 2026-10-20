import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DOMAIN_EVENTS } from '../../common/events/domain-events';
import { PrismaService } from '../../database/prisma.service';
import { LivesService } from './lives.service';
import type { LiveMessageDto } from './dto/lives.dto';

interface WsActor {
  id: string;
  role: string;
}

/**
 * Passerelle temps réel des lives (namespace /lives).
 * - Rooms Socket.IO `live:<liveId>` ; événements diffusés : message.new,
 *   product.pinned, live.started, live.ended.
 * - Le chat HTTP (LivesService.postMessage) est la source de vérité : le
 *   gateway relaye vers la room après persistance.
 * NB : l'authentification JWT du WS reste à durcir en phase mobile (TODO v2) ;
 * les mutations passent par les mêmes gardes que le service REST.
 */
@WebSocketGateway({ namespace: '/lives', cors: { origin: true } })
export class LivesGateway implements OnGatewayConnection {
  private readonly logger = new Logger(LivesGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly lives: LivesService,
    private readonly prisma: PrismaService,
  ) {}

  handleConnection(client: Socket): void {
    client.on('error', () => undefined);
  }

  /** Rejoint la room d'une session (les spectateurs voient le flux du chat). */
  @SubscribeMessage('live:join')
  async join(@ConnectedSocket() client: Socket, @MessageBody() payload: { liveId: string }) {
    const live = await this.prisma.liveSession.findUnique({
      where: { id: payload?.liveId },
      select: { id: true, status: true },
    });
    if (!live) return { ok: false, error: 'LIVE_NOT_FOUND' };
    await client.join(`live:${live.id}`);
    return { ok: true, liveId: live.id, status: live.status };
  }

  @SubscribeMessage('live:leave')
  async leave(@ConnectedSocket() client: Socket, @MessageBody() payload: { liveId: string }) {
    if (payload?.liveId) await client.leave(`live:${payload.liveId}`);
    return { ok: true };
  }

  /** Message de chat via WS : persisté par le service puis relayé à la room. */
  @SubscribeMessage('live:message')
  async message(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { liveId: string } & LiveMessageDto,
  ) {
    const actor: WsActor = { id: (client.data as { userId?: string })?.userId ?? 'anonymous', role: 'USER' };
    try {
      const msg = await this.lives.postMessage(actor, payload.liveId, { text: payload.text, pinned: payload.pinned });
      this.server.to(`live:${payload.liveId}`).emit('message.new', msg);
      return { ok: true, id: msg.id };
    } catch (err) {
      this.logger.warn(`live:message refusé (${payload?.liveId}) : ${(err as Error).message}`);
      return { ok: false, error: (err as Error).name };
    }
  }

  // ------------------------------------------------ Relay des événements REST

  @OnEvent(DOMAIN_EVENTS.LIVE_STARTED)
  onStarted(payload: { liveId: string }): void {
    this.server?.to(`live:${payload.liveId}`).emit('live.started', payload);
  }

  @OnEvent(DOMAIN_EVENTS.LIVE_ENDED)
  onEnded(payload: { liveId: string }): void {
    this.server?.to(`live:${payload.liveId}`).emit('live.ended', payload);
  }

  @OnEvent(DOMAIN_EVENTS.LIVE_PRODUCT_PINNED)
  onPinned(payload: { liveId: string; liveProductId: string }): void {
    this.server?.to(`live:${payload.liveId}`).emit('product.pinned', payload);
  }
}
