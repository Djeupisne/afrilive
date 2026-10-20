/**
 * Stub @prisma/client pour Jest (pas de client généré requis pour les tests unitaires).
 * Les enums doivent rester synchrones avec prisma/schema.prisma.
 */
const OrderStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  RETURNED: 'RETURNED',
  REFUNDED: 'REFUNDED',
  DISPUTED: 'DISPUTED',
};

const PaymentStatus = {
  INITIATED: 'INITIATED',
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
};

const Role = {
  USER: 'USER',
  SELLER: 'SELLER',
  INFLUENCER: 'INFLUENCER',
  COMPANY: 'COMPANY',
  COURIER: 'COURIER',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  SUPPORT: 'SUPPORT',
};

const UserMode = { BUYER: 'BUYER', CREATOR: 'CREATOR', SELLER: 'SELLER' };
const KycStatus = { NONE: 'NONE', PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' };
const KycDocType = {
  ID_CARD: 'ID_CARD',
  PASSPORT: 'PASSPORT',
  SELFIE: 'SELFIE',
  PROOF_OF_ADDRESS: 'PROOF_OF_ADDRESS',
  MOBILE_MONEY_ACCOUNT: 'MOBILE_MONEY_ACCOUNT',
};
const DevicePlatform = { IOS: 'IOS', ANDROID: 'ANDROID', WEB: 'WEB' };
const AuthProvider = { PHONE: 'PHONE', EMAIL: 'EMAIL', GOOGLE: 'GOOGLE', FACEBOOK: 'FACEBOOK', APPLE: 'APPLE', TIKTOK: 'TIKTOK' };
const OtpChannel = { SMS: 'SMS', WHATSAPP: 'WHATSAPP', EMAIL: 'EMAIL' };
const UserStatus = { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', BANNED: 'BANNED', DELETED: 'DELETED' };
const Category = {
  FASHION: 'FASHION',
  BEAUTY: 'BEAUTY',
  ELECTRONICS: 'ELECTRONICS',
  FOOD: 'FOOD',
  HOME: 'HOME',
  SPORTS: 'SPORTS',
  MUSIC: 'MUSIC',
  COMEDY: 'COMEDY',
  EDUCATION: 'EDUCATION',
  NEWS: 'NEWS',
  OTHER: 'OTHER',
};
const ProductStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  SOLD_OUT: 'SOLD_OUT',
  ARCHIVED: 'ARCHIVED',
};
const MediaKind = { IMAGE: 'IMAGE', VIDEO_360: 'VIDEO_360', AR: 'AR' };
const StockReservationStatus = { HELD: 'HELD', CONFIRMED: 'CONFIRMED', RELEASED: 'RELEASED' };
const PaymentPurpose = { ORDER: 'ORDER', WALLET_TOPUP: 'WALLET_TOPUP', TIP: 'TIP', PROMOTION: 'PROMOTION' };
const PaymentMethod = {
  MOBILE_MONEY: 'MOBILE_MONEY',
  CARD: 'CARD',
  WALLET: 'WALLET',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CASH_ON_DELIVERY: 'CASH_ON_DELIVERY',
};
const PaymentProviderName = { PAYSTACK: 'PAYSTACK', FLUTTERWAVE: 'FLUTTERWAVE', ORANGE_MONEY: 'ORANGE_MONEY', MTN_MOMO: 'MTN_MOMO', WAVE: 'WAVE', MOCK: 'MOCK' };
const EscrowStatus = { HELD: 'HELD', RELEASED: 'RELEASED', REFUNDED: 'REFUNDED', DISPUTED: 'DISPUTED' };
const FraudDecision = { ALLOW: 'ALLOW', REVIEW: 'REVIEW', BLOCK: 'BLOCK' };
const WebhookStatus = { RECEIVED: 'RECEIVED', PROCESSED: 'PROCESSED', FAILED: 'FAILED', IGNORED: 'IGNORED' };

// --- Enums ajoutés pour les specs orders/payments (synchrones avec schema.prisma)
const CouponType = { PERCENT: 'PERCENT', FIXED: 'FIXED' };
const OrderSource = { FEED: 'FEED', LIVE: 'LIVE', SHOP: 'SHOP' };

// --- Enums ajoutés pour les specs wallet (synchrones avec schema.prisma)
const WalletTransactionType = {
  TOPUP: 'TOPUP',
  WITHDRAW: 'WITHDRAW',
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
  PAYMENT: 'PAYMENT',
  REFUND: 'REFUND',
  PAYOUT: 'PAYOUT',
  TIP: 'TIP',
  SALE: 'SALE',
};
const LedgerDirection = { DEBIT: 'DEBIT', CREDIT: 'CREDIT' };
const LedgerAccountType = {
  USER_WALLET: 'USER_WALLET',
  ESCROW: 'ESCROW',
  PLATFORM_REVENUE: 'PLATFORM_REVENUE',
  PROVIDER_CLEARING: 'PROVIDER_CLEARING',
  PAYOUT_CLEARING: 'PAYOUT_CLEARING',
};

// --- Enums ajoutés pour les specs videos/lives (synchrones avec schema.prisma)
const VideoStatus = {
  UPLOADING: 'UPLOADING',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  PUBLISHED: 'PUBLISHED',
  REJECTED: 'REJECTED',
  DELETED: 'DELETED',
};
const Visibility = { PUBLIC: 'PUBLIC', FOLLOWERS: 'FOLLOWERS', PRIVATE: 'PRIVATE' };
const RemixType = { DUET: 'DUET', STITCH: 'STITCH' };
const UploadStatus = { INITIATED: 'INITIATED', COMPLETED: 'COMPLETED', ABORTED: 'ABORTED', FAILED: 'FAILED' };
const LiveStatus = { SCHEDULED: 'SCHEDULED', LIVE: 'LIVE', ENDED: 'ENDED', CANCELLED: 'CANCELLED' };

class PrismaClient {}

module.exports = {
  PrismaClient,
  Prisma: { Decimal: class Decimal {}, sql: () => undefined },
  OrderStatus,
  PaymentStatus,
  Role,
  UserMode,
  KycStatus,
  KycDocType,
  DevicePlatform,
  AuthProvider,
  OtpChannel,
  UserStatus,
  Category,
  ProductStatus,
  MediaKind,
  StockReservationStatus,
  PaymentPurpose,
  PaymentMethod,
  PaymentProviderName,
  EscrowStatus,
  FraudDecision,
  WebhookStatus,
  CouponType,
  OrderSource,
  WalletTransactionType,
  LedgerDirection,
  LedgerAccountType,
  VideoStatus,
  Visibility,
  RemixType,
  UploadStatus,
  LiveStatus,
};
