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

const KycStatus = { NONE: 'NONE', PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' };
const KycDocType = {
  ID_CARD: 'ID_CARD',
  PASSPORT: 'PASSPORT',
  SELFIE: 'SELFIE',
  PROOF_OF_ADDRESS: 'PROOF_OF_ADDRESS',
  MOBILE_MONEY_ACCOUNT: 'MOBILE_MONEY_ACCOUNT',
};
const DevicePlatform = { FCM: 'FCM', HMS: 'HMS', APNS: 'APNS', WEB: 'WEB' };
const UserRole = { CUSTOMER: 'CUSTOMER', SELLER: 'SELLER', ADMIN: 'ADMIN' };
const AuthProvider = { PHONE: 'PHONE', EMAIL: 'EMAIL', GOOGLE: 'GOOGLE', FACEBOOK: 'FACEBOOK', APPLE: 'APPLE', TIKTOK: 'TIKTOK' };
const OtpChannel = { SMS: 'SMS', WHATSAPP: 'WHATSAPP', EMAIL: 'EMAIL' };
const UserStatus = { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', BANNED: 'BANNED', DELETED: 'DELETED' };

class PrismaClient {}

module.exports = {
  PrismaClient,
  Prisma: { Decimal: class Decimal {}, sql: () => undefined },
  OrderStatus,
  PaymentStatus,
  KycStatus,
  KycDocType,
  DevicePlatform,
  UserRole,
  AuthProvider,
  OtpChannel,
  UserStatus,
};
