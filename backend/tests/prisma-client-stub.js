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
const DevicePlatform = { FCM: 'FCM', HMS: 'HMS', APNS: 'APNS', WEB: 'WEB' };
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
const ProductStatus = { DRAFT: 'DRAFT', ACTIVE: 'ACTIVE', OUT_OF_STOCK: 'OUT_OF_STOCK', ARCHIVED: 'ARCHIVED' };
const MediaKind = { IMAGE: 'IMAGE', VIDEO: 'VIDEO' };
const StockReservationStatus = { ACTIVE: 'ACTIVE', COMMITTED: 'COMMITTED', RELEASED: 'RELEASED', EXPIRED: 'EXPIRED' };

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
};
