import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { EmailModule } from '../../integrations/email/email.module';
import { SmsModule } from '../../integrations/sms/sms.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { OtpService } from './otp.service';
import { AppleVerifier } from './social/apple.verifier';
import { FacebookVerifier } from './social/facebook.verifier';
import { GoogleVerifier } from './social/google.verifier';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';

@Module({
  imports: [PassportModule, JwtModule.register({}), SmsModule, EmailModule],
  controllers: [AuthController, KycController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    TwoFactorService,
    JwtStrategy,
    GoogleVerifier,
    FacebookVerifier,
    AppleVerifier,
    KycService,
  ],
  exports: [AuthService, TokenService, OtpService],
})
export class AuthModule {}
