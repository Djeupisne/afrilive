# PROGRESS — AfriLive Backend (NestJS)

Protocole de reprise : lire ce fichier en premier, puis `git log --oneline`,
puis vérifier les fichiers vides (`find . -type f -empty -not -path "./node_modules/*"`).

## État des étapes

### Étape 0 — Terminée ✅
- Structure du dépôt initialisée, dépôt Git actif.

### Étape 1 — EN COURS 🔄
Fait :
- backend/package.json
- backend/tsconfig.json
- backend/tsconfig.build.json
- backend/nest-cli.json
- backend/eslint.config.mjs
- backend/.prettierrc
- backend/.env.example

Reste :
- backend/src/common/** (AppException, error-codes, domain-events, guards JWT/roles,
  decorators, filtre RFC 7807, intercepteurs, pagination curseur, money.ts, enums)
- backend/src/config/** (configuration.ts, env.validation.ts)
- backend/src/database/** (prisma.module.ts, prisma.service.ts)
- backend/src/main.ts
- backend/src/app.module.ts
- backend/Dockerfile
- backend/.dockerignore
- À la racine : docker-compose.yml, livekit.yaml, .gitignore, README.md

Gate étape 1 : `npm run build` + `npm run lint` doivent passer.

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
