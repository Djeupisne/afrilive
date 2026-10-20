/** Acteur authentifié minimal injecté par JwtAuthGuard. */
export interface Actor {
  id: string;
  role: string;
}
