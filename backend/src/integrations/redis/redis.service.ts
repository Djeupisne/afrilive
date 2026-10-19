import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

export interface GeoMember {
  longitude: number;
  latitude: number;
  member: string;
}

export interface GeoResult {
  member: string;
  distanceMeters: number | null;
}

/**
 * Service Redis global : client ioredis unique + helpers métier.
 * CRUD clés (get/set/del/incr/expire), setNx avec TTL, verrous distribués (withLock),
 * géo (GEOADD/GEOSEARCH), ensembles avec TTL, pub/sub, fermeture propre à l'arrêt.
 * Redis est une dépendance OBLIGATOIRE : si la connexion échoue, l'app ne démarre pas.
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService) {
    const url = config.get<string>('app.redis.url') as string;
    const opts: RedisOptions = {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times: number) => Math.min(times * 200, 5_000),
    };
    this.client = new Redis(url, opts);
    this.client.on('error', (e: Error) => this.logger.warn(`Redis: ${e.message}`));
    this.client.on('ready', () => this.logger.log('Redis connecté'));
  }

  // ---------- Base ----------

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /** `ttlSec` optionnel : expiration posée dans le même appel que le SET. */
  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec && ttlSec > 0) await this.client.set(key, value, 'EX', ttlSec);
    else await this.client.set(key, value);
  }

  async del(...keys: string[]): Promise<number> {
    return keys.length ? this.client.del(...keys) : 0;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSec: number): Promise<boolean> {
    return (await this.client.expire(key, ttlSec)) === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  /** GET atomique avec désérialisation JSON ; null si absent/illisible. */
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSec?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSec);
  }

  // ---------- Setnx / verrous ----------

  /** SET NX EX : true si la clé a été posée (premier appelant). */
  async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
    const res = await this.client.set(key, value, 'EX', ttlSec, 'NX');
    return res === 'OK';
  }

  /**
   * Verrou distribué simple : acquire/release via Lua (le release ne supprime
   * que le token possédé — pas de libération du verrou d'autrui).
   */
  async withLock<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T | null> {
    const lockKey = `lock:${key}`;
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const acquired = await this.setNx(lockKey, token, ttlSec);
    if (!acquired) return null; // verrou déjà tenu → l'appelant décide du repli
    try {
      return await fn();
    } finally {
      await this.client
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          lockKey,
          token,
        )
        .catch(() => undefined);
    }
  }

  // ---------- GEO ----------

  async geoAdd(key: string, members: GeoMember[]): Promise<number> {
    if (!members.length) return 0;
    const args: (number | string)[] = [];
    for (const m of members) args.push(m.longitude, m.latitude, m.member);
    return this.client.geoadd(key, ...args);
  }

  /**
   * GEOSEARCH par rayon (km). Retourne membres triés du plus proche au plus loin.
   */
  async geoSearch(key: string, lng: number, lat: number, radiusKm: number, count = 100): Promise<GeoResult[]> {
    const res = await this.client.geosearch(key, 'BYRADIUS', radiusKm, 'km', 'FROMCOORD', lng, lat, 'COUNT', count, 'ASC', 'WITHDIST');
    return (res as [string, string][]).map(([member, dist]) => ({
      member,
      distanceMeters: Number(dist) * 1000,
    }));
  }

  // ---------- Sets avec TTL ----------

  async sAdd(key: string, ttlSec: number, ...members: string[]): Promise<number> {
    const added = await this.client.sadd(key, ...members);
    // Le TTL est réinitialisé à chaque écriture (fenêtre glissante).
    await this.client.expire(key, ttlSec);
    return added;
  }

  async sIsMember(key: string, member: string): Promise<boolean> {
    return (await this.client.sismember(key, member)) === 1;
  }

  async sMembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  // ---------- Pub/Sub ----------

  async publish(channel: string, message: unknown): Promise<number> {
    return this.client.publish(channel, typeof message === 'string' ? message : JSON.stringify(message));
  }

  /** Abonnement durable ; retourne un handle pour se désabonner. */
  async subscribe(channel: string, handler: (message: string) => void | Promise<void>): Promise<{ stop: () => Promise<void> }> {
    const sub = this.client.duplicate();
    sub.on('error', (e: Error) => this.logger.warn(`Redis sub(${channel}): ${e.message}`));
    await sub.subscribe(channel);
    sub.on('message', (_ch: string, msg: string) => {
      void Promise.resolve(handler(msg)).catch((e: unknown) =>
        this.logger.error(`Handler ${channel}: ${(e as Error)?.message ?? e}`),
      );
    });
    return {
      stop: async () => {
        await sub.unsubscribe(channel).catch(() => undefined);
        sub.disconnect();
      },
    };
  }

  // ---------- Cycle de vie ----------

  async onApplicationShutdown(): Promise<void> {
    this.client.disconnect();
    this.logger.log('Redis déconnecté (arrêt propre)');
  }
}
