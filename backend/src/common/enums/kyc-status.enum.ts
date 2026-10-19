/**
 * Statuts KYC — re-export de l'enum généré par Prisma (source de vérité :
 * backend/prisma/schema.prisma). Ne jamais redéfinir les valeurs ici.
 */
import { KycStatus as PrismaKycStatus } from '@prisma/client';

export const KycStatus = PrismaKycStatus;
export type KycStatus = PrismaKycStatus;

/** Statuts terminaux d'un dossier KYC (plus aucune transition sans nouveau dépôt). */
export const FINAL_KYC_STATUSES: readonly KycStatus[] = [KycStatus.APPROVED, KycStatus.REJECTED] as const;

/** Transitions autorisées du cycle de vie KYC. */
export const KYC_TRANSITIONS: Record<KycStatus, KycStatus[]> = {
  [KycStatus.NONE]: [KycStatus.PENDING],
  [KycStatus.PENDING]: [KycStatus.APPROVED, KycStatus.REJECTED],
  [KycStatus.REJECTED]: [KycStatus.PENDING],
  [KycStatus.APPROVED]: [],
};

export function canTransitionKyc(from: KycStatus, to: KycStatus): boolean {
  return KYC_TRANSITIONS[from]?.includes(to) ?? false;
}
