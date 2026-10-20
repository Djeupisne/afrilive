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
const DevicePlatform = { FCM: 'FCM', HMS: 'HMS', APNS: 'APNS', WEB: 'WEB' };
const UserRole = { CUSTOMER: 'CUSTOMER', SELLER: 'SELLER', ADMIN: 'ADMIN' };

class PrismaClient {}

module.exports = {
  PrismaClient,
  Prisma: { Decimal: class Decimal {}, sql: () => undefined },
  OrderStatus,
  PaymentStatus,
  KycStatus,
  DevicePlatform,
  UserRole,
};
