import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { OrdersService } from './orders.service';
import { TransitionOrderDto } from './dto/order.dto';

interface Actor {
  id: string;
  role: string;
}

/**
 * Suivi et pilotage des commandes. Routes effectives /api/v1/orders/*.
 */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Mes commandes (acheteur), curseur + filtre statut' })
  listMine(@CurrentUser() user: Actor, @Query() query: CursorPaginationQueryDto, @Query('status') status?: OrderStatus) {
    return this.orders.listMine({ ...query, status }, user);
  }

  @Get('shop/:shopId')
  @ApiOperation({ summary: 'Commandes reçues par ma boutique (owner/staff)' })
  listForShop(
    @CurrentUser() user: Actor,
    @Param('shopId') shopId: string,
    @Query() query: CursorPaginationQueryDto,
    @Query('status') status?: OrderStatus,
  ) {
    return this.orders.listForShop(shopId, { ...query, status }, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail commande (lignes snapshot + historique de statut)' })
  getById(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.orders.getById(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annulation (acheteur si PENDING, staff si PENDING/PAID) + libération stock' })
  cancel(@CurrentUser() user: Actor, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.orders.cancel(id, user, body?.reason);
  }

  @Post(':id/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Transition seller/staff (SHIPPED, DELIVERED, RETURNED…) défendue par ORDER_TRANSITIONS' })
  transition(@CurrentUser() user: Actor, @Param('id') id: string, @Body() dto: TransitionOrderDto) {
    return this.orders.transition(id, dto.status as OrderStatus, user, dto.note);
  }
}
