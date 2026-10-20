import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

/** Module e-mail (SMTP nodemailer ou mode console). */
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
