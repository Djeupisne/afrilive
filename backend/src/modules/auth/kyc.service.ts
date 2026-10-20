import { HttpStatus, Injectable } from '@nestjs/common';
import { KycDocType, KycStatus } from '@prisma/client';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { StorageService, buildObjectKey } from '../../integrations/storage/storage.service';

const DOC_TYPES = Object.keys(KycDocType) as KycDocType[];

/** Vérification d'identité : URLs d'upload signées + documents KYC. */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Presign PUT pour un document ; la clé retournée devra être rejouée dans submit(). */
  async createUploadUrl(userId: string, type: string, contentType: string) {
    this.assertType(type);
    const key = buildObjectKey(`kyc/${userId}`, `${type.toLowerCase()}-${Date.now()}`);
    const presign = await this.storage.presignPut(key, contentType, 900);
    return { ...presign, expiresInSec: 900 };
  }

  /** Enregistre le document comme PENDING (un seul dossier en attente à la fois). */
  async submit(userId: string, type: string, fileKey: string) {
    this.assertType(type);
    if (!fileKey.startsWith(`kyc/${userId}/`)) {
      throw new AppException(ERROR_CODES.VALIDATION_FAILED, {
        status: HttpStatus.BAD_REQUEST,
        detail: 'fileKey ne correspond pas à votre espace de dépôt.',
      });
    }
    const pending = await this.prisma.kycDocument.findFirst({
      where: { userId, status: KycStatus.PENDING },
    });
    if (pending) {
      throw new AppException(ERROR_CODES.KYC_ALREADY_PENDING, { status: HttpStatus.CONFLICT });
    }
    const doc = await this.prisma.kycDocument.create({
      data: { userId, type: type as KycDocType, fileKey },
    });
    await this.prisma.user.update({ where: { id: userId }, data: { kycStatus: KycStatus.PENDING } });
    return { id: doc.id, type: doc.type, status: doc.status, createdAt: doc.createdAt };
  }

  /** Statut agrégé : dernier document par type + statut global du compte. */
  async getStatus(userId: string) {
    const [user, docs] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycStatus: true } }),
      this.prisma.kycDocument.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const latestByType: Record<string, unknown> = {};
    for (const d of docs) if (!(d.type in latestByType)) latestByType[d.type] = { id: d.id, status: d.status, createdAt: d.reviewedById ? d.updatedAt : d.createdAt, reviewNote: d.reviewNote };
    return { kycStatus: user.kycStatus, documents: latestByType };
  }

  private assertType(type: string): asserts type is KycDocType {
    if (!DOC_TYPES.includes(type as KycDocType)) {
      throw new AppException(ERROR_CODES.VALIDATION_FAILED, {
        status: HttpStatus.BAD_REQUEST,
        detail: `Type de document KYC inconnu : ${type}.`,
      });
    }
  }
}
