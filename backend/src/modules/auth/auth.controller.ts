import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import {
  LogoutDto,
  RefreshTokenDto,
  RegisterDto,
  RequestOtpDto,
  SocialLoginDto,
  TwoFactorDisableDto,
  TwoFactorEnableStartDto,
  TwoFactorVerifyDto,
  VerifyOtpDto,
} from './dto/auth.dto';

interface Ctx {
  ip?: string;
  userAgent?: string;
}

function ctxFrom(req: Request): Ctx {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

/**
 * Authentification OTP-first (pas de mot de passe) + sociaux + 2FA.
 * Préfixe global : /api/v1 → routes effectives /api/v1/auth/*.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  // ------------------------------------------------------------- Public flows

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  @ApiOperation({ summary: 'Envoyer un code OTP par SMS ou WhatsApp' })
  requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    return this.auth.requestOtp(dto.phone, dto.channel ?? 'sms', req.ip);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: "Vérifier l'OTP : ouvre une session ou signale needsRegistration" })
  verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    return this.auth.verifyOtp(dto, ctxFrom(req));
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: "Créer un compte (OTP consommé d'abord)" })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, ctxFrom(req));
  }

  @Public()
  @Post('social')
  @HttpCode(200)
  @ApiOperation({ summary: 'Connexion Google / Facebook / Apple (vérification serveur du token)' })
  socialLogin(@Body() dto: SocialLoginDto, @Req() req: Request) {
    return this.auth.socialLogin(dto, ctxFrom(req));
  }

  @Public()
  @Post('2fa/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Second facteur : finir le login avec challengeTfaToken + code' })
  completeTwoFactor(
    @Body() body: { pendingToken: string; code: string },
    @Req() req: Request,
  ) {
    return this.auth.completeTwoFactor(body.pendingToken, body.code, ctxFrom(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotation du refresh token (réutilisation ⇒ révocation de la famille)' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Profil minimal authentifié' })
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  // ------------------------------------------------------- 2FA (authentifié)

  @Post('2fa/setup')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Générer un secret TOTP + URL otpauth (non activé tant que non vérifié)' })
  setup2fa(@CurrentUser('id') userId: string, @Body() dto: TwoFactorEnableStartDto) {
    return this.twoFactor.startSetup(userId, dto.issuer);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activer la 2FA après premier code valide ; retourne les backup codes (une seule fois)' })
  enable2fa(@CurrentUser('id') userId: string, @Body() dto: TwoFactorVerifyDto) {
    return this.twoFactor.enable(userId, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Désactiver la 2FA (TOTP frais exigé)' })
  disable2fa(@CurrentUser('id') userId: string, @Body() dto: TwoFactorDisableDto) {
    return this.twoFactor.disable(userId, dto.totp);
  }

  @Post('2fa/backup-codes')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Régénérer les backup codes (TOTP valide exigé)' })
  regenerateBackupCodes(@CurrentUser('id') userId: string, @Body() dto: TwoFactorDisableDto) {
    return this.twoFactor.regenerateBackupCodes(userId, dto.totp);
  }

  // -------------------------------------------------------------- Logout

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Révoquer la session courante, ou toutes avec allDevices=true' })
  async logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto): Promise<void> {
    if (!user) return;
    await this.auth.logout(user.id, user.sessionId, Boolean(dto.allDevices));
  }

}
