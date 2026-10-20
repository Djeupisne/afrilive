import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { OrdersService } from './orders.service';
import { AddCartItemDto, SetCartItemQuantityDto } from './dto/cart.dto';
import { CreateOrderDto } from './dto/order.dto';

interface Actor {
  id: string;
  role: string;
}

/**
 * Panier + passage de commande. Routes effectives /api/v1/cart/* et
 * /api/v1/orders/checkout (la consultation des commandes est dans OrdersController).
 */
@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Panier enrichi (prix effectifs, stock, lignes en anomalie)' })
  getCart(@CurrentUser() user: Actor) {
    return this.cart.getCart(user.id);
  }

  @Post('items')
  @HttpCode(201)
  @ApiOperation({ summary: 'Ajouter/incrémenter une variante' })
  addItem(@CurrentUser() user: Actor, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(user.id, dto);
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Remplacer la quantité d’une ligne (0 = retirer)' })
  setQuantity(@CurrentUser() user: Actor, @Param('itemId') itemId: string, @Body() dto: SetCartItemQuantityDto) {
    return this.cart.setQuantity(user.id, itemId, dto);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Retirer une ligne' })
  removeItem(@CurrentUser() user: Actor, @Param('itemId') itemId: string) {
    return this.cart.removeItem(user.id, itemId);
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Vider le panier' })
  clear(@CurrentUser() user: Actor) {
    return this.cart.clear(user.id);
  }

  @Post('checkout')
  @HttpCode(201)
  @ApiOperation({ summary: 'Commander tout/partie du panier → Order PENDING (expire à 30 min)' })
  async checkout(@CurrentUser() user: Actor, @Body() dto: CreateOrderDto) {
    const view = await this.cart.getCart(user.id);
    return this.orders.createFromCart(user, view, dto);
  }
}
