import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EscrowStatus,
  FraudDecision,
  OrderStatus,
  PaymentPurpose,
  PaymentProviderName,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { canTransitionPayment } from '../../common/enums/payment-status.enum';
import { isStaff } from '../../common/enums/role.enum';
import { decodeCursor, sliceCursorPage } from '../../common/utils/pagination';
import { PrismaService } from '../../database/prisma.service';
import type { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { OrdersService } from '../orders/orders.service';
import type { ConfirmPaymentDto, InitiatePaymentDto, RefundPaymentDto } from './dto/payment.dto';

/** Score fraude au-delà duquel la transaction est bloquée / révisée. */
const FRAUD_BLOCK_SCORE = 0.9;
const FRAUD_REVIEW_SCORE = 0.6;

interface Actor {
  id: string;
  role: string;
}

/**
 * Paiements : initiation idempotente (contrainte unique DB), machine à états
 * PAYMENT_TRANSITIONS, webhooks signature-first, escrow et remboursements.
 * Les passerelles opérateurs réelles sont branchées plus tard ; en attendant,
 * tout provider non intégré renvoie PAYMENT_PROVIDER_UNAVAILABLE — sauf MOCK
 * (succès immédiat, utilisé en dev et dans les specs).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly config: ConfigService,
  ) {}

  // --------------------------------------------------------------- Initiation

  async initiate(actor: Actor, dto: InitiatePaymentDto) {
    if (dto.purpose === PaymentPurpose.ORDER && !dto.orderId) {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'orderId requis pour payer une commande.');
    }

    let amountMinor = dto.amountMinor ?? 0;
    let currency = dto.currency ?? 'XOF';
    let orderId: string | null = null;

    if (dto.purpose === PaymentPurpose.ORDER && dto.orderId) {
      const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } });
      if (!order) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Commande introuvable.');
      if (order.buyerId !== actor.id && !isStaff(actor.role as never)) {
        throw AppException.forbidden(ERROR_CODES.NOT_FOUND, 'Cette commande ne vous appartient pas.');
      }
      if (order.status !== OrderStatus.PENDING) {
        throw AppException.unprocessable(
          ERROR_CODES.ORDER_NOT_PAYABLE,
          `Commande non payable en statut ${order.status}.`,
          { status: order.status },
        );
      }
      if (order.expiresAt && order.expiresAt < new Date()) {
        throw AppException.unprocessable(ERROR_CODES.ORDER_EXPIRED, 'Délai de paiement expiré, recréez la commande.');
      }
      amountMinor = dto.amountMinor ?? order.totalMinor;
      currency = order.currency;
      orderId = order.id;
    }

    if (amountMinor <= 0) {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Montant invalide.');
    }

    const fraudDecision = this.fraudAssess(amountMinor, dto.countryCode ?? 'CI');
    if (fraudDecision === FraudDecision.BLOCK) {
      throw AppException.forbidden(ERROR_CODES.PAYMENT_FAILED, 'Transaction bloquée par le contrôle anti-fraude.');
    }

    // Idempotence base : renvoyer le paiement existant (jamais un double débit).
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) {
      if (existing.userId !== actor.id) {
        throw AppException.conflict(ERROR_CODES.IDEMPOTENCY_CONFLICT);
      }
      return existing;
    }

    const created = await this.prisma.payment
      .create({
        data: {
          userId: actor.id,
          orderId,
          purpose: dto.purpose,
          provider: dto.provider,
          method: dto.method,
          status: PaymentStatus.INITIATED,
          amountMinor,
          currency,
          phone: dto.phone,
          countryCode: dto.countryCode ?? 'CI',
          fraudScore: fraudDecision === FraudDecision.REVIEW ? FRAUD_REVIEW_SCORE : 0,
          fraudDecision,
          metadata: {} as Prisma.InputJsonValue,
          idempotencyKey: dto.idempotencyKey,
        },
      })
      .catch(async (err: unknown) => {
        // Course idempotente : un doublon créé entre-temps est récupéré.
        if ((err as { code?: string }).code === 'P2002') {
          const dup = await this.prisma.payment.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
          if (dup) return dup;
        }
        throw err;
      });

    // Passerelle fournisseur (MOCK = succès immédiat pour dev/tests e2e).
    if (created.status === PaymentStatus.INITIATED && created.idempotencyKey === dto.idempotencyKey) {
      if (created.provider === PaymentProviderName.MOCK) {
        await this.transition(created.id, PaymentStatus.PENDING, { mock: true });
        await this.markSucceeded(created.id, `MOCK-${created.id.slice(0, 8)}`);
      } else if (created.provider === PaymentProviderName.WALLET) {
        // Débit wallet géré par WalletModule (intégration à venir) — reste PENDING.
        await this.transition(created.id, PaymentStatus.PENDING, { queued: 'wallet-debit' });
      } else {
        throw AppException.badRequest(
          ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE,
          `Passerelle ${created.provider} non configurée dans cet environnement.`,
        );
      }
    }
    return this.prisma.payment.findUnique({ where: { id: created.id } });
  }

  // ------------------------------------------------------------- Confirmation

  /** Confirmation interne (callback opérateur ou job de polling). */
  async confirm(paymentId: string, dto: ConfirmPaymentDto) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Paiement introuvable.');
    if (payment.status === PaymentStatus.SUCCEEDED) return payment; // idempotent
    if (payment.status !== PaymentStatus.INITIATED && payment.status !== PaymentStatus.PENDING) {
      throw AppException.unprocessable(
        ERROR_CODES.PAYMENT_FAILED,
        `Paiement non confirmable en statut ${payment.status}.`,
      );
    }
    return this.markSucceeded(paymentId, dto.providerRef);
  }

  async fail(paymentId: string, reason: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Paiement introuvable.');
    if (payment.status === PaymentStatus.FAILED) return payment;
    if (!canTransitionPayment(payment.status, PaymentStatus.FAILED)) {
      throw AppException.unprocessable(ERROR_CODES.PAYMENT_FAILED, `Impossible d'échouer un paiement ${payment.status}.`);
    }
    await this.recordAttempt(payment, PaymentStatus.FAILED, { reason });
    return this.prisma.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.FAILED } });
  }

  // ---------------------------------------------------------------- Webhook

  /**
   * Traite un webhook opérateur : signature vérifiée AVANT tout traitement,
   * dédup (provider,eventId), puis application de la transition.
   */
  async handleWebhook(provider: PaymentProviderName, eventId: string, signatureValid: boolean, payload: Record<string, unknown>) {
    if (!signatureValid) {
      await this.prisma.webhookEvent.create({
        data: { provider, eventId: eventId || `noid-${Date.now()}`, signatureValid: false, payload: payload as Prisma.InputJsonValue, status: 'FAILED' },
      });
      throw AppException.forbidden(ERROR_CODES.PAYMENT_FAILED, 'Signature webhook invalide.');
    }

    const stored = await this.prisma.webhookEvent.upsert({
      where: { provider_eventId: { provider, eventId } },
      create: { provider, eventId, signatureValid: true, payload: payload as Prisma.InputJsonValue },
      update: { attempts: { increment: 1 } },
    });
    if (stored.processedAt) return { duplicate: true }; // déjà traité

    const paymentRef = String(payload.paymentId ?? payload.reference ?? '');
    const success = payload.status === 'succeeded' || payload.status === 'SUCCESS';
    let result: { paymentId?: string; handled: boolean } = { handled: false };

    if (paymentRef) {
      const payment = await this.prisma.payment.findFirst({
        where: { OR: [{ id: paymentRef }, { providerRef: paymentRef }, { idempotencyKey: paymentRef }] },
      });
      if (payment) {
        if (success) {
          await this.markSucceeded(payment.id, String(payload.providerRef ?? eventId));
          result = { paymentId: payment.id, handled: true };
        } else if (payload.status === 'failed' || payload.status === 'FAILED') {
          await this.fail(payment.id, 'webhook-failed');
          result = { paymentId: payment.id, handled: true };
        }
      }
    }

    await this.prisma.webhookEvent.update({
      where: { id: stored.id },
      data: { processedAt: new Date(), status: result.handled ? 'PROCESSED' : 'IGNORED' },
    });
    return result;
  }

  // ------------------------------------------------------------ Succès final

  /** Transition SUCCEEDED + effets métier (commande PAID, escrow). */
  private async markSucceeded(paymentId: string, providerRef: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Paiement introuvable.');
    if (payment.status === PaymentStatus.SUCCEEDED) return payment;
    if (!canTransitionPayment(payment.status, PaymentStatus.SUCCEEDED)) {
      throw AppException.unprocessable(ERROR_CODES.PAYMENT_FAILED, `Transition ${payment.status} → SUCCEEDED interdite.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.SUCCEEDED, succeededAt: new Date(), providerRef },
      });
      await tx.paymentAttempt.create({
        data: { paymentId: payment.id, provider: payment.provider, status: PaymentStatus.SUCCEEDED, response: { providerRef } as Prisma.InputJsonValue },
      });
    });

    if (payment.purpose === PaymentPurpose.ORDER && payment.orderId) {
      await this.orders.markPaid(payment.orderId, payment.userId);
      // Escrow : la part vendeur est retenue 7 jours après livraison (libérée par job/escrow service).
      const order = await this.prisma.order.findUnique({ where: { id: payment.orderId } });
      if (order) {
        await this.prisma.escrowHold.upsert({
          where: { orderId: payment.orderId },
          create: {
            orderId: payment.orderId,
            paymentId: payment.id,
            amountMinor: order.subtotalMinor - order.discountMinor,
            currency: order.currency,
            status: EscrowStatus.HELD,
          },
          update: {},
        });
      }
    }
    return this.prisma.payment.findUnique({ where: { id: payment.id } });
  }

  // ------------------------------------------------------------ Remboursement

  async refund(paymentId: string, dto: RefundPaymentDto, actor: Actor) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Paiement introuvable.');
    if (!isStaff(actor.role as never) && payment.userId !== actor.id) {
      throw AppException.forbidden(ERROR_CODES.NOT_FOUND, 'Remboursement réservé au staff.');
    }
    if (payment.status !== PaymentStatus.SUCCEEDED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw AppException.unprocessable(ERROR_CODES.PAYMENT_FAILED, `Paiement ${payment.status} non remboursable.`);
    }
    const alreadyRefunded = await this.prisma.refund.aggregate({
      where: { paymentId: payment.id, status: PaymentStatus.SUCCEEDED },
      _sum: { amountMinor: true },
    });
    const refundedSoFar = alreadyRefunded._sum.amountMinor ?? 0;
    const requested = dto.amountMinor ?? payment.amountMinor - refundedSoFar;
    if (requested <= 0 || refundedSoFar + requested > payment.amountMinor) {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Montant remboursé supérieur au montant payé.');
    }

    const target = refundedSoFar + requested >= payment.amountMinor ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
    if (!canTransitionPayment(payment.status, target)) {
      throw AppException.unprocessable(ERROR_CODES.PAYMENT_FAILED, `Transition ${payment.status} → ${target} interdite.`);
    }

    const refundRow = await this.prisma.refund.create({
      data: { paymentId: payment.id, amountMinor: requested, reason: dto.reason, status: PaymentStatus.SUCCEEDED },
    });
    await this.prisma.payment.update({ where: { id: payment.id }, data: { status: target } });

    if (payment.orderId && target === PaymentStatus.REFUNDED) {
      // Commande remboursée : libérer l'escrow et annuler/réserver selon le cas.
      await this.prisma.escrowHold.updateMany({
        where: { orderId: payment.orderId, status: EscrowStatus.HELD },
        data: { status: EscrowStatus.REFUNDED },
      });
    }
    return refundRow;
  }

  // -------------------------------------------------------------------- Liste

  async listMine(query: CursorPaginationQueryDto & { status?: PaymentStatus }, actor: Actor) {
    const limit = query.limit ?? 20;
    const where: Prisma.PaymentWhereInput = { userId: actor.id };
    if (query.status) where.status = query.status;
    const cursor = decodeCursor(query.cursor);
    if (cursor?.id) where.id = { lt: String(cursor.id) };
    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true, orderId: true, purpose: true, provider: true, method: true,
        status: true, amountMinor: true, currency: true, createdAt: true, succeededAt: true,
      },
    });
    return sliceCursorPage(rows, limit, 'id');
  }

  // ------------------------------------------------------------------- Interne

  private async transition(id: string, to: PaymentStatus, response: Record<string, unknown>) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw AppException.notFound(ERROR_CODES.NOT_FOUND, 'Paiement introuvable.');
    if (!canTransitionPayment(payment.status, to)) {
      throw AppException.unprocessable(ERROR_CODES.PAYMENT_FAILED, `Transition ${payment.status} → ${to} interdite.`);
    }
    await this.recordAttempt(payment, to, response);
    return this.prisma.payment.update({ where: { id }, data: { status: to } });
  }

  private async recordAttempt(payment: { id: string; provider: PaymentProviderName }, status: PaymentStatus, response: Record<string, unknown>) {
    await this.prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        provider: payment.provider,
        status,
        response: response as Prisma.InputJsonValue,
      },
    });
  }

  /** Règle anti-fraude simple : montant/pays → ALLOW / REVIEW / BLOCK. */
  private fraudAssess(amountMinor: number, countryCode: string): FraudDecision {
    if (['XX', 'ZZ'].includes(countryCode)) return FraudDecision.BLOCK;
    const thresholdBlock = Number(this.config.get('FRAUD_BLOCK_MINOR') ?? 1_000_000);
    if (amountMinor >= thresholdBlock) return FraudDecision.BLOCK;
    if (amountMinor >= thresholdBlock / 2) return FraudDecision.REVIEW;
    return FraudDecision.ALLOW;
  }
}
