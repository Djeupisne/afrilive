import { KycStatus } from '@prisma/client';

export const KycStatusEnum = KycStatus;
export type KycStatusType = KycStatus;

/** Statuts KYC autorisés pour postuler au retrait (withdrawal). */
export const KYC_WITHDRAWAL_OK: KycStatus[] = [KycStatus.APPROVED];
