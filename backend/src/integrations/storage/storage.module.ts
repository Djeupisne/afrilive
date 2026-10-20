import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Module stockage objet (S3/R2/MinIO ou mémoire). Exporte StorageService globalement aux modules métier. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}