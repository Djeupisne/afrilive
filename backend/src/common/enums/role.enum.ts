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

export const ALL_ROLES: Role[] = Object.values(Role);

/** Rôles considérés comme staff interne. */
export const STAFF_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.SUPPORT];

export function isStaff(role: Role | string): boolean {
  return STAFF_ROLES.includes(role as Role);
}
