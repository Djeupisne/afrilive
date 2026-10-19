# AfriLive

Super-app africaine : vidéos courtes, lives shopping, marketplace, wallet et messagerie.

## Structure

```
backend/   API NestJS (Prisma + PostgreSQL, Redis, BullMQ, LiveKit, Meilisearch)
mobile/    App mobile (React Native / Expo)
web/       App web (Next.js)
```

## Démarrage rapide (dev)

```bash
cp backend/.env.example backend/.env
docker compose up -d db redis meili minio livekit
cd backend && npm ci && npx prisma generate && npx prisma migrate deploy
npm run build && npm run start:dev
```

API : http://localhost:3000/api/v1 — docs Swagger : http://localhost:3000/docs

## Conventions API

- Réponses d'erreur au format **RFC 7807** (`application/problem+json`), messages FR/EN selon `Accept-Language`.
- En-tête `Idempotency-Key` requis côté écritures sensibles (paiements, commandes) ; la réponse est rejouée en cas de doublon.
- Pagination par curseur (`?cursor=&limit=`) pour les flux, offset (`?page=&limit=`) pour l'admin.
- Montants toujours en **unités mineures entières** (ex. FCFA : exposant 0, NGN : 2).

## Backend

Voir `backend/PROGRESS.md` (protocole de reprise) et `backend/prisma/schema.prisma` (source de vérité du modèle).
