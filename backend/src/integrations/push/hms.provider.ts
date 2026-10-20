import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

interface HmsTokenCache { value: string; expiresAt: number }

export interface HmsSendResult {
  ok: string[];
  invalid: string[];
}

/**
 * Huawei Push Kit (HMS) — API HTTP OAuth2 client_credentials + POST send.
 * Désactivé proprement si HMS_APP_ID / HMS_CLIENT_SECRET absents.
 */
@Injectable()
export class HmsProvider {
  private readonly logger = new Logger(HmsProvider.name);
  private readonly oauthUrl = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
  private readonly pushUrlBase = 'https://push-api.cloud.huawei.com/v1';
  private token: HmsTokenCache | null = null;

  private get appId(): string { return process.env.HMS_APP_ID ?? ''; }
  private get clientId(): string { return process.env.HMS_CLIENT_ID ?? ''; }
  private get clientSecret(): string { return process.env.HMS_CLIENT_SECRET ?? ''; }

  get enabled(): boolean {
    return this.appId !== '' && this.clientId !== '' && this.clientSecret !== '';
  }

  async sendToTokens(tokens: string[], title: string, body: string, data: Record<string, string> = {}): Promise<HmsSendResult> {
    if (!this.enabled) {
      this.logger.log(`[HMS console] (${tokens.length} tokens) ${title} — ${body}`);
      return { ok: tokens, invalid: [] };
    }
    try {
      const accessToken = await this.getAccessToken();
      const res = await axios.post(
        `${this.pushUrlBase}/${this.appId}/messages:send`,
        {
          message: {
            notification: { title, body },
            tokens,
            android: { data },
          },
        },
        {
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          timeout: 8_000,
        },
      );
      const code = res.data?.code;
      const msg = String(res.data?.msg ?? '');
      if (code === '80000000' || code === '80600004') {
        // 80600004 : certaines cibles invalides — subCodes 5xx/8xx listent les tokens morts.
        const invalidSubs = Array.isArray(res.data?.subTasks) ? res.data.subTasks : [];
        const invalid: string[] = [];
        for (const t of invalidSubs) {
          const sub = String(t?.taskResult?.recipient ?? '');
          const errCode = Number(t?.taskResult?.error?.code ?? 0);
          if (sub && [5, 8].some((p) => String(errCode).startsWith(String(p)))) invalid.push(sub);
        }
        return { ok: tokens.filter((tk) => !invalid.includes(tk)), invalid };
      }
      if (code === '80100003' || code === '80200005') {
        // Token de registration invalide/expiré pour toutes les cibles.
        return { ok: [], invalid: tokens };
      }
      this.logger.warn(`HMS réponse inattendue : ${code} ${msg}`);
      return { ok: [], invalid: [] };
    } catch (err) {
      this.logger.error(`Erreur HMS : ${err instanceof AxiosError ? `${err.response?.status} ${err.message}` : String(err)}`);
      return { ok: [], invalid: [] };
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 30_000) return this.token.value;
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const res = await axios.post<{ access_token: string; expires_in: number }>(this.oauthUrl, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 8_000,
    });
    this.token = { value: res.data.access_token, expiresAt: now + res.data.expires_in * 1000 };
    return this.token.value;
  }
}
