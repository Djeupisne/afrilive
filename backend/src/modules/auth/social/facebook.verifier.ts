import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import axios from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { AppException } from '../../../common/errors/app.exception';
import type { SocialVerifier, VerifiedSocialProfile } from './social-verifier.interface';

/**
 * Vérification Facebook : appel serveur du endpoint `me` protégé par
 * appsecret_proof (HMAC-SHA256 de l'access_token avec l'app secret) —
 * garantit que le token a été émis pour NOTRE application.
 */
@Injectable()
export class FacebookVerifier implements SocialVerifier {
  readonly provider = AuthProvider.FACEBOOK;

  isConfigured(): boolean {
    return Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
  }

  async verify(token: string): Promise<VerifiedSocialProfile> {
    if (!this.isConfigured()) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, {
        status: HttpStatus.BAD_REQUEST,
        detail: 'Connexion Facebook non configurée.',
      });
    }
    const appSecretProof = createHmac('sha256', process.env.FACEBOOK_APP_SECRET as string).update(token).digest('hex');
    let data: { id?: string; name?: string; email?: string; picture?: { data?: { url?: string } } };
    try {
      const res = await axios.get<{ id: string; name?: string; email?: string; picture?: { data?: { url?: string } } }>(
        'https://graph.facebook.com/v20.0/me',
        {
          params: { fields: 'id,name,email,picture', access_token: token, appsecret_proof: appSecretProof },
          timeout: 8_000,
        },
      );
      data = res.data;
    } catch (err) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, {
        status: HttpStatus.UNAUTHORIZED,
        detail: `Vérification Facebook échouée : ${(err as Error).message}`,
      });
    }
    if (!data.id) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, { status: HttpStatus.UNAUTHORIZED });
    }
    return {
      provider: this.provider,
      providerUserId: data.id,
      email: data.email,
      name: data.name,
      pictureUrl: data.picture?.data?.url,
    };
  }
}
