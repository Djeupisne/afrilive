# PROGRESS — Backend AfriLive

## Plan (numérotation d'origine du cahier des charges)

| Étape | Contenu | Statut |
|---|---|---|
| 1 | Fondations (NestJS, config, erreurs RFC 7807, guards/interceptors, utils money/pagination, enums) | **TERMINÉE** |
| 2 | Prisma (schema, enums, migrations) | **TERMINÉE** — migration `0001_init` générée hors ligne (`prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`) ; application en base (`prisma migrate deploy`) **reportée** (aucune instance Postgres disponible dans l'environnement de dev) |
| 3 | Intégrations (redis, storage, queue, sms, push, email) + specs utils | **TERMINÉE** (gate : prisma validate + build + lint + test = 55/55 verts) |
| 4 | Modules métier (auth en premier, puis users/wallet/payments/orders/lives/…) | **EN COURS** — auth TERMINÉE ✅, users TERMINÉ ✅, shops/products TERMINÉS ✅, orders/payments TERMINÉS ✅, wallet TERMINÉ ✅ ; reste : lives/videos → chats/feed/follows/search/notifications/moderation/deliveries |

## Décisions actées

- **Préfixe global API = `/api/v1`** partout où le cahier des charges écrit `/v1`.
  Appliqué dans : `src/main.ts` (`setGlobalPrefix('api/v1')` + versioning URI défaut `1`), README (`http://localhost:3000/api/v1`), Swagger monté sur `/docs` (le document reflète le préfixe global). Healthcheck docker-compose : endpoints db/redis OK ; le chemin health de l'API suivra le préfixe `/api/v1` quand le module health existera.
- **npm avec `legacy-peer-deps=true`** → consigné dans `backend/.npmrc` ; le Dockerfile copie `.npmrc` avant `npm ci` (build et runtime).
- **Throttler sur Redis** : stockage distribué via `@nest-lab/throttler-storage-redis` (`ThrottlerStorageRedisService`), branché en `ThrottlerModule.forRootAsync`.
- **Redis obligatoire** : l'`IdempotencyInterceptor` s'appuie sur `RedisService` (plus aucun comportement no-op sans Redis).
- **rawBody** : `NestFactory.create(AppModule, { rawBody: true })` pour la vérification de signature des webhooks (`req.rawBody`) ; parsing JSON actif par défaut pour les autres routes.

## État détaillé — Étape 3 (Intégrations)

- [x] B1 redis : `RedisModule` @Global + `RedisService` (get/set/del/incr/expire, setNx+TTL, withLock, GEO, sets+TTL, pub/sub, shutdown propre) ; IdempotencyInterceptor rebasé ; Throttler Redis.
- [x] B2 storage : S3 compatible R2/MinIO (presignPut/Get, multipart, delete, copy, CDN, token CDN signé).
- [x] B3 queue : BullMQ, 6 queues (video-transcode, moderation-scan, notification-fanout, webhook-process, search-index, payout), backoff exponentiel, removeOnComplete/Fail bornés.
- [x] B4 sms : Termii (NG/GH), Africa's Talking (autres pays), repli WhatsApp, SMS_MODE=console, timeouts/retries → AppException.
- [x] B5 push : FCM (firebase-admin, APNs via FCM), HMS (HTTP), routage DeviceToken.platform, désactivation propre si clés absentes, purge tokens invalides.
- [x] B6 email : nodemailer SMTP ou mode console.
- [x] Enregistrement des modules dans `app.module.ts`.
- [x] Specs : money.spec.ts, pagination.spec.ts, enums/transitions.spec.ts, sms.service.spec.ts.

## État détaillé — Étape 4 (Modules métier)

### auth ✅ TERMINÉ
- [x] DTOs (otp, register, social, 2fa, kyc).
- [x] `otp.service` : TTL 5 min, hash SHA-256, rate-limit setNx, compteur de tentatives (max 3), consommation au succès.
- [x] `token.service` : access JWT court + refresh rotation avec détection de réutilisation (révocation de toute la famille), sessions Redis/Prisma.
- [x] `jwt.strategy` : refus des tokens `pending2fa`, alimente `AuthUser.sessionId`.
- [x] Social verifiers Google/Facebook/Apple : JWKS maison + convertisseur JWK→PEM DER (`jwt-id-token.util.ts`), validé RS256 positif/négatif.
- [x] `two-factor.service` : AES-256-GCM au repos, backup codes à usage unique, fenêtre TOTP ±1 pas (impl manual checkTotp — signature otplib 12.0.1 limitée à 2 args).
- [x] `auth.service` : OTP-first, social (linkOrCreate), limite de devices Redis (`sAdd(key, ttlSec, ...members)`), défi 2FA via pendingToken.
- [x] `auth.controller` : request/verify OTP, register, social, 2fa complete/refresh/logout, 2fa setup/enable/disable/recovery-codes, me, kyc upload-url/submit/documents.
- [x] KYC : `kyc.service`/`kyc.controller` (presign StorageService.buildObjectKey('kyc'), garde KYC_ALREADY_PENDING, PENDING/REVIEWING/APPROVED/REJECTED, ownership).
- [x] `auth.module` enregistré dans `app.module.ts`.
- [x] Specs : otp.service.spec.ts (10 tests).

### users ✅ TERMINÉ
- [x] DTOs : update-profile, username, settings, contact-channels.
- [x] `users.service` : profil public avec cache Redis TTL 60s + flag `viewerBlocked`, `getMe` auto-masking PII (maskPhone/maskEmail), conflits username/email/phone, blocages (auto-blocage interdit, teardown des follows réciproques), pagination keyset par curseur (listRelations/listBlocks), settings upsert, deactivate soft-delete + purge cache.
- [x] `users.controller` : /users/me (+username/settings/phone/email/delete), /users/blocks, /users/u/:username (+followers/following).
- [x] `users.module` enregistré dans `app.module.ts`.
- [x] Specs : users.service.spec.ts (17 tests). Gate : prisma validate + build + lint OK, **6 suites / 81 tests verts**.

### shops ✅ TERMINÉ
- [x] DTOs : CreateShopDto (nom, slug regex + réservés, ISO country/currency, companyName/taxId), UpdateShopDto (vitrine : logo/banner/theme/returnPolicy/openingHours).
- [x] `shops.service` : une boutique par utilisateur (ownerId unique), slug généré depuis le nom (slugify sans diacritiques) + suffixage -2/-3… jusqu'à unicité, slugs réservés rejetés ; fiche publique par slug avec cache Redis TTL 60s et projection select (taxId jamais exposé) ; update owner/staff avec invalidation cache ; setStatus (owner → CLOSED seulement, SUSPENDED/réouverture = staff) ; `requestMediaUploadUrl` via presign StorageService + CDN ; `assertSellable` (boutique ACTIVE + KYC APPROVED sinon SHOP_NOT_VERIFIED).
- [x] `shops.controller` (GET by slug @Public, /shops/mine, PATCH, status, upload-url) + `shops.module` enregistré dans `app.module.ts`.
- [x] Specs : shops.service.spec.ts (20 tests — slugify, create conflits/réservés/suffixage/défauts, cache+masking, gardes statut, assertSellable, updateByOwner).

### products ✅ TERMINÉ
- [x] DTOs : CreateProductDto (category enum Prisma, basePriceMinor entier ≥1, devise optionnelle), UpdateProductDto, SetProductStatusDto, CreateVariantDto (SKU, prix mineures, compareAt/sale, poids), AdjustStockDto (delta signé + seuil), AddMediaDto (clés 1–10, position de départ).
- [x] `products.service` : CRUD scopé propriété boutique (owner ou staff) ; création en DRAFT, devise figée sur celle de la boutique ; graphe de transitions défensif (DRAFT→ACTIVE/ARCHIVED, ACTIVE→OUT_OF_STOCK/ARCHIVED, OUT_OF_STOCK→ACTIVE/ARCHIVED, ARCHIVED définitif) ; activation exige ≥1 variante ; SKU normalisé majuscules + unicité (pré-check + P2002 race → 409) ; médias en positions séquentielles ; adjustStock upsert incrémental refusant solde disponible < réservé (OUT_OF_STOCK) ; pagination keyset par curseur (exclut soft-deleted) ; suppression logique deletedAt.
- [x] `products.controller` + `products.module` enregistrés dans `app.module.ts`.
- [x] Specs : products.service.spec.ts (19 tests — création/devise/ownership, transitions, SKU, médias, stock vs réservé, curseur, soft delete).
- Gate module : prisma validate + build + lint OK, **8 suites / 120 tests verts**.

### orders/payments ✅ TERMINÉ
- [x] `cart.service`/`orders.service` : panier → commande (CART_EMPTY, OUT_OF_STOCK, SHOP_NOT_VERIFIED), frais plateforme 2,5 % (PLATFORM_FEE_BPS) + TVA pays UE-OHADA 17,5 % (DEFAULT_VAT_BPS) sur base HT nette (subtotal − remise + livraison), coupons PERCENT/FIXED bornés avec usedCount, réservations stock (StockReservation), machine à états OrderStatus via `transitions.ts`, prix en unités mineures strictes (`money.ts`).
- [x] `payments.service` : init webflow provider, webhook idempotent (P2002/dedup signature), seuils anti-fraude, remboursements partiels/totaux avec mise à jour escrow, statuts PaymentStatus.
- [x] Controllers + modules enregistrés dans `app.module.ts`.
- [x] Specs : orders.service.spec.ts + cart.service.spec.ts + payments.service.spec.ts.

### wallet ✅ TERMINÉ
- [x] DTOs : AdjustBalanceDto, TransferWalletDto, RequestWithdrawalDto, ConvertCoinsDto, SetWalletFrozenDto, devise par défaut `XOF` (DEFAULT_WALLET_CURRENCY).
- [x] `wallet.service` : init/getOrCreate upsert `(userId, currency)` XOF par défaut + rattrapage course P2002 ; credit/debit avec garde d'atomicité `updateMany({ where: { id, balanceMinor: { gte: amount } } })` → 0 ligne touchée = INSUFFICIENT_BALANCE (AFRI-WALLET-001), y compris cours concurrentiel ; gel des écritures si flag `frozen` = WALLET_FROZEN (credit/debit/withdraw/convert/transfer) ; **idempotence** via `LedgerTransaction.idempotencyKey` (contrainte unique du schéma) + relation `WalletTransaction.ledgerTransactionId` — double soumission ⇒ transaction existante renvoyée, jamais de double débit ; retrait contrôlé contre la somme des WITHDRAW du jour vs `dailyLimitMinor` = WITHDRAWAL_LIMIT_EXCEEDED (AFRI-WALLET-002, statut PENDING) ; conversion coins→mineures via FxRate COIN→devise, repli config `COINS_PER_CURRENCY_MINOR`, arrondi entier exact ; transfert multi-devises refusé CURRENCY_MISMATCH ; historique paginé par curseur keyset `(createdAt,id desc)` ; setFrozen réservé staff.
- [x] Schéma : ajout `Wallet.frozen Boolean @default(false)` + migration hors ligne `0002_wallet_frozen` (même politique que 0001_init, application reportée faute d'instance Postgres).
- [x] `wallet.controller` (GET /wallet, GET /wallet/transactions, POST transfer/withdraw/convert, PATCH :id/frozen) + `wallet.module` enregistrés dans `app.module.ts`.
- [x] Stubs : enums `WalletTransactionType`, `LedgerDirection`, `LedgerAccountType` ajoutés à `tests/prisma-client-stub.js`, `PaymentPurpose` aligné sur le schéma réel.
- [x] Specs : wallet.service.spec.ts (31 tests — init/création idempotente + P2002 race, credit OK, debit solde insuffisant AFRI-WALLET-001, cours concurrent updateMany→count 0, double idempotencyKey → transaction existante, WALLET_FROZEN sur credit/debit/withdraw, withdrawal > dailyLimit AFRI-WALLET-002, conversion coins→money arrondie en mineures exactes, CURRENCY_MISMATCH, erreurs Prisma remontées).
- Gate module : prisma validate + build + lint OK, **12 suites / 200 tests verts**.

## Conventions

- Un fichier à la fois, build vert avant chaque commit ; gate complète : `npx prisma validate && npm run build && npm run lint && npm test`.
- `npm install` utilise `legacy-peer-deps` (voir `.npmrc`).
- Unités monétaires : entiers en unités mineures, jamais de flottants (voir `src/common/utils/money.ts`).
- Erreurs : `AppException` + codes stables `ERROR_CODES` (RFC 7807).

## PROCHAINE ACTION

**Module lives/videos** (étape 4, suite) : mêmes fichiers squelettes vides à implémenter (`src/modules/lives/*`, `src/modules/videos/*`) — vérifier `wc -c` avant d'écrire. dto → live.service (création/démarrage/fin de direct, streamKey via StorageService/presign, gift tipping débitant le wallet via `WalletService.debit` avec idempotencyKey, escrow vendeur) + video.service (upload presign, transcode queue, publication feed) → controllers → modules → enregistrement app.module.ts → specs → gate → commit. **Préalable tests** : compléter `tests/prisma-client-stub.js` si des enums manquants y figurent encore (WalletTransactionType et LedgerDirection ont été ajoutés lors du module wallet ; penser à LiveStatus/VideoStatus etc. selon le schéma). Puis chats/feed/follows/search/notifications/moderation/deliveries.

Notes :
- Les migrations `0001_init` et `0002_wallet_frozen` restent à appliquer (`prisma migrate deploy`) dès qu'une base Postgres est disponible.
- Correction faite en passant : `toMinor()` utilisait un arrondi flottant (`Math.round(x*factor*1e6)/1e6`) qui pouvait renvoyer un non-entier ; réécrit en calcul décimal exact sur chaînes (BigInt), couvert par money.spec.ts.
