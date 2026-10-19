/**
 * Rôles applicatifs — re-export de l'enum généré par Prisma (source de vérité :
 * backend/prisma/schema.prisma). Ne jamais redéfinir les valeurs ici.
 */
import { Role as PrismaRole } from '@prisma/client';

export const Role = PrismaRole;
export type Role = PrismaRole;

/** Rôles considérés comme staff interne. */
export const STAFF_ROLES: readonly Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.SUPPORT] as const;

/** Rôles pouvant vendre (boutiques / produits / lives shopping). */
export const SELLER_ROLES: readonly Role[] = [Role.SELLER, Role.INFLUENCER, Role.COMPANY] as const;

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}
