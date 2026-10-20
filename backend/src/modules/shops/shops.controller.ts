import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { ShopsService } from './shops.service';
import { ProductsService } from '../products/products.service';
import { CreateShopDto, UpdateShopDto } from './dto/shop.dto';

/**
 * Boutiques. Routes effectives sous /api/v1/shops/*.
 * Lecture publique par slug ; écritures réservées au propriétaire (JWT),
 * sanctions réservées au staff (@Roles + RolesGuard global).
 */
@ApiTags('shops')
@Controller('shops')
export class ShopsController {
  constructor(
    private readonly shops: ShopsService,
    private readonly products: ProductsService,
  ) {}

  // -------------------------------------------------------------- Public

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Fiche publique d’une boutique (par slug)' })
  getBySlug(@Param('slug') slug: string) {
    return this.shops.getBySlug(slug);
  }

  // ------------------------------------------------------------ Mon shop

  @ApiBearerAuth()
  @Post()
  @HttpCode(201)
  @Roles(Role.SELLER, Role.INFLUENCER, Role.COMPANY, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Créer ma boutique (une seule par compte)' })
  create(@CurrentUser() user: { id: string; role: string }, @Body() dto: CreateShopDto) {
    return this.shops.create(user, dto);
  }

  @ApiBearerAuth()
  @Get('me/info')
  @ApiOperation({ summary: 'Ma boutique (champs privés + entrepôts)' })
  getMine(@CurrentUser('id') userId: string) {
    return this.shops.getMine(userId);
  }

  @ApiBearerAuth()
  @Patch('me/info')
  @ApiOperation({ summary: 'Mettre à jour ma vitrine' })
  updateMine(@CurrentUser('id') userId: string, @Body() dto: UpdateShopDto) {
    return this.shops.updateByOwner(userId, dto);
  }

  @ApiBearerAuth()
  @Post('me/media/upload-url')
  @HttpCode(201)
  @ApiOperation({ summary: 'Presign PUT pour logo/bannière (S3/R2/MinIO)' })
  requestUploadUrl(
    @CurrentUser() user: { id: string; role: string },
    @Query('filename') filename: string,
    @Query('contentType') contentType: string,
  ) {
    return this.shops.requestMediaUploadUrl(user, filename ?? 'image.jpg', contentType ?? 'image/jpeg');
  }

  // -------------------------------------------------- Gestion par référence

  @ApiBearerAuth()
  @Patch(':shopRef')
  @ApiOperation({ summary: 'Mettre à jour une boutique (owner ou staff)' })
  update(
    @CurrentUser() user: { id: string; role: string },
    @Param('shopRef') shopRef: string,
    @Body() dto: UpdateShopDto,
  ) {
    return this.shops.updateBySlugOrId(user, shopRef, dto);
  }

  @ApiBearerAuth()
  @Post(':shopRef/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Changer le statut : owner → CLOSED uniquement ; SUSPENDED/ACTIVE = staff' })
  setStatus(
    @CurrentUser() user: { id: string; role: string },
    @Param('shopRef') shopRef: string,
    @Body('status') status: string,
  ) {
    return this.shops.setStatus(user, shopRef, String(status).toUpperCase());
  }

  // ------------------------------------------------------------- Catalogue

  @ApiBearerAuth()
  @Public()
  @Get(':slug/products')
  @ApiOperation({ summary: 'Catalogue public d’une boutique (produits ACTIVE, curseur)' })
  listShopProducts(@Param('slug') slug: string, @Query() query: CursorPaginationQueryDto) {
    return this.shops.getBySlug(slug).then((shop) =>
      this.products.list({ ...query, shopId: String(shop.id), status: undefined }),
    );
  }

  @ApiBearerAuth()
  @Get('me/catalog')
  @ApiOperation({ summary: 'Mes produits (tous statuts, pagination par curseur)' })
  myCatalog(@CurrentUser() user: { id: string; role: string }, @Query() query: CursorPaginationQueryDto) {
    return this.shops.getMine(user.id).then((shop) => this.products.listForOwner(user, shop.id, query));
  }
}
