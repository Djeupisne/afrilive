import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevicePlatform } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { FcmProvider } from './fcm.provider';
import { HmsProvider } from './hms.provider';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Routage des notifications push par DeviceToken.platform :
 * - FCM / APNS / WEB -> Firebase Cloud Messaging (APNs transite par FCM).
 * - HMS -> Huawei Push Kit.
 * Les tokens signalés invalides par les fournisseurs sont supprimés en base.
 * PUSH_MODE=console force le mode journalisé sans appel réseau.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly fcm: FcmProvider,
    private readonly hms: HmsProvider,
  ) {}

  private get consoleMode(): boolean {
    return (this.config.get<string>('app.modes.push') ?? 'console') === 'console';
  }

  /** Envoie à tous les devices d'un utilisateur ; purge les tokens morts. */
  async sendToUser(userId: string, payload: PushPayload): Promise<{ sent: number; purged: number }> {
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { id: true, token: true, platform: true },
    });
    if (tokens.length === 0) return { sent: 0, purged: 0 };

    if (this.consoleMode) {
      this.logger.log(`[Push console] user=${userId} (${tokens.length} devices) ${payload.title} — ${payload.body}`);
      return { sent: tokens.length, purged: 0 };
    }

    const byFcm = tokens.filter((t) => t.platform !== DevicePlatform.HMS);
    const byHms = tokens.filter((t) => t.platform === DevicePlatform.HMS);
    let sent = 0;
    const deadTokens: string[] = [];

    if (byFcm.length > 0) {
      const r = await this.fcm.sendToTokens(byFcm.map((t) => t.token), payload.title, payload.body, payload.data);
      sent += r.ok.length;
      deadTokens.push(...r.invalid);
    }
    if (byHms.length > 0) {
      const r = await this.hms.sendToTokens(byHms.map((t) => t.token), payload.title, payload.body, payload.data);
      sent += r.ok.length;
      deadTokens.push(...r.invalid);
    }

    let purged = 0;
    if (deadTokens.length > 0) {
      const del = await this.prisma.deviceToken.deleteMany({ where: { token: { in: deadTokens } } });
      purged = del.count;
      this.logger.log(`Purge de ${purged} token(s) push invalide(s)`);
    }
    return { sent, purged };
  }

  /** Envoi direct sur un token précis (ex. vérification lors de l'enregistrement). */
  async sendToToken(token: string, platform: DevicePlatform, payload: PushPayload): Promise<boolean> {
    if (this.consoleMode) {
      this.logger.log(`[Push console] token=${token} platform=${platform} ${payload.title} — ${payload.body}`);
      return true;
    }
    if (platform === DevicePlatform.HMS) {
      const r = await this.hms.sendToTokens([token], payload.title, payload.body, payload.data);
      return r.ok.length > 0;
    }
    const r = await this.fcm.sendToTokens([token], payload.title, payload.body, payload.data);
    return r.ok.length > 0;
  }
}
