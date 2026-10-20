import { AuthProvider } from '@prisma/client';

/** Profil social vérifié, indépendant du fournisseur. */
export interface VerifiedSocialProfile {
  provider: AuthProvider;
  providerUserId: string; // sub / id stable chez le fournisseur
  email?: string;
  name?: string;
  pictureUrl?: string;
}

export interface SocialVerifier {
  readonly provider: AuthProvider;
  /** Vrai si le fournisseur est configurable dans cet environnement. */
  isConfigured(): boolean;
  /** Vérifie le jeton client (id_token JWT ou access_token) et retourne le profil. */
  verify(token: string): Promise<VerifiedSocialProfile>;
}
