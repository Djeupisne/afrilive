import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppException } from '../../common/errors/app.exception';
import { ERROR_CODES } from '../../common/errors/error-codes';

export interface PresignPutResult {
  url: string;
  key: string;
  expiresAt: string;
}

export interface MultipartInit {
  key: string;
  uploadId: string;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/**
 * Service de stockage objet compatible S3 (Cloudflare R2, MinIO, AWS S3).
 * STORAGE_MODE=memory → aucune requête réseau : les URLs sont simulées et
 * signées localement (parfait pour les tests/dév sans bucket).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly mode: 'memory' | 's3';
  private readonly bucket: string;
  private readonly cdnBaseUrl: string;
  private readonly cdnTokenKey: string;
  private s3: S3Client | null = null;

  constructor(config: ConfigService) {
    this.mode = (config.get<string>('app.modes.storage') as 'memory' | 's3') ?? 'memory';
    const st = config.get<{
      endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string; cdnBaseUrl: string; cdnTokenKey: string;
    }>('app.storage')!;
    this.bucket = st.bucket;
    this.cdnBaseUrl = st.cdnBaseUrl;
    this.cdnTokenKey = st.cdnTokenKey;
    if (this.mode === 's3') {
      this.s3 = new S3Client({
        endpoint: st.endpoint || undefined,
        region: st.region || 'auto',
        forcePathStyle: true, // requis par MinIO/R2 custom domain
        credentials: st.accessKey && st.secretKey ? { accessKeyId: st.accessKey, secretAccessKey: st.secretKey } : undefined,
      });
      this.logger.log(`Storage S3 actif (bucket=${this.bucket}, endpoint=${st.endpoint || 'AWS'})`);
    } else {
      this.logger.log('Storage en mode mémoire (URLs signées simulées)');
    }
  }

  private client(): S3Client {
    if (!this.s3) throw new AppException(ERROR_CODES.INTERNAL_ERROR, { detail: 'S3 non initialisé.' });
    return this.s3;
  }


  /** URL présignée pour un PUT direct client → bucket. */
  async presignPut(key: string, contentType?: string, ttlSec = 900): Promise<PresignPutResult> {
    if (this.mode === 'memory') return this.simulated('PUT', key, ttlSec);
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    const url = await getSignedUrl(this.client(), cmd, { expiresIn: ttlSec });
    return { url, key, expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString() };
  }

  /** URL présignée de lecture (privée, durée limitée). */
  async presignGet(key: string, ttlSec = 3600, downloadName?: string): Promise<string> {
    if (this.mode === 'memory') return this.simulated('GET', key, ttlSec).url;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: downloadName ? `attachment; filename="${downloadName}"` : undefined,
    });
    return getSignedUrl(this.client(), command, { expiresIn: ttlSec });
  }

  // ---------- Multipart ----------

  async multipartCreate(key: string, contentType?: string): Promise<MultipartInit> {
    if (this.mode === 'memory') return { key, uploadId: `mem-${randomUUID()}` };
    const res = await this.client().send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    if (!res.UploadId) throw new AppException(ERROR_CODES.INTERNAL_ERROR, { detail: 'Multipart: pas dUploadId.' });
    return { key, uploadId: res.UploadId };
  }

  async multipartPresignPart(init: MultipartInit, partNumber: number, ttlSec = 900): Promise<string> {
    if (this.mode === 'memory') return this.simulated('PUT', `${init.key}?part=${partNumber}`, ttlSec).url;
    const cmd = new UploadPartCommand({
      Bucket: this.bucket,
      Key: init.key,
      PartNumber: partNumber,
      UploadId: init.uploadId,
    });
    return getSignedUrl(this.client(), cmd, { expiresIn: ttlSec });
  }

  async multipartComplete(init: MultipartInit, parts: CompletedPart[]): Promise<{ key: string; etag?: string }> {
    if (this.mode === 'memory') return { key: init.key, etag: 'memory' };
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const res = await this.client().send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: init.key,
        UploadId: init.uploadId,
        MultipartUpload: { Parts: sorted.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }),
    );
    return { key: init.key, etag: res.ETag };
  }

  async multipartAbort(init: MultipartInit): Promise<void> {
    if (this.mode === 'memory') return;
    await this.client().send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: init.key, UploadId: init.uploadId }),
    );
  }

  // ---------- Opérations directes ----------

  async delete(key: string): Promise<void> {
    if (this.mode === 'memory') return;
    await this.client().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    if (this.mode === 'memory') return;
    await this.client().send(
      new CopyObjectCommand({ Bucket: this.bucket, CopySource: `${this.bucket}/${sourceKey}`, Key: destKey }),
    );
  }

  /** URL publique via CDN si configuré, sinon URL présignée longue durée. */
  publicUrl(key: string): string {
    if (this.cdnBaseUrl) return `${this.cdnBaseUrl.replace(/\/+$/, '')}/${key}`;
    return this.mode === 's3' ? `${this.bucket}.s3cdn.invalid/${key}` : `memory://${this.bucket}/${key}`;
  }

  /**
   * Signature type « token CDN » (Cloudflare Signed URL / Akamai) pour la
   * lecture privée : `?expires=<ts>&signature=<hmac-sha256(key, path+expires)>`.
   */
  signPrivateUrl(path: string, ttlSec = 3600): string {
    const base = this.cdnBaseUrl || 'https://cdn.afrilive.app';
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const expires = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = this.hmac(`${cleanPath}${expires}`);
    return `${base.replace(/\/+$/, '')}${cleanPath}?expires=${expires}&signature=${sig}`;
  }

  /** Vérification du token CDN côté app (pour le middleware de validation d'URL). */
  verifyPrivateUrlSignature(cleanPath: string, expires: number, signature: string): boolean {
    if (expires < Math.floor(Date.now() / 1000)) return false;
    const expected = this.hmac(`${cleanPath}${expires}`);
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private hmac(data: string): string {
    const key = this.cdnTokenKey || 'dev-cdn-token-key';
    return createHmac('sha256', key).update(data).digest('hex');
  }

  private simulated(method: string, key: string, ttlSec: number): PresignPutResult {
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
    return {
      url: `https://memory.local/${this.bucket}/${key}?method=${method}&X-Simulated-Expiry=${encodeURIComponent(expiresAt)}`,
      key,
      expiresAt,
    };
  }
}

/** Construit une clé objet unique sous un préfixe donné (préfixe = namespace métier). */
export function buildObjectKey(prefix: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${prefix.replace(/^\/+|\/+$/g, '')}/${randomUUID()}-${safe}`;
}
