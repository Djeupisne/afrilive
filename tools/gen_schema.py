# Generates backend/prisma/schema.prisma from a compact DSL
L = []
A = L.append

def enum(name, *vals):
    A("enum %s {" % name)
    for v in vals:
        A("  " + v)
    A("}")
    A("")

def model(name, fields, indexes=None, idfield=True):
    A("model %s {" % name)
    if idfield:
        A("  id String @id @default(uuid())")
        A("  createdAt DateTime @default(now())")
        A("  updatedAt DateTime @updatedAt")
    for f in fields:
        A("  " + f)
    for ix in (indexes or []):
        A("  " + ix)
    A("}")
    A("")

A('// AfriLive Market - Prisma schema (PostgreSQL 16)')
A('generator client {')
A('  provider = "prisma-client-js"')
A('}')
A('datasource db {')
A('  provider = "postgresql"')
A('  url      = env("DATABASE_URL")')
A('}')
A('')
enum('Role','USER','SELLER','INFLUENCER','COMPANY','COURIER','ADMIN','SUPER_ADMIN','SUPPORT')
enum('UserStatus','ACTIVE','SUSPENDED','BANNED','DELETED')
enum('UserMode','BUYER','CREATOR')
enum('KycStatus','NONE','PENDING','APPROVED','REJECTED')
enum('KycDocType','ID_CARD','PASSPORT','SELFIE','PROOF_OF_ADDRESS','MOBILE_MONEY_ACCOUNT')
enum('AuthProvider','PHONE','EMAIL','GOOGLE','FACEBOOK','APPLE','TIKTOK')
enum('OtpChannel','SMS','WHATSAPP','EMAIL')
enum('VideoStatus','UPLOADING','PROCESSING','READY','PUBLISHED','REJECTED','DELETED')
enum('Visibility','PUBLIC','FOLLOWERS','PRIVATE')
enum('RemixType','DUET','STITCH')
enum('Category','FASHION','BEAUTY','ELECTRONICS','FOOD','HOME','SPORTS','MUSIC','COMEDY','EDUCATION','NEWS','OTHER')
enum('OrderStatus','PENDING','PAID','SHIPPED','DELIVERED','CANCELLED','RETURNED','REFUNDED','DISPUTED')
enum('OrderSource','FEED','LIVE','SHOP')
enum('PaymentStatus','INITIATED','PENDING','SUCCEEDED','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')
enum('PaymentMethod','MOBILE_MONEY','CARD','WALLET')
enum('PaymentProviderName','ORANGE_MONEY','MTN_MOMO','MOOV_MONEY','WAVE','MPESA','FLUTTERWAVE','PAYSTACK','CINETPAY','WALLET','MOCK')
enum('PaymentPurpose','ORDER','WALLET_TOPUP','TIP','PROMOTION')
enum('EscrowStatus','HELD','RELEASED','REFUNDED','DISPUTED')
enum('PayoutStatus','PENDING','PROCESSING','PAID','FAILED')
enum('DeliveryStatus','CREATED','ASSIGNED','PICKED_UP','IN_TRANSIT','DELIVERED','FAILED','RETURNING','RETURNED')
enum('Carrier','INTERNAL','SENDY','KWIK','GIG','DHL')
enum('Urgency','STANDARD','EXPRESS','SAME_DAY')
enum('LiveStatus','SCHEDULED','LIVE','ENDED','CANCELLED')
enum('ReportTargetType','VIDEO','COMMENT','USER','PRODUCT','LIVE','MESSAGE','SHOP')
enum('ReportStatus','OPEN','REVIEWING','RESOLVED','REJECTED')
enum('ModerationSource','AUTO','REPORT')
enum('ModerationCaseStatus','PENDING','ASSIGNED','APPROVED','REMOVED','WARNED','BANNED','REJECTED')
enum('AppealStatus','OPEN','ACCEPTED','REJECTED')
enum('DecisionType','REMOVE','APPROVE','WARN','BAN')
enum('FollowStatus','ACCEPTED','PENDING')
enum('LedgerAccountType','USER_WALLET','ESCROW','PLATFORM_REVENUE','PROVIDER_CLEARING','PAYOUT_CLEARING')
enum('LedgerDirection','DEBIT','CREDIT')
enum('WalletTransactionType','TOPUP','WITHDRAW','TRANSFER_IN','TRANSFER_OUT','PAYMENT','REFUND','PAYOUT','TIP','SALE')
enum('NotificationType','FOLLOW','LIKE','COMMENT','MENTION','ORDER_STATUS','PAYMENT','DELIVERY','LIVE_STARTED','TIP','DISPUTE','MODERATION','SYSTEM','STOCK_LOW')
enum('DevicePlatform','FCM','HMS','APNS','WEB')
enum('EngagementType','VIEW','WATCH_TIME','LIKE','SHARE','COMMENT','SKIP','COMPLETE','FOLLOW','PURCHASE','LIVE_WATCH')
enum('UploadStatus','INITIATED','COMPLETED','ABORTED','FAILED')
enum('StockReservationStatus','ACTIVE','COMMITTED','RELEASED','EXPIRED')
enum('CouponType','PERCENT','FIXED')
enum('ReturnStatus','REQUESTED','APPROVED','REJECTED','COMPLETED')
enum('DisputeStatus','OPEN','UNDER_REVIEW','RESOLVED')
enum('DisputeResolution','REFUND_BUYER','RELEASE_SELLER','SPLIT')
enum('PromotionTargetType','VIDEO','LIVE','PRODUCT')
enum('PromotionStatus','PENDING','ACTIVE','COMPLETED','CANCELLED')
enum('ProductStatus','DRAFT','ACTIVE','OUT_OF_STOCK','ARCHIVED')
enum('MediaKind','IMAGE','VIDEO')
enum('CommentStatus','VISIBLE','HIDDEN','DELETED')
enum('CourierStatus','PENDING','APPROVED','SUSPENDED')
enum('DeliveryOfferStatus','PENDING','ACCEPTED','REJECTED','EXPIRED')
enum('ConversationType','DIRECT','ORDER')
enum('WebhookStatus','RECEIVED','PROCESSED','FAILED')
enum('FraudDecision','ALLOW','REVIEW','BLOCK')
A('')

model('User', [
 'phone String? @unique','email String? @unique','username String @unique','displayName String','bio String @default("")',
 'avatarUrl String?','coverUrl String?','countryCode String @default("CI")','language String @default("fr")','currency String @default("XOF")',
 'roles Role[] @default([USER])','mode UserMode @default(BUYER)','isVerified Boolean @default(false)','kycStatus KycStatus @default(NONE)',
 'status UserStatus @default(ACTIVE)','birthYear Int?','strikes Int @default(0)','dailyLimitMinutes Int?',
 'followersCount Int @default(0)','followingCount Int @default(0)','videosCount Int @default(0)','salesCount Int @default(0)',
 'ratingAvg Float @default(0)','ratingCount Int @default(0)','deletedAt DateTime?',
 'authIdentities AuthIdentity[]','sessions Session[]','twoFactor TwoFactorSecret?','kycDocuments KycDocument[]','settings UserSettings?',
 'followers Follow[] @relation("follower")','following Follow[] @relation("following")',
 'blocksGiven Block[] @relation("blocker")','blocksReceived Block[] @relation("blocked")',
 'closeFriendsGiven CloseFriend[] @relation("cfOwner")','closeFriendsRecvd CloseFriend[] @relation("cfFriend")',
 'videos Video[]','sounds Sound[]','videoMentions VideoMention[]','comments Comment[]','commentLikes CommentLike[]','videoLikes VideoLike[]','favorites Favorite[]','shares Share[]',
 'uploadSessions UploadSession[]','engagementEvents EngagementEvent[]','userInterests UserInterest[]','promotions Promotion[]',
 'reports Report[]','moderationCases ModerationCase[] @relation("assignedModerator")','moderationDecisions ModerationDecision[]','appeals Appeal[]',
 'shop Shop?','reviews Review[]','carts Cart[]','orders Order[] @relation("buyer")','payments Payment[]','payouts Payout[]','wallets Wallet[]','ledgerAccounts LedgerAccount[]',
 'disputesOpened Dispute[] @relation("disputeOpener")','disputesResolved Dispute[] @relation("disputeResolver")',
 'liveSessions LiveSession[]','liveMessages LiveMessage[]','donationsFrom Donation[] @relation("donor")','donationsTo Donation[] @relation("recipient")',
 'liveSubscriptions LiveSubscription[] @relation("subscriber")','subscribedTo LiveSubscription[] @relation("hostSubs")',
 'courier Courier?','conversations ConversationParticipant[]','messages Message[]',
 'notifications Notification[]','deviceTokens DeviceToken[]','notificationPrefs NotificationPreference[]','auditLogs AuditLog[]',
], ['@@index([countryCode])','@@index([status])'])

model('AuthIdentity',['provider AuthProvider','providerUserId String','userId String','email String?','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],
 ['@@unique([provider, providerUserId])','@@index([userId])'])
model('OtpChallenge',['target String','channel OtpChannel','codeHash String','expiresAt DateTime','attempts Int @default(0)','consumedAt DateTime?','ip String?','userId String?'],
 ['@@index([target, createdAt])'])
model('Session',['userId String','refreshTokenHash String','familyId String','deviceId String?','deviceName String?','ip String?','userAgent String?','expiresAt DateTime','revokedAt DateTime?','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],
 ['@@index([userId])','@@index([familyId])','@@index([refreshTokenHash])'])
model('TwoFactorSecret',['userId String @unique','secretEnc String','enabledAt DateTime?','backupCodesHash String[] @default([])','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'])
model('KycDocument',['userId String','type KycDocType','fileKey String','status KycStatus @default(PENDING)','reviewedById String?','reviewNote String?','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],
 ['@@index([userId])','@@index([status])'])
model('UserSettings',['userId String @unique','isPrivate Boolean @default(false)','allowDownloads Boolean @default(true)','allowComments Boolean @default(true)','allowDuets Boolean @default(true)','quietHours Json @default("{}")','notificationPrefs Json @default("{}")','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'])

model('Follow',['followerId String','followingId String','status FollowStatus @default(ACCEPTED)','follower User @relation("follower", fields: [followerId], references: [id], onDelete: Cascade)','following User @relation("following", fields: [followingId], references: [id], onDelete: Cascade)'],
 ['@@id([followerId, followingId])','@@index([followingId, status])'], idfield=False)
model('Block',['blockerId String','blockedId String','blocker User @relation("blocker", fields: [blockerId], references: [id], onDelete: Cascade)','blocked User @relation("blocked", fields: [blockedId], references: [id], onDelete: Cascade)'],
 ['@@id([blockerId, blockedId])'], idfield=False)
model('CloseFriend',['ownerId String','friendId String','owner User @relation("cfOwner", fields: [ownerId], references: [id], onDelete: Cascade)','friend User @relation("cfFriend", fields: [friendId], references: [id], onDelete: Cascade)'],
 ['@@id([ownerId, friendId])'], idfield=False)

model('Video',['authorId String','caption String @default("")','status VideoStatus @default(UPLOADING)','visibility Visibility @default(PUBLIC)',
 'sourceKey String?','hlsKey String?','thumbnailKey String?','durationSec Int @default(0)','width Int @default(0)','height Int @default(0)',
 'soundId String?','remixOfId String?','remixType RemixType?','category Category @default(OTHER)','language String @default("fr")','countryCode String @default("CI")',
 'allowComments Boolean @default(true)','allowDuets Boolean @default(true)','allowDownload Boolean @default(true)',
 'likesCount Int @default(0)','commentsCount Int @default(0)','sharesCount Int @default(0)','viewsCount Int @default(0)','favoritesCount Int @default(0)',
 'publishedAt DateTime?','deletedAt DateTime?',
 'author User @relation(fields: [authorId], references: [id])','sound Sound? @relation(fields: [soundId], references: [id])',
 'remixOf Video? @relation("remixes", fields: [remixOfId], references: [id])','remixes Video[] @relation("remixes")',
 'products VideoProduct[]','hashtags VideoHashtag[]','mentions VideoMention[]','comments Comment[]','likes VideoLike[]','favorites Favorite[]','shares Share[]','engagements EngagementEvent[]'],
 ['@@index([status, visibility, publishedAt])','@@index([authorId])','@@index([countryCode, category])'])
model('VideoProduct',['videoId String','productId String','video Video @relation(fields: [videoId], references: [id], onDelete: Cascade)','product Product @relation(fields: [productId], references: [id], onDelete: Cascade)'],
 ['@@id([videoId, productId])'], idfield=False)
model('Sound',['title String','artist String','fileKey String','license String @default("ORIGINAL")','usageCount Int @default(0)','authorId String?','author User? @relation(fields: [authorId], references: [id])','videos Video[]'],['@@index([title])'])
model('Hashtag',['tag String @unique','usesCount Int @default(0)','videos VideoHashtag[]'])
model('VideoHashtag',['videoId String','hashtagId String','video Video @relation(fields: [videoId], references: [id], onDelete: Cascade)','hashtag Hashtag @relation(fields: [hashtagId], references: [id], onDelete: Cascade)'],
 ['@@id([videoId, hashtagId])','@@index([hashtagId])'], idfield=False)
model('VideoMention',['videoId String','userId String','video Video @relation(fields: [videoId], references: [id], onDelete: Cascade)','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@index([userId])'])
model('Comment',['videoId String','authorId String','parentId String?','text String','likesCount Int @default(0)','status CommentStatus @default(VISIBLE)',
 'video Video @relation(fields: [videoId], references: [id], onDelete: Cascade)','author User @relation(fields: [authorId], references: [id], onDelete: Cascade)',
 'parent Comment? @relation("replies", fields: [parentId], references: [id])','replies Comment[] @relation("replies")','likes CommentLike[]'],
 ['@@index([videoId, createdAt])','@@index([parentId])'])
model('CommentLike',['commentId String','userId String','comment Comment @relation(fields: [commentId], references: [id], onDelete: Cascade)','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@id([commentId, userId])'], idfield=False)
model('VideoLike',['videoId String','userId String','video Video @relation(fields: [videoId], references: [id], onDelete: Cascade)','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@id([videoId, userId])','@@index([userId])'], idfield=False)
model('Favorite',['videoId String','userId String','video Video @relation(fields: [videoId], references: [id], onDelete: Cascade)','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@id([videoId, userId])'], idfield=False)
model('Share',['videoId String','userId String','channel String @default("INTERNAL")','video Video @relation(fields: [videoId], references: [id], onDelete: Cascade)','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@index([videoId])'])
model('UploadSession',['userId String','objectKey String','uploadId String','partSize Int','totalParts Int','status UploadStatus @default(INITIATED)','videoId String?','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@index([userId, status])'])
model('EngagementEvent',['userId String','videoId String?','liveId String?','type EngagementType','valueMs Int @default(0)','countryCode String @default("CI")','user User @relation(fields: [userId], references: [id], onDelete: Cascade)','video Video? @relation(fields: [videoId], references: [id])'],['@@index([userId, createdAt])','@@index([videoId, type])'])
model('UserInterest',['userId String','category Category','score Float @default(0)','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@unique([userId, category])'])
model('Promotion',['ownerId String','targetType PromotionTargetType','targetId String','budgetMinor Int','spentMinor Int @default(0)','currency String @default("XOF")','startsAt DateTime','endsAt DateTime','status PromotionStatus @default(PENDING)','paymentId String?','owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)'],['@@index([status, startsAt, endsAt])','@@index([targetType, targetId])'])

model('Report',['reporterId String','targetType ReportTargetType','targetId String','reason String','status ReportStatus @default(OPEN)','reporter User @relation(fields: [reporterId], references: [id], onDelete: Cascade)'],
 ['@@index([targetType, targetId])','@@index([status])','@@index([reporterId])'],['@@index([targetType, targetId])','@@index([status])'])
model('ModerationCase',['targetType ReportTargetType','targetId String','source ModerationSource','score Float @default(0)','labels Json @default("[]")','status ModerationCaseStatus @default(PENDING)','assignedToId String?','assignedTo User? @relation("assignedModerator", fields: [assignedToId], references: [id])','decisions ModerationDecision[]','appeals Appeal[]'],['@@index([status, createdAt])','@@index([targetType, targetId])'])
model('ModerationDecision',['caseId String','moderatorId String','decision DecisionType','note String?','case ModerationCase @relation(fields: [caseId], references: [id], onDelete: Cascade)','moderator User @relation(fields: [moderatorId], references: [id])'],['@@index([caseId])'])
model('BannedTerm',['term String','severity Int @default(1)','language String @default("fr")'],['@@unique([term, language])'])
model('Appeal',['caseId String','userId String','text String','status AppealStatus @default(OPEN)','case ModerationCase @relation(fields: [caseId], references: [id], onDelete: Cascade)','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@index([status])'])

model('Shop',['ownerId String @unique','name String','slug String @unique','description String @default("")','logoUrl String?','bannerUrl String?','theme Json @default("{}")','countryCode String @default("CI")','currency String @default("XOF")','companyName String?','taxId String?','returnPolicy String @default("14 jours")','openingHours Json @default("{}")','status String @default("ACTIVE")','ratingAvg Float @default(0)','ratingCount Int @default(0)','owner User @relation(fields: [ownerId], references: [id])','warehouses Warehouse[]','products Product[]','orders Order[]','coupons Coupon[]','liveSessions LiveSession[]'],['@@index([countryCode])'])
model('Warehouse',['shopId String','name String','address Json @default("{}")','countryCode String @default("CI")','lat Float?','lng Float?','shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)','stocks StockItem[]'],['@@index([shopId])'])
model('Product',['shopId String','title String','description String @default("")','category Category @default(OTHER)','status ProductStatus @default(DRAFT)','currency String @default("XOF")','basePriceMinor Int','ratingAvg Float @default(0)','ratingCount Int @default(0)','soldCount Int @default(0)','deletedAt DateTime?','shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)','media ProductMedia[]','variants ProductVariant[]','reviews Review[]','liveProducts LiveProduct[]','videoProducts VideoProduct[]'],['@@index([shopId, status])','@@index([category, status])'])
model('ProductMedia',['productId String','type MediaKind @default(IMAGE)','key String','position Int @default(0)','product Product @relation(fields: [productId], references: [id], onDelete: Cascade)'],['@@index([productId])'])
model('ProductVariant',['productId String','sku String @unique','attributes Json @default("{}")','priceMinor Int','compareAtPriceMinor Int?','salePriceMinor Int?','saleStartsAt DateTime?','saleEndsAt DateTime?','weightGrams Int @default(500)','unit String @default("piece")','product Product @relation(fields: [productId], references: [id], onDelete: Cascade)','stockItems StockItem[]','reservations StockReservation[]','orderItems OrderItem[]','cartItems CartItem[]','liveProducts LiveProduct[]'],['@@index([productId])'])
model('StockItem',['variantId String','warehouseId String','quantity Int @default(0)','reserved Int @default(0)','lowStockThreshold Int @default(5)','variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)','warehouse Warehouse @relation(fields: [warehouseId], references: [id], onDelete: Cascade)'],['@@unique([variantId, warehouseId])'])
model('StockReservation',['variantId String','warehouseId String','quantity Int','orderId String?','liveId String?','expiresAt DateTime','status StockReservationStatus @default(ACTIVE)','variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)'],['@@index([variantId, status])','@@index([orderId])','@@index([expiresAt, status])'])
model('Review',['productId String','orderItemId String @unique','authorId String','rating Int','text String @default("")','photos Json @default("[]")','sellerReply String?','product Product @relation(fields: [productId], references: [id], onDelete: Cascade)','author User @relation(fields: [authorId], references: [id], onDelete: Cascade)','orderItem OrderItem @relation(fields: [orderItemId], references: [id], onDelete: Cascade)'],['@@index([productId])'])
model('Coupon',['shopId String','code String','type CouponType','value Int','minOrderMinor Int @default(0)','maxUses Int?','usedCount Int @default(0)','startsAt DateTime','endsAt DateTime','active Boolean @default(true)','shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)','orders Order[]'],['@@unique([shopId, code])'])
model('Cart',['userId String @unique','currency String @default("XOF")','user User @relation(fields: [userId], references: [id], onDelete: Cascade)','items CartItem[]'])
model('CartItem',['cartId String','variantId String','quantity Int @default(1)','cart Cart @relation(fields: [cartId], references: [id], onDelete: Cascade)','variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)'],['@@unique([cartId, variantId])'])
model('Order',['number String @unique','buyerId String','shopId String','status OrderStatus @default(PENDING)','currency String @default("XOF")','subtotalMinor Int','shippingMinor Int @default(0)','discountMinor Int @default(0)','feeMinor Int @default(0)','taxMinor Int @default(0)','totalMinor Int','couponId String?','shippingAddress Json','countryCode String @default("CI")','source OrderSource @default(SHOP)','liveSessionId String?','idempotencyKey String? @unique','checkoutGroupId String?','expiresAt DateTime?','declaredValueMinor Int?','buyer User @relation("buyer", fields: [buyerId], references: [id])','shop Shop @relation(fields: [shopId], references: [id])','coupon Coupon? @relation(fields: [couponId], references: [id])','items OrderItem[]','history OrderStatusHistory[]','payments Payment[]','escrow EscrowHold?','delivery Delivery?','returns ReturnRequest[]','invoice Invoice?','disputes Dispute[]'],
 ['@@index([buyerId, status])','@@index([shopId, status])','@@index([checkoutGroupId])','@@index([status, expiresAt])'])
model('OrderItem',['orderId String','variantId String','titleSnapshot String','unitPriceMinor Int','quantity Int','order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)','variant ProductVariant @relation(fields: [variantId], references: [id])','review Review?'],['@@index([orderId])'])
model('OrderStatusHistory',['orderId String','status OrderStatus','note String?','actorId String?','order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)'],['@@index([orderId])'])
model('ReturnRequest',['orderId String','reason String','status ReturnStatus @default(REQUESTED)','resolution String?','order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)'],['@@index([status])'])
model('Invoice',['orderId String @unique','number String @unique','taxMinor Int','pdfKey String?','order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)'])

model('Payment',['userId String','orderId String?','purpose PaymentPurpose','provider PaymentProviderName','method PaymentMethod','status PaymentStatus @default(INITIATED)','amountMinor Int','feeMinor Int @default(0)','currency String @default("XOF")','providerRef String?','idempotencyKey String? @unique','phone String?','countryCode String @default("CI")','fraudScore Float @default(0)','fraudDecision FraudDecision @default(ALLOW)','metadata Json @default("{}")','succeededAt DateTime?','user User @relation(fields: [userId], references: [id])','order Order? @relation(fields: [orderId], references: [id])','attempts PaymentAttempt[]','refunds Refund[]','escrows EscrowHold[]','donations Donation[]','walletTransactions WalletTransaction[]'],
 ['@@index([userId, status])','@@index([orderId])','@@index([status, createdAt])'])
model('PaymentAttempt',['paymentId String','provider PaymentProviderName','status PaymentStatus','response Json @default("{}")','payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)'],['@@index([paymentId])'])
model('WebhookEvent',['provider PaymentProviderName','eventId String','signatureValid Boolean','payload Json','status WebhookStatus @default(RECEIVED)','attempts Int @default(0)','processedAt DateTime?'],['@@unique([provider, eventId])','@@index([status])'])
model('Refund',['paymentId String','amountMinor Int','reason String','status PaymentStatus @default(INITIATED)','providerRef String?','payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)'],['@@index([paymentId])'])
model('EscrowHold',['orderId String @unique','paymentId String','amountMinor Int','currency String','status EscrowStatus @default(HELD)','releaseAt DateTime?','releasedAt DateTime?','order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)','payment Payment @relation(fields: [paymentId], references: [id])'],['@@index([status, releaseAt])'])
model('Dispute',['orderId String','openedById String','reason String','evidence Json @default("[]")','status DisputeStatus @default(OPEN)','resolution DisputeResolution?','resolvedById String?','refundAmountMinor Int?','releaseAmountMinor Int?','order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)','openedBy User @relation("disputeOpener", fields: [openedById], references: [id])','resolvedBy User? @relation("disputeResolver", fields: [resolvedById], references: [id])'],['@@index([status])'])
model('Payout',['ownerId String','amountMinor Int','feeMinor Int @default(0)','currency String','method PaymentProviderName','destination Json','status PayoutStatus @default(PENDING)','batchId String?','providerRef String?','idempotencyKey String @unique','owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)'],['@@index([status])','@@index([ownerId])'])
model('Wallet',['userId String','currency String','balanceMinor Int @default(0)','dailyLimitMinor Int @default(50000000)','user User @relation(fields: [userId], references: [id], onDelete: Cascade)','transactions WalletTransaction[]','ledgerAccount LedgerAccount?'],['@@unique([userId, currency])'])
model('LedgerAccount',['type LedgerAccountType','ownerId String?','currency String','walletId String? @unique','owner User? @relation(fields: [ownerId], references: [id])','wallet Wallet? @relation(fields: [walletId], references: [id])','entries LedgerEntry[]'],['@@index([type, currency])','@@index([type, ownerId])'])
model('LedgerTransaction',['type String','refType String?','refId String?','idempotencyKey String @unique','entries LedgerEntry[]','walletTx WalletTransaction[]'],['@@index([refType, refId])'])
model('LedgerEntry',['transactionId String','accountId String','direction LedgerDirection','amountMinor Int','currency String','transaction LedgerTransaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)','account LedgerAccount @relation(fields: [accountId], references: [id])'],['@@index([accountId])'])
model('WalletTransaction',['walletId String','type WalletTransactionType','amountMinor Int','balanceAfterMinor Int','ledgerTransactionId String?','paymentId String?','status PaymentStatus @default(SUCCEEDED)','note String?','wallet Wallet @relation(fields: [walletId], references: [id], onDelete: Cascade)','ledgerTransaction LedgerTransaction? @relation(fields: [ledgerTransactionId], references: [id])','payment Payment? @relation(fields: [paymentId], references: [id])'],['@@index([walletId, createdAt])'])
model('FxRate',['base String','quote String','rate Float','asOf DateTime'],['@@unique([base, quote])'])

model('LiveSession',['hostId String','shopId String?','title String','status LiveStatus @default(SCHEDULED)','roomName String @unique','scheduledAt DateTime?','startedAt DateTime?','endedAt DateTime?','recordingKey String?','peakViewers Int @default(0)','totalViewers Int @default(0)','ordersCount Int @default(0)','revenueMinor Int @default(0)','allowTips Boolean @default(true)','category Category @default(OTHER)','countryCode String @default("CI")','host User @relation(fields: [hostId], references: [id])','shop Shop? @relation(fields: [shopId], references: [id])','products LiveProduct[]','messages LiveMessage[]','donations Donation[]'],['@@index([status, startedAt])','@@index([countryCode, status])'])
model('LiveProduct',['liveId String','productId String','variantId String?','position Int @default(0)','isPinned Boolean @default(false)','livePriceMinor Int?','flashEndsAt DateTime?','stockLimit Int?','soldInLive Int @default(0)','live LiveSession @relation(fields: [liveId], references: [id], onDelete: Cascade)','product Product @relation(fields: [productId], references: [id])','variant ProductVariant? @relation(fields: [variantId], references: [id])'],['@@index([liveId])'])
model('LiveMessage',['liveId String','userId String','text String','pinned Boolean @default(false)','live LiveSession @relation(fields: [liveId], references: [id], onDelete: Cascade)','user User @relation(fields: [userId], references: [id])'],['@@index([liveId, createdAt])'])
model('Donation',['liveId String','fromUserId String','toUserId String','amountMinor Int','currency String','paymentId String?','message String @default("")','live LiveSession @relation(fields: [liveId], references: [id], onDelete: Cascade)','from User @relation("donor", fields: [fromUserId], references: [id])','to User @relation("recipient", fields: [toUserId], references: [id])','payment Payment? @relation(fields: [paymentId], references: [id])'],['@@index([liveId])'])
model('LiveSubscription',['userId String','hostId String','user User @relation("subscriber", fields: [userId], references: [id], onDelete: Cascade)','host User @relation("hostSubs", fields: [hostId], references: [id], onDelete: Cascade)'],['@@id([userId, hostId])'], idfield=False)

model('Courier',['userId String @unique','status CourierStatus @default(PENDING)','vehicleType String @default("moto")','isOnline Boolean @default(false)','lat Float?','lng Float?','lastSeenAt DateTime?','ratingAvg Float @default(0)','acceptanceRate Float @default(1)','deliveriesDone Int @default(0)','user User @relation(fields: [userId], references: [id], onDelete: Cascade)','zones CourierZone[]','deliveries Delivery[] @relation("courierDeliveries")','deliveryOffers DeliveryOffer[] @relation("courierOffers")'],['@@index([status, isOnline])'])
model('DeliveryZone',['countryCode String','city String','name String','polygon Json @default("[]")','baseFeeMinor Int','perKmMinor Int @default(50)','perKgMinor Int @default(100)','currency String @default("XOF")','crossBorderSurchargeMinor Int @default(0)','couriers CourierZone[]'],['@@index([countryCode, city])'])
model('CourierZone',['courierId String','zoneId String','courier Courier @relation(fields: [courierId], references: [id], onDelete: Cascade)','zone DeliveryZone @relation(fields: [zoneId], references: [id], onDelete: Cascade)'],['@@id([courierId, zoneId])'], idfield=False)
model('Delivery',['orderId String @unique','courierId String?','carrier Carrier @default(INTERNAL)','carrierRef String?','status DeliveryStatus @default(CREATED)','pickup Json @default("{}")','dropoff Json @default("{}")','distanceKm Float @default(0)','weightKg Float @default(1)','urgency Urgency @default(STANDARD)','feeMinor Int @default(0)','currency String @default("XOF")','isCrossBorder Boolean @default(false)','customs Json?','insured Boolean @default(false)','insuranceFeeMinor Int @default(0)','otpHash String?','proofPhotoKey String?','signatureKey String?','deliveredAt DateTime?','order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)','courier Courier? @relation("courierDeliveries", fields: [courierId], references: [id])','events DeliveryEvent[]','offers DeliveryOffer[]'],['@@index([courierId, status])','@@index([status])'])
model('DeliveryEvent',['deliveryId String','status DeliveryStatus','lat Float?','lng Float?','note String?','at DateTime @default(now())','delivery Delivery @relation(fields: [deliveryId], references: [id], onDelete: Cascade)'],['@@index([deliveryId, at])'])
model('DeliveryOffer',['deliveryId String','courierId String','status DeliveryOfferStatus @default(PENDING)','expiresAt DateTime','delivery Delivery @relation(fields: [deliveryId], references: [id], onDelete: Cascade)','courierRef Courier @relation("courierOffers", fields: [courierId], references: [id])'],['@@index([deliveryId])','@@index([courierId, status])'])

model('Conversation',['type ConversationType @default(DIRECT)','orderId String?','participants ConversationParticipant[]','messages Message[]'],['@@index([orderId])'])
model('ConversationParticipant',['conversationId String','userId String','lastReadAt DateTime @default(now())','conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@id([conversationId, userId])','@@index([userId])'], idfield=False)
model('Message',['conversationId String','senderId String','text String @default("")','mediaKey String?','conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)','sender User @relation(fields: [senderId], references: [id])'],['@@index([conversationId, createdAt])'])
model('Notification',['userId String','type NotificationType','title String','body String','data Json @default("{}")','readAt DateTime?','dedupeKey String?','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@index([userId, createdAt])','@@index([userId, readAt])'])
model('DeviceToken',['userId String','token String @unique','platform DevicePlatform','locale String @default("fr")','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@index([userId])'])
model('NotificationPreference',['userId String','type NotificationType','push Boolean @default(true)','sms Boolean @default(false)','email Boolean @default(true)','inApp Boolean @default(true)','user User @relation(fields: [userId], references: [id], onDelete: Cascade)'],['@@unique([userId, type])'])
model('NotificationTemplate',['key String','locale String','title String','body String','channels String[] @default(["inapp","push"])'],['@@unique([key, locale])'])
model('AuditLog',['actorId String?','action String','targetType String','targetId String','ip String?','meta Json @default("{}")','actor User? @relation(fields: [actorId], references: [id])'],['@@index([targetType, targetId])','@@index([action, createdAt])','@@index([actorId])'])

open('/workspace/backend/prisma/schema.prisma','w').write("\n".join(L)+"\n")
print("models:", sum(1 for x in L if x.startswith("model ")))
