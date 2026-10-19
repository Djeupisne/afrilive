import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Module Prisma global : un seul client partagé par toute l'app. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
