import {
  FraudDecision,
  OrderStatus,
  PaymentPurpose,
  PaymentProviderName,
  PaymentStatus,
  WebhookStatus,
} from '@prisma/client';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { encodeCursor } from '../../common/utils/pagination';
import { PaymentsService } from './payments.service';
import type { InitiatePaymentDto, RefundPaymentDto } from './dto/payment.dto';

/**
 * Spec unitaire Paiements : machine à états PAYMENT_TRANSITIONS, idempotence
 * (contrainte unique + course), anti-fraude, webhooks signature-first et
 * remboursements partiels/total. PrismaService / OrdersService / ConfigService
 * sont mockés directement (aucun TestBed).
 */
const BUYER = { id: 'u-buyer', role: 'USER' };
const STAFF = { id: 'u-admin', role: 'ADMIN' };

function makeMocks() {
  const tx = {
    payment: { update: jest.fn() },
    paymentAttempt: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    paymentAttempt: { create: jest.fn() },
    payment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    order: { findUnique: jest.fn() },
    escrowHold: { upsert: jest.fn(), updateMany: jest.fn() },
    refund: { create: jest.fn(), aggregate: jest.fn() },
    webhookEvent: { create: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  };
  const orders = { markPaid: jest.fn() };
  const config = { get: jest.fn(() => 1_000_000) }; // seuil fraude : 1 000 000 mineurs
  const service = new PaymentsService(prisma as never, orders as never, config as never);
  return { prisma, tx, orders, config, service };
}

const payRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'pay-1',
  userId: 'u-buyer',
  orderId: 'o-1',
  purpose: PaymentPurpose.ORDER,
  provider: PaymentProviderName.MOCK,
  method: 'MOBILE_MONEY' as never,
  status: PaymentStatus.INITIATED,
  amountMinor: 12_500,
  currency: 'XOF',
  countryCode: 'CI',
  fraudScore: 0,
  fraudDecision: FraudDecision.ALLOW,
  idempotencyKey: 'key-1',
  providerRef: null,
  ...overrides,
});

const initDto = (extra: Partial<InitiatePaymentDto> = {}): InitiatePaymentDto =>
  ({
    purpose: PaymentPurpose.ORDER,
    orderId: 'o-1',
    provider: PaymentProviderName.MOCK,
    method: 'MOBILE_MONEY' as never,
    idempotencyKey: 'key-1',
    ...extra,
  }) as InitiatePaymentDto;

const pendingOrder = { id: 'o-1', buyerId: 'u-buyer', status: OrderStatus.PENDING, totalMinor: 12_500, currency: 'XOF', expiresAt: null };

describe('PaymentsService.initiate', () => {
  it('purpose ORDER sans orderId → VALIDATION_FAILED', async () => {
    const { service } = makeMocks();
    await expect(service.initiate(BUYER, initDto({ orderId: undefined }))).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it('commande d’un autre utilisateur → NOT_FOUND (anti-énumération)', async () => {
    const { prisma, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue({ ...pendingOrder, buyerId: 'u-victim' });
    await expect(service.initiate(BUYER, initDto())).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('commande déjà payée → ORDER_NOT_PAYABLE', async () => {
    const { prisma, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue({ ...pendingOrder, status: OrderStatus.PAID });
    await expect(service.initiate(BUYER, initDto())).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_NOT_PAYABLE,
    });
  });

  it('délai de paiement expiré → ORDER_EXPIRED', async () => {
    const { prisma, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue({ ...pendingOrder, expiresAt: new Date(Date.now() - 1000) });
    await expect(service.initiate(BUYER, initDto())).rejects.toMatchObject({
      code: ERROR_CODES.ORDER_EXPIRED,
    });
  });

  it('clé d’idempotence réutilisée par le même user → paiement existant renvoyé (pas de double débit)', async () => {
    const { prisma, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue(pendingOrder);
    const existing = payRow({ id: 'pay-existing' });
    prisma.payment.findUnique.mockResolvedValue(existing);
    const res = await service.initiate(BUYER, initDto());
    expect(res).toBe(existing);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('clé d’idempotence volée par un autre user → IDEMPOTENCY_CONFLICT', async () => {
    const { prisma, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue(pendingOrder);
    prisma.payment.findUnique.mockResolvedValue(payRow({ userId: 'u-mallory' }));
    await expect(service.initiate(BUYER, initDto())).rejects.toMatchObject({
      code: ERROR_CODES.IDEMPOTENCY_CONFLICT,
    });
  });

  it('provider non intégré → PAYMENT_PROVIDER_UNAVAILABLE', async () => {
    const { prisma, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue(pendingOrder);
    prisma.payment.findUnique.mockResolvedValue(null); // pas de doublon
    const created = payRow({ provider: PaymentProviderName.ORANGE_MONEY });
    prisma.payment.create.mockResolvedValue(created);
    prisma.payment.findUnique.mockResolvedValue(null); // relecture finale
    await expect(
      service.initiate(BUYER, initDto({ provider: PaymentProviderName.ORANGE_MONEY })),
    ).rejects.toMatchObject({ code: ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE });
  });

  it('course idempotente (P2002) : le doublon créé entre-temps est récupéré', async () => {
    const { prisma, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue(pendingOrder);
    const dup = payRow({ id: 'pay-race' });
    // Le service relit le doublon par sa cle d'idempotence (contrainte unique).
    prisma.payment.findUnique.mockImplementation((args: { where?: Record<string, unknown> }) =>
      args?.where?.idempotencyKey ? Promise.resolve(dup) : Promise.resolve(null),
    );
    const err = Object.assign(new Error('unique'), { code: 'P2002' });
    prisma.payment.create.mockRejectedValueOnce(err);
    const res = await service.initiate(BUYER, initDto());
    expect(res).toEqual(dup);
    // La passerelle MOCK n'est pas rejouée sur un paiement déjà existant.
    expect(prisma.paymentAttempt.create).not.toHaveBeenCalled();
  });

  it('montant >= seuil → bloqué par l’anti-fraude (BLOCK)', async () => {
    const { prisma, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue({ ...pendingOrder, totalMinor: 2_000_000 });
    await expect(service.initiate(BUYER, initDto())).rejects.toMatchObject({
      code: ERROR_CODES.PAYMENT_FAILED,
    });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('MOCK : succès immédiat → SUCCEEDED + commande marquée payée + escrow HELD', async () => {
    const { prisma, tx, orders, service } = makeMocks();
    prisma.order.findUnique.mockResolvedValue(pendingOrder);
    prisma.payment.findUnique.mockResolvedValue(null);
    const created = payRow();
    prisma.payment.create.mockResolvedValue(created);
    // Fake « base de données » à état : findUnique/update selon where.id.
    const db: Record<string, Record<string, unknown>> = { 'pay-1': { ...created } };
    prisma.payment.findUnique.mockImplementation((args: { where?: { id?: string } }) =>
      Promise.resolve(args?.where?.id ? db[args.where.id] ?? null : null),
    );
    const applyUpdate = (args: { where: { id: string }; data: Record<string, unknown> }) => {
      db[args.where.id] = { ...db[args.where.id], ...args.data };
      return Promise.resolve(db[args.where.id]);
    };
    prisma.payment.update.mockImplementation(applyUpdate);
    tx.payment.update.mockImplementation(applyUpdate); // le markSucceeded passe par $transaction
    prisma.order.findUnique.mockImplementation((args: { where?: { id?: string } }) =>
      args?.where?.id === 'o-1' ? Promise.resolve({ ...pendingOrder, subtotalMinor: 12_500, discountMinor: 0 }) : Promise.resolve(null),
    );
    const res = await service.initiate(BUYER, initDto());
    expect(res?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(orders.markPaid).toHaveBeenCalledWith('o-1', 'u-buyer');
    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: PaymentStatus.SUCCEEDED }) }),
    );
    expect(prisma.escrowHold.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: 'HELD' }) }),
    );
  });
});

describe('PaymentsService.confirm / fail', () => {
  it('paiement inexistant → NOT_FOUND', async () => {
    const { prisma, service } = makeMocks();
    prisma.payment.findUnique.mockResolvedValue(null);
    await expect(service.confirm('nope', { providerRef: 'ref' } as never)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('confirmation d’un paiement d’autrui (non staff) → NOT_FOUND', async () => {
    const { prisma, service } = makeMocks();
    prisma.payment.findUnique.mockResolvedValue(payRow({ userId: 'u-other' }));
    await expect(service.confirm('pay-1', { providerRef: 'ref' } as never, BUYER)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('déjà SUCCEEDED → idempotent, aucun update', async () => {
    const { prisma, service } = makeMocks();
    const done = payRow({ status: PaymentStatus.SUCCEEDED });
    prisma.payment.findUnique.mockResolvedValue(done);
    const res = await service.confirm('pay-1', { providerRef: 'ref' } as never);
    expect(res).toBe(done);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('PENDING → confirm → SUCCEEDED avec markPaid', async () => {
    const { prisma, tx, orders, service } = makeMocks();
    const row = payRow({ status: PaymentStatus.PENDING });
    const db: Record<string, Record<string, unknown>> = { 'pay-1': { ...row } };
    prisma.payment.findUnique.mockImplementation((args: { where?: { id?: string } }) =>
      Promise.resolve(args?.where?.id ? db[args.where.id] ?? null : null),
    );
    prisma.payment.update.mockImplementation((args: { where: { id: string }; data: Record<string, unknown> }) => {
      db[args.where.id] = { ...db[args.where.id], ...args.data };
      return Promise.resolve(db[args.where.id]);
    });
    await service.confirm('pay-1', { providerRef: 'OP-9' } as never);
    expect(tx.payment.update).toHaveBeenCalled();
    expect(orders.markPaid).toHaveBeenCalledWith('o-1', 'u-buyer');
  });

  it('REFUNDED → échec impossible (transition interdite)', async () => {
    const { prisma, service } = makeMocks();
    prisma.payment.findUnique.mockResolvedValue(payRow({ status: PaymentStatus.REFUNDED }));
    await expect(service.fail('pay-1', 'test')).rejects.toMatchObject({ code: ERROR_CODES.PAYMENT_FAILED });
  });
});

describe('PaymentsService.handleWebhook', () => {
  it('signature invalide → événement FAILED + PAYMENT_FAILED, aucun traitement', async () => {
    const { prisma, service } = makeMocks();
    await expect(service.handleWebhook(PaymentProviderName.MOCK, 'evt-1', false, { status: 'succeeded' })).rejects.toMatchObject({
      code: ERROR_CODES.PAYMENT_FAILED,
    });
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ signatureValid: false, status: WebhookStatus.FAILED }) }),
    );
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('événement déjà traité → duplicate:true (dédup)', async () => {
    const { prisma, service } = makeMocks();
    prisma.webhookEvent.upsert.mockResolvedValue({ id: 'wh-1', processedAt: new Date() });
    await expect(service.handleWebhook(PaymentProviderName.MOCK, 'evt-1', true, { status: 'succeeded' })).resolves.toEqual({
      duplicate: true,
    });
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('webhook succeeded → markSucceeded + événement PROCESSED', async () => {
    const { prisma, service } = makeMocks();
    prisma.webhookEvent.upsert.mockResolvedValue({ id: 'wh-1', processedAt: null });
    prisma.payment.findFirst.mockResolvedValue(payRow({ status: PaymentStatus.PENDING }));
    prisma.payment.findUnique
      .mockResolvedValueOnce(payRow({ status: PaymentStatus.PENDING }))
      .mockResolvedValueOnce(payRow({ status: PaymentStatus.SUCCEEDED }))
      .mockResolvedValue({ ...pendingOrder, subtotalMinor: 12_500, discountMinor: 0 });
    const res = await service.handleWebhook(PaymentProviderName.ORANGE_MONEY, 'evt-2', true, {
      paymentId: 'pay-1',
      status: 'succeeded',
      providerRef: 'OM-77',
    });
    expect(res).toEqual({ paymentId: 'pay-1', handled: true });
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: WebhookStatus.PROCESSED }) }),
    );
  });

  it('webhook failed → paiement FAILED', async () => {
    const { prisma, service } = makeMocks();
    prisma.webhookEvent.upsert.mockResolvedValue({ id: 'wh-2', processedAt: null });
    prisma.payment.findFirst.mockResolvedValue(payRow({ status: PaymentStatus.PENDING }));
    prisma.payment.findUnique.mockResolvedValue(payRow({ status: PaymentStatus.PENDING }));
    prisma.payment.update.mockResolvedValue(payRow({ status: PaymentStatus.FAILED }));
    const res = await service.handleWebhook(PaymentProviderName.ORANGE_MONEY, 'evt-3', true, {
      paymentId: 'pay-1',
      status: 'failed',
    });
    expect(res).toEqual({ paymentId: 'pay-1', handled: true });
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: PaymentStatus.FAILED }) }),
    );
  });
});

describe('PaymentsService.refund', () => {
  const refundDto = (extra: Partial<RefundPaymentDto> = {}): RefundPaymentDto =>
    ({ reason: 'produit cassé', ...extra }) as RefundPaymentDto;

  it('paiement non remboursable (INITIATED) → PAYMENT_FAILED', async () => {
    const { prisma, service } = makeMocks();
    prisma.payment.findUnique.mockResolvedValue(payRow({ status: PaymentStatus.INITIATED }));
    await expect(service.refund('pay-1', refundDto(), STAFF)).rejects.toMatchObject({ code: ERROR_CODES.PAYMENT_FAILED });
  });

  it('trop-remboursé refusé (cumul > montant payé)', async () => {
    const { prisma, service } = makeMocks();
    prisma.payment.findUnique.mockResolvedValue(payRow({ status: PaymentStatus.PARTIALLY_REFUNDED, amountMinor: 10_000 }));
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amountMinor: 6_000 } });
    await expect(service.refund('pay-1', refundDto({ amountMinor: 5_000 }), STAFF)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it('partiel : cumul < payé → PARTIALLY_REFUNDED', async () => {
    const { prisma, service } = makeMocks();
    prisma.payment.findUnique.mockResolvedValue(payRow({ status: PaymentStatus.SUCCEEDED, amountMinor: 10_000 }));
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amountMinor: 0 } });
    prisma.refund.create.mockResolvedValue({ id: 'rf-1' });
    const res = await service.refund('pay-1', refundDto({ amountMinor: 4_000 }), STAFF);
    expect(res).toEqual({ id: 'rf-1' });
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: PaymentStatus.PARTIALLY_REFUNDED } }),
    );
    expect(prisma.escrowHold.updateMany).not.toHaveBeenCalled();
  });

  it('total → REFUNDED + escrow HELD basculé REFUNDED', async () => {
    const { prisma, service } = makeMocks();
    prisma.payment.findUnique.mockResolvedValue(payRow({ status: PaymentStatus.SUCCEEDED, amountMinor: 10_000 }));
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amountMinor: 0 } });
    prisma.refund.create.mockResolvedValue({ id: 'rf-2' });
    await service.refund('pay-1', refundDto({ amountMinor: 10_000 }), STAFF);
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: PaymentStatus.REFUNDED } }),
    );
    expect(prisma.escrowHold.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orderId: 'o-1' }), data: { status: 'REFUNDED' } }),
    );
  });

  it('demandeur non staff et non propriétaire → NOT_FOUND', async () => {
    const { prisma, service } = makeMocks();
    prisma.payment.findUnique.mockResolvedValue(payRow({ userId: 'u-someone-else' }));
    await expect(service.refund('pay-1', refundDto(), BUYER)).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});

describe('PaymentsService.listMine', () => {
  it('curseur keyset sur id desc + page tronquée', async () => {
    const { prisma, service } = makeMocks();
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: `pay-${i}` }));
    prisma.payment.findMany.mockResolvedValue(rows);
    const page = await service.listMine({ limit: 3, cursor: undefined }, BUYER);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBe(encodeCursor({ id: 'pay-2' }));
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u-buyer' }), take: 4 }),
    );
  });
});
