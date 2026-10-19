import { Role } from '../enums/role.enum';

/** Métadonnées JWT après validation (payload décodé). */
export interface JwtPayload {
  sub: string; // userId
  role: Role;
  phone?: string;
  sid?: string; // session id (refresh rotation)
  typ: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

/** Utilisateur injecté sur request.user par le guard JWT. */
export interface AuthenticatedUser {
  id: string;
  role: Role;
  phone?: string;
  sessionId?: string;
}
