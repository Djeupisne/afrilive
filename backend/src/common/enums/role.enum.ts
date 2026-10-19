/** Rôles applicatifs — miroir de l'enum Prisma `Role`. */
export enum Role {
  USER = 'USER',
  SELLER = 'SELLER',
  INFLUENCER = 'INFLUENCER',
  COMPANY = 'COMPANY',
  COURIER = 'COURIER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  SUPPORT = 'SUPPORT',
}

/** Rôles considérés comme staff interne. */
export const STAFF_ROLES: readonly Role[] = [
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.SUPPORT,
] as const;
