# PROGRESS — Backend AfriLive

## Plan (numérotation d'origine du cahier des charges)

| Étape | Contenu | Statut |
|---|---|---|
| 1 | Fondations (NestJS, config, erreurs RFC 7807, guards/interceptors, utils money/pagination, enums) | **TERMINÉE** |
| 2 | Prisma (schema, enums, migrations) | **TERMINÉE** — migration `0001_init` générée hors ligne (`prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`) ; application en base (`prisma migrate deploy`) **reportée** (aucune instance Postgres disponible dans l'environnement de dev) |
| 3 | Intégrations (redis, storage, queue, sms, push, email) + specs utils | **EN COURS** |
| 4 | Modules métier (auth en premier, puis users/wallet/payments/orders/lives/…) | À FAIRE |

## Décisions actées

- **Préfixe global API = `/api/v1`** partout où le cahier des charges écrit `/v1`.
  Appliqué dans : `src/main.ts` (`setGlobalPrefix('api/v1')` + versioning URI défaut `1`), README (`http://localhost:3000/api/v1`), Swagger monté sur `/docs` (le document reflète le préfixe global). Healthcheck docker-compose : endpoints db/redis OK ; le chemin health de l'API suivra le préfixe `/api/v1` quand le module health existera.
- **npm avec `legacy-peer-deps=true`** → consigné dans `backend/.npmrc` ; le Dockerfile copie `.npmrc` avant `npm ci` (build et runtime).
- **Throttler sur Redis** : stockage distribué via `@nest-lab/throttler-storage-redis` (`ThrottlerStorageRedisService`), branché en `ThrottlerModule.forRootAsync`.
- **Redis obligatoire** : l'`IdempotencyInterceptor` s'appuie sur `RedisService` (plus aucun comportement no-op sans Redis).
- **rawBody** : `NestFactory.create(AppModule, { rawBody: true })` pour la vérification de signature des webhooks (`req.rawBody`) ; parsing JSON actif par défaut pour les autres routes.

## État détaillé — Étape 3 (Intégrations)

- [ ] B1 redis : `RedisModule` @Global + `RedisService` (get/set/del/incr/expire, setNx+TTL, withLock, GEO, sets+TTL, pub/sub, shutdown propre) ; IdempotencyInterceptor rebasé ; Throttler Redis.
- [ ] B2 storage : S3 compatible R2/MinIO (presignPut/Get, multipart, delete, copy, CDN, token CDN signé).
- [ ] B3 queue : BullMQ, 6 queues (video-transcode, moderation-scan, notification-fanout, webhook-process, search-index, payout), backoff exponentiel, removeOnComplete/Fail bornés.
- [ ] B4 sms : Termii (NG/GH), Africa's Talking (autres pays), repli WhatsApp, SMS_MODE=console, timeouts/retries → AppException.
- [ ] B5 push : FCM (firebase-admin, APNs via FCM), HMS (HTTP), routage DeviceToken.platform, désactivation propre si clés absentes, purge tokens invalides.
- [ ] B6 email : nodemailer SMTP ou mode console.
- [ ] Enregistrement des modules dans `app.module.ts`.
- [ ] Specs : money.spec.ts, pagination.spec.ts, enums/transitions.spec.ts, sms.service.spec.ts.

## Conventions

- Un fichier à la fois, build vert avant chaque commit ; gate complète : `npx prisma validate && npm run build && npm run lint && npm test`.
- `npm install` utilise `legacy-peer-deps` (voir `.npmrc`).
- Unités monétaires : entiers en unités mineures, jamais de flottants (voir `src/common/utils/money.ts`).
- Erreurs : `AppException` + codes stables `ERROR_CODES` (RFC 7807).

## PROCHAINE ACTION

B1 — redis : implémenter `RedisModule`/`RedisService`, rebaser `IdempotencyInterceptor`, brancher le throttler Redis. Puis modules métier : **module auth** en premier (dto → otp → token → jwt.strategy → social verifiers → two-factor → auth.service → auth.controller → kyc → module → app.module → specs → gate → commit).
