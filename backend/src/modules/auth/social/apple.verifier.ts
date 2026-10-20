import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import axios from 'axios';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { AppException } from '../../../common/errors/app.exception';
import { assertIdTokenClaims, decodeJwtParts, verifyRs256, type Jwk } from './jwt-id-token.util';
import type { SocialVerifier, VerifiedSocialProfile } from './social-verifier.interface';

const ISSUER = 'https://appleid.apple.com';
const JWKS_URL = 'https://appleid.apple.com/auth/keys';

/**
 * Vérification des identity tokens Apple : JWKS RSA Apple (kid dynamique),
 * iss + aud (= APPLE_CLIENT_ID / Services ID), exp. Le `sub` Apple est stable
 * et sert d'identifiant fournisseur.
 */
@Injectable()
export class AppleVerifier implements SocialVerifier {
  readonly provider = AuthProvider.APPLE;
  private jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.APPLE_CLIENT_ID);
  }

  async verify(token: string): Promise<VerifiedSocialProfile> {
    if (!this.isConfigured()) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, {
        status: HttpStatus.BAD_REQUEST,
        detail: 'Connexion Apple non configurée (APPLE_CLIENT_ID absent).',
      });
    }
    const { payload } = decodeJwtParts(token);
    assertIdTokenClaims(payload, { issuer: ISSUER, audience: process.env.APPLE_CLIENT_ID as string });
    const keys = await this.getJwks();
    try {
      verifyRs256(token, keys);
    } catch (err) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, {
        status: HttpStatus.UNAUTHORIZED,
        detail: `identity_token Apple invalide : ${(err as Error).message}`,
      });
    }
    return {
      provider: this.provider,
      providerUserId: String(payload.sub),
      // Apple ne renvoie email/name que lors de la première autorisation (champ `user` côté client).
      email: payload.email ? String(payload.email) : undefined,
      name: typeof payload.name === 'object' && payload.name ? String((payload.name as { firstName?: string }).firstName ?? '') : undefined,
    };
  }

  private async getJwks(): Promise<Jwk[]> {
    if (this.jwksCache && Date.now() - this.jwksCache.fetchedAt < 3_600_000) return this.jwksCache.keys;
    const res = await axios.get<{ keys: Jwk[] }>(JWKS_URL, { timeout: 8_000 });
    this.jwksCache = { keys: res.data.keys ?? [], fetchedAt: Date.now() };
    return this.jwksCache.keys;
  }
}
