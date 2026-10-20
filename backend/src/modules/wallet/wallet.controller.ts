import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { WalletService } from './wallet.service';
import { ConvertCoinsDto, RequestWithdrawalDto, SetWalletFrozenDto, TransferWalletDto } from './dto/wallet.dto';

interface Actor {
  id: string;
  role: string;
}

/**
 * Portefeuilles AFRI-WALLET. Routes effectives /api/v1/wallet/*.
 * Écritures défendues : gel (WALLET_FROZEN), solde atomique (AFRI-WALLET-001),
 * plafond journalier (AFRI-WALLET-002), idempotence par clé obligatoire.
 */
@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Mon wallet (créé implicitement en XOF si absent)' })
  @ApiQuery({ name: 'currency', required: false, description: 'Devise (défaut XOF)' })
  getMine(@CurrentUser() user: Actor, @Query('currency') currency?: string) {
    return this.wallet.getWalletForActor(user, currency);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Historique paginé par curseur (keyset desc)' })
  listTransactions(@CurrentUser() user: Actor, @Query() query: CursorPaginationQueryDto, @Query('currency') currency?: string) {
    return this.wallet.listTransactions(user, query, currency);
  }

  @Post('transfer')
  @HttpCode(200)
  @ApiOperation({ summary: 'Transfert entre wallets de même devise (CURRENCY_MISMATCH sinon)' })
  transfer(@CurrentUser() user: Actor, @Body() dto: TransferWalletDto & { toUserId: string }) {
    return this.wallet.transfer(user.id, dto);
  }

  @Post('withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Demande de retrait (plafond journalier dailyLimitMinor)' })
  withdraw(@CurrentUser() user: Actor, @Body() dto: RequestWithdrawalDto) {
    return this.wallet.requestWithdrawal(user, dto);
  }

  @Post('convert')
  @HttpCode(200)
  @ApiOperation({ summary: 'Conversion coins → argent (FxRate COIN→devise ou config)' })
  convert(@CurrentUser() user: Actor, @Body() dto: ConvertCoinsDto) {
    return this.wallet.convertCoins(user, dto);
  }

  @Patch(':id/frozen')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
  @ApiOperation({ summary: 'Staff : gel / dégel administratif du wallet' })
  setFrozen(@CurrentUser() user: Actor, @Param('id') id: string, @Body() dto: SetWalletFrozenDto) {
    return this.wallet.setFrozen(user, id, dto.frozen, dto.reason);
  }
}
