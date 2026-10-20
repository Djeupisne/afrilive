import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';

export interface LiveToken {
  token: string;
  url: string;
  roomName: string;
}

/**
 * Fine wrapper du SDK LiveKit : emission des JWT participant (TTL 6 h) et
 * suppression de room. Les secrets viennent de app.livekit.* (LIVEKIT_URL /
 * LIVEKIT_API_KEY / LIVEKIT_API_SECRET) — jamais hardcodes.
 */
@Injectable()
export class LivekitService {
  constructor(private readonly config: ConfigService) {}

  /** JWT pour un participant donne (hote = publisher, spectateur = subscriber). */
  issueToken(identity: string, roomName: string, canPublish: boolean): LiveToken {
    const apiKey = this.config.get<string>('app.livekit.apiKey') ?? '';
    const apiSecret = this.config.get<string>('app.livekit.apiSecret') ?? '';
    const url = this.config.get<string>('app.livekit.url') ?? '';
    const at = new AccessToken(apiKey, apiSecret, { identity, ttl: '6h' });
    at.addGrant({ room: roomName, roomJoin: true, canPublish, canSubscribe: true });
    return { token: at.toJwt(), url, roomName };
  }

  /** Ferme la room cote LiveKit (appelee a la fin du live, best effort). */
  async closeRoom(roomName: string): Promise<void> {
    // Le RoomService n'est utilise qu'avec des credentials reels ; en mode
    // dev/test sans secret, on ignore silencieusement (le statut DB fait foi).
    const apiKey = this.config.get<string>('app.livekit.apiKey') ?? '';
    if (!apiKey) return;
    const { RoomServiceClient } = await import('livekit-server-sdk');
    const httpUrl = (this.config.get<string>('app.livekit.url') ?? '').replace('ws://', 'http://').replace('wss://', 'https://');
    const rooms = new RoomServiceClient(httpUrl, apiKey, this.config.get<string>('app.livekit.apiSecret'));
    await rooms.deleteRoom(roomName);
  }
}
