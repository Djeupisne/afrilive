import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

/**
 * Noms des 6 queues de travail de l'application (constantes stables).
 * video-transcode : transcodage HLS ; moderation-scan : scan IA/humain ;
 * notification-fanout : envoi multi-canaux ; webhook-process : webhooks entrants ;
 * search-index : indexation Meilisearch ; payout : payouts mobile money.
 */
export const QUEUES = {
  VIDEO_TRANSCODE: 'video-transcode',
  MODERATION_SCAN: 'moderation-scan',
  NOTIFICATION_FANOUT: 'notification-fanout',
  WEBHOOK_PROCESS: 'webhook-process',
  SEARCH_INDEX: 'search-index',
  PAYOUT: 'payout',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Options par défaut appliquées à toutes les queues. */
const DEFAULT_QUEUE_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 }, // 2s, 4s, 8s, 16s…
  removeOnComplete: { age: 3600, count: 1_000 }, // borné : 1 h / 1 000 jobs
  removeOnFail: { age: 24 * 3600, count: 5_000 }, // borné : 24 h / 5 000 échecs
};

/**
 * Connexion BullMQ unique (via le Redis de l'app) + enregistrement des 6 queues.
 * @Global pour que tout module métier puisse injecter getQueue(QueueName.X).
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('app.redis.url')! },
        defaultJobOptions: DEFAULT_QUEUE_OPTIONS,
      }),
    }),
    BullModule.registerQueue(
      ...Object.values(QUEUES).map((name) => ({ name })),
    ),
  ],
})
export class QueueModule {}
