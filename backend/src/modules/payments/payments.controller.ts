import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentProviderName, PaymentStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { PaymentsService } from './payments.service';
import { ConfirmPaymentDto, InitiatePaymentDto } from './dto/payment.dto';

interface Actor {
  id: string;
  role: string;
}

/**
 * Paiements : initiation idempotente, historique personnel, confirmation
 * opérateur (simulée en dev) et webhooks publics (vérification signature).
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(201)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initier un paiement (orderId requis si purpose=ORDER, clé d’idempotence obligatoire)' })
  initiate(@CurrentUser() user: Actor, @Body() dto: InitiatePaymentDto) {
    return this.payments.initiate(user, dto);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mes paiements (curseur + filtre statut)' })
  listMine(
    @CurrentUser() user: Actor,
    @Query() query: CursorPaginationQueryDto,
    @Query('status') status?: PaymentStatus,
  ) {
    return this.payments.listMine({ ...query, status }, user);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirmer un paiement (callback opérateur simulé — transition PENDING → SUCCEEDED)' })
  confirm(@CurrentUser() user: Actor, @Param('id') id: string, @Body() dto: ConfirmPaymentDto) {
    return this.payments.confirm(id, dto, user);
  }

  @Post('webhook/:provider')
  @HttpCode(200)
  @Public()
  @ApiOperation({ summary: 'Webhook opérateur (signature vérifiée avant tout traitement ; corps brut requis)' })
  webhook(@Param('provider') provider: PaymentProviderName, @Req() req: Request) {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw || raw.length === 0) {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Corps du webhook absent.');
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw AppException.badRequest(ERROR_CODES.VALIDATION_FAILED, 'Corps du webhook illisible.');
    }
    const eventId = String(payload.eventId ?? payload.id ?? `noid-${Date.now()}`);
    // TODO intégration opérateurs : HMAC réel (secret par provider) au lieu du flag de test.
    const signatureValid = req.header('x-signature-valid') === 'true';
    return this.payments.handleWebhook(provider, eventId, signatureValid, payload);
  }
}
