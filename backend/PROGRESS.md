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

PROCHAINE ACTION : backend/src/common/decorators (current-user, roles, public),
puis guards → filters → interceptors → dto/utils → config → database → main.ts
→ app.module.ts → Dockerfile/docker-compose/livekit/README.
Gate à chaque groupe : `npm run build` + `npm run lint`, commit après chaque groupe qui compile.

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
