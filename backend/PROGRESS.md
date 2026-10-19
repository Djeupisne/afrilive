# PROGRESS — AfriLive Backend (NestJS)

Protocole de reprise : lire ce fichier en premier, puis `git log --oneline`,
puis vérifier les fichiers vides (`find . -type f -empty -not -path "./node_modules/*"`).

## État des étapes

### Étape 0 — Terminée ✅
- Structure du dépôt initialisée, dépôt Git actif.

### Étape 1 — EN COURS 🔄
Fait :
- backend/package.json, tsconfig.json, tsconfig.build.json, nest-cli.json,
  eslint.config.mjs, .prettierrc, .env.example
- backend/src/common/errors/ (app.exception.ts, error-codes.ts) — AppException
  RFC 7807 + codes stables AFRI-<domaine>-<numéro>.
- backend/src/common/events/domain-events.ts — noms d'événements + payloads typés.
- backend/src/common/enums/ (role, kyc-status, order-status, payment-status) —
  **re-export des enums générés par @prisma/client** (vérifiés identiques au
  schéma Prisma : Role, KycStatus, OrderStatus, PaymentStatus) ; les fichiers ne
  contiennent que les helpers (statuts terminaux, tables de transitions).

- backend/src/common/decorators/ (current-user, roles, public) ✅
- backend/src/common/guards/ (jwt-auth global avec @Public, roles) ✅
- backend/src/common/filters/http-exception.filter.ts (RFC 7807, FR/EN selon Accept-Language) ✅
- backend/src/common/interceptors/ (idempotency Redis SET NX + rejeu, logging x-request-id) ✅
- backend/src/common/dto/pagination.dto.ts + utils (pagination curseur keyset, money.ts table des exposants ISO 4217) ✅
- backend/src/config/ (configuration.ts registerAs + env.validation.ts) ✅
- backend/src/database/ (PrismaModule global, PrismaService) ✅
- backend/src/main.ts (helmet, compression, CORS, ValidationPipe, Swagger /docs, filtre global, shutdown propre) ✅
- backend/src/app.module.ts (ConfigModule, EventEmitter, Schedule, Throttler, Prisma ; guards JWT/Roles/Throttler et intercepteurs globaux) ✅
- backend/Dockerfile (multi-stage node:20-alpine + tini), backend/.dockerignore ✅
- Racine : docker-compose.yml (db/redis/meili/minio/livekit/api), livekit.yaml, .gitignore, README.md ✅

Étape 1 TERMINÉE ✅ — Gate validée : `npm run build` OK, `npm run lint` OK (0 erreur).

PROCHAINE ACTION : Étape 2 modules métier — implémenter src/modules/** (commencer par auth : JwtStrategy + endpoints OTP/refresh dans le squelette existant) puis integrations/**.

### Étape 2 — Schéma Prisma
- backend/prisma/schema.prisma : TERMINÉ et validé (78 modèles).
- Migration reportée [HYPOTHÈSE : pas de Docker/Postgres dans l'environnement].
  → Migration générée sans base via `prisma migrate diff --from-empty
  --to-schema-datamodel --script` dans prisma/migrations/0001_init/migration.sql,
  appliquée plus tard avec `npx prisma migrate deploy`.

### Étape 3 — Intégrations (à venir)
- backend/src/integrations/** (sms, email, push, storage, redis, queue) — fichiers
  squelettes présents, à implémenter après l'étape 1.

## Ajouts de fichiers / suppressions notables
- `tools/` SUPPRIMÉ : le générateur `tools/gen_schema.py` n'est plus dans la
  structure cible. **backend/prisma/schema.prisma est désormais la source de
  vérité ; ne plus régénérer le schéma via un outil.**
- `backend/.env` créé depuis `.env.example` (DATABASE_URL local factice) pour
  que `npx prisma validate` passe ; ajouté au `.gitignore`.

## Conventions shell (environnement instable)
- Écrire les fichiers UN PAR UN (pas de commandes géantes).
- Committed après chaque groupe de fichiers qui compile.
