import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface EmailSendParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Service e-mail : SMTP via nodemailer si EMAIL_MODE=real, sinon mode console
 * (le message est journalisé, aucun serveur contacté). Transport créé à la demande.
 */
@Injectable()
export class EmailService implements OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private get mode(): string {
    return this.config.get<string>('app.modes.email') ?? 'console';
  }

  private get fromAddress(): string {
    return process.env.MAIL_FROM ?? 'AfriLive <no-reply@afrilive.app>';
  }

  async send(params: EmailSendParams): Promise<void> {
    if (this.mode === 'console') {
      this.logger.log(`[Email console] -> ${params.to} | ${params.subject} | ${params.text.slice(0, 200)}`);
      return;
    }
    const transporter = this.getTransporter();
    await transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
  }

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;
    const host = process.env.SMTP_HOST ?? '';
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER ?? '';
    const pass = process.env.SMTP_PASS ?? '';
    if (!host) {
      throw new Error('EMAIL_MODE=real mais SMTP_HOST est absent.');
    }
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
    });
    return this.transporter;
  }

  onModuleDestroy(): void {
    // nodemailer n'a pas de fermeture explicite obligatoire ; on lâche la référence.
    this.transporter = null;
  }
}
