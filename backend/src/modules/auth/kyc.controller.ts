import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UploadKycDto } from './dto/auth.dto';
import { KycService } from './kyc.service';

@ApiTags('kyc')
@ApiBearerAuth()
@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Post('upload-url')
  @ApiOperation({ summary: 'URL S3 présignée pour téléverser un document KYC (PUT direct)' })
  uploadUrl(@CurrentUser('id') userId: string, @Body() dto: { type: string; contentType?: string }) {
    return this.kyc.createUploadUrl(userId, dto.type, dto.contentType ?? 'image/jpeg');
  }

  @Post()
  @ApiOperation({ summary: 'Soumettre le document téléversé (statut PENDING)' })
  submit(@CurrentUser('id') userId: string, @Body() dto: UploadKycDto) {
    return this.kyc.submit(userId, dto.type, dto.fileKey);
  }

  @Get()
  @ApiOperation({ summary: 'Statut KYC courant (global + par type de document)' })
  status(@CurrentUser('id') userId: string) {
    return this.kyc.getStatus(userId);
  }
}
