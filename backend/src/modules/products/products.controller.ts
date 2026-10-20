import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { ProductsService } from './products.service';
import {
  AddMediaDto,
  AdjustStockDto,
  CreateProductDto,
  CreateVariantDto,
  SetProductStatusDto,
  UpdateProductDto,
} from './dto/product.dto';

/**
 * Catalogue produits. Routes effectives sous /api/v1/products/*.
 * Les écritures vérifient la propriété de la boutique parente dans le service.
 */
@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // -------------------------------------------------------------- Public

  @Public()
  @Get()
  @ApiOperation({ summary: 'Catalogue public (statut ACTIVE par défaut, curseur)' })
  list(
    @Query() query: CursorPaginationQueryDto,
    @Query('shopId') shopId?: string,
    @Query('category') category?: string,
    @Query('status') status?: ProductStatus,
  ) {
    return this.products.list({ ...query, shopId, category, status });
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Fiche produit (média trié, variantes, boutique)' })
  getById(@Param('id') id: string) {
    return this.products.getById(id);
  }

  // ------------------------------------------------------ Écriture (owner)

  @Post('shops/:shopRef')
  @HttpCode(201)
  @ApiOperation({ summary: 'Créer un produit brouillon dans ma boutique' })
  create(
    @CurrentUser() user: { id: string; role: string },
    @Param('shopRef') shopRef: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.products.create(user, shopRef, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Mettre à jour titre/description/catégorie/prix' })
  update(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(user, id, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Transition DRAFT→ACTIVE→OUT_OF_STOCK/ARCHIVED (ARCHIVED définitif)' })
  setStatus(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
    @Body() dto: SetProductStatusDto,
  ) {
    return this.products.setStatus(user, id, dto.status);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Suppression logique (historique commandes préservé)' })
  remove(@CurrentUser() user: { id: string; role: string }, @Param('id') id: string) {
    return this.products.remove(user, id);
  }

  // ------------------------------------------------- Variantes / média / stock

  @Post(':id/variants')
  @HttpCode(201)
  @ApiOperation({ summary: 'Ajouter une variante (SKU unique global, prix en unités mineures)' })
  addVariant(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.products.addVariant(user, id, dto);
  }

  @Post(':id/media')
  @HttpCode(201)
  @ApiOperation({ summary: 'Attacher des clés média uploadées (positions séquentielles)' })
  addMedia(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
    @Body() dto: AddMediaDto,
  ) {
    return this.products.addMedia(user, id, dto);
  }

  @Post('variants/:variantId/stock/:warehouseId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ajuster le stock (delta signé ; refus si disponible < 0)' })
  adjustStock(
    @CurrentUser() user: { id: string; role: string },
    @Param('variantId') variantId: string,
    @Param('warehouseId') warehouseId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.products.adjustStock(user, variantId, warehouseId, dto);
  }
}
