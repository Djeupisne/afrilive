import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import axios from 'axios';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { AppException } from '../../../common/errors/app.exception';
import { assertIdTokenClaims, decodeJwtParts, verifyRs256, type Jwk } from './jwt-id-token.util';
import type { SocialVerifier, VerifiedSocialProfile } from './social-verifier.interface';

const ISSUER = 'https://accounts.google.com';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Vérification des id_token Google (OIDC) : signature RS256 contre le JWKS
 * officiel (cache 1 h), contrôles iss/aud/exp. Désactivé si GOOGLE_CLIENT_ID absent.
 */
@Injectable()
export class GoogleVerifier implements SocialVerifier {
  readonly provider = AuthProvider.GOOGLE;
  private jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_CLIENT_ID);
  }

  async verify(token: string): Promise<VerifiedSocialProfile> {
    if (!this.isConfigured()) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, {
        status: HttpStatus.BAD_REQUEST,
        detail: 'Connexion Google non configurée (GOOGLE_CLIENT_ID absent).',
      });
    }
    const { payload } = decodeJwtParts(token);
    assertIdTokenClaims(payload, { issuer: ISSUER, audience: process.env.GOOGLE_CLIENT_ID as string });
    const keys = await this.getJwks();
    try {
      verifyRs256(token, keys);
    } catch (err) {
      throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, {
        status: HttpStatus.UNAUTHORIZED,
        detail: `id_token Google invalide : ${(err as Error).message}`,
      });
    }
    const sub = String(payload.sub ?? '');
    if (!sub) throw new AppException(ERROR_CODES.INVALID_CREDENTIALS, { status: HttpStatus.UNAUTHORIZED });
    return {
      provider: this.provider,
      providerUserId: sub,
      email: payload.email ? String(payload.email) : undefined,
      name: payload.name ? String(payload.name) : undefined,
      pictureUrl: payload.picture ? String(payload.picture) : undefined,
    };
  }

  private async getJwks(): Promise<Jwk[]> {
    if (this.jwksCache && Date.now() - this.jwksCache.fetchedAt < 3_600_000) return this.jwksCache.keys;
    const res = await axios.get<{ keys: Jwk[] }>(JWKS_URL, { timeout: 8_000 });
    this.jwksCache = { keys: res.data.keys ?? [], fetchedAt: Date.now() };
    return this.jwksCache.keys;
  }
}
