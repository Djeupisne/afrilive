import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

export interface FcmSendResult {
  ok: string[];   // tokens joints
  invalid: string[]; // tokens à purger (UNREGISTERED / SENDER_ID_MISMATCH)
}

/**
 * Firebase Cloud Messaging — couvre Android (FCM), iOS (APNs via FCM) et Web push.
 * Désactivé proprement si FIREBASE_CREDENTIALS_JSON est absent : `enabled=false`,
 * les envois deviennent des no-ops journalisés (mode console).
 */
@Injectable()
export class FcmProvider {
  private readonly logger = new Logger(FcmProvider.name);
  private messaging: admin.messaging.Messaging | null = null;

  constructor() {
    const raw = process.env.FIREBASE_CREDENTIALS_JSON ?? '';
    if (!raw) return;
    try {
      const credential = JSON.parse(raw);
      if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(credential as admin.ServiceAccount) });
      }
      this.messaging = admin.messaging();
    } catch (err) {
      this.logger.error(`Initialisation FCM impossible : ${String(err)}`);
      this.messaging = null;
    }
  }

  get enabled(): boolean {
    return this.messaging !== null;
  }

  /** Envoi multi-tokens (jusqu'à 500) ; renvoie la liste des tokens invalides à supprimer. */
  async sendToTokens(tokens: string[], title: string, body: string, data: Record<string, string> = {}): Promise<FcmSendResult> {
    if (!this.messaging) {
      this.logger.log(`[FCM console] (${tokens.length} tokens) ${title} — ${body}`);
      return { ok: tokens, invalid: [] };
    }
    const res = await this.messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      apns: { payload: { aps: { sound: 'default' } } },
    });
    const invalid: string[] = [];
    res.responses.forEach((r, i) => {
      if (r.success) return;
      const code = (r.error as { code?: string } | undefined)?.code ?? '';
      if (code.includes('UNREGISTERED') || code.includes('SENDER_ID_MISMATCH') || String(r.error?.message).includes('NotRegistered')) {
        invalid.push(tokens[i]);
      } else {
        this.logger.warn(`FCM échec non-définitif pour ${tokens[i]} : ${r.error?.message}`);
      }
    });
    return { ok: res.responses.filter((r) => r.success).map((_, i) => tokens[i]), invalid };
  }
}
