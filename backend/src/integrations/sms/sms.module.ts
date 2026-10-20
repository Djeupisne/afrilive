import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsService } from './sms.service';
import { TermiiProvider } from './termii.provider';
import { AfricasTalkingProvider } from './africastalking.provider';

/** Module SMS : service + fournisseurs Termii / Africa's Talking. */
@Module({
  imports: [ConfigModule],
  providers: [SmsService, TermiiProvider, AfricasTalkingProvider],
  exports: [SmsService],
})
export class SmsModule {}
