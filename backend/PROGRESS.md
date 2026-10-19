# PROGRESS — backend AfriLive Market

## État des étapes

- **Étape 0 : TERMINÉE** — scaffolding du dépôt (structure backend/mobile/web/tools).
- **Étape 1 : EN COURS** — socle NestJS.
  - Fait : `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `eslint.config.mjs`, `.prettierrc`, `.env.example`.
  - Reste : `common/*`, `config/*`, `database/*`, `main.ts`, `app.module.ts`, `Dockerfile`, `.dockerignore`, et à la racine `docker-compose.yml`, `livekit.yaml`, `.gitignore`, `README.md`.
  - Gate de validation : `npm run build` + `npm run lint`.
- **Étape 2 : schema.prisma terminé et validé (78 modèles)** ; migration reportée [HYPOTHÈSE : pas de Docker/Postgres dans l'environnement]. Migration SQL générée sans base via `prisma migrate diff --from-empty --to-schema-datamodel` → `prisma/migrations/0001_init/migration.sql` + `prisma/migrations/migration_lock.toml` (provider = "postgresql"). À appliquer plus tard avec `npx prisma migrate deploy`.
- **Étape 3 : À FAIRE** — intégrations (SMS, push, storage, email, queue, redis, livekit…).

## Ajouts de fichiers

- `backend/PROGRESS.md` : présent fichier (journal d'avancement).
- `backend/.env` : créé depuis `.env.example` (DATABASE_URL local factice) pour que `npx prisma validate` passe ; ajouté au `.gitignore`.
- `prisma/migrations/0001_init/migration.sql` + `prisma/migrations/migration_lock.toml` : migration initiale générée sans base de données.
- **`tools/` supprimé** : `prisma/schema.prisma` est désormais la source de vérité du schéma ; le générateur `tools/gen_schema.py` ne sert plus et ne sera jamais relancé (ne pas régénérer le schéma).

## Conventions / notes

- Shell instable : écrire les fichiers un par un, commiter après chaque groupe qui compile.
- Ne pas régénérer `schema.prisma` via tools/.
- Les fichiers vides listés par `find . -type f -empty` sont des placeholders d'étapes futures ; ils seront remplis au fil des étapes.
