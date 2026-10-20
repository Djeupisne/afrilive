import { createPublicKey, verify as cryptoVerify } from 'crypto';

export interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

/** Conversion d'une JWK RSA (n/e base64url) en clé publique PEM via ASN.1 DER. */
function jwkRsaToPem(jwk: Jwk): string {
  if (jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
    throw new Error('JWK non-RSA ignorée.');
  }
  const b64 = (s: string): Buffer => Buffer.from(s, 'base64url');
  const derLen = (content: Buffer): Buffer => {
    if (content.length < 0x80) return Buffer.from([content.length]);
    const hex = content.length.toString(16);
    const bytes = Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, 'hex');
    return Buffer.from([0x80 + bytes.length, ...bytes]);
  };
  const seq = (content: Buffer): Buffer => Buffer.concat([Buffer.from([0x30]), derLen(content), content]);
  const toDerInt = (buf: Buffer): Buffer => {
    const stripped = buf[0] >= 0x80 ? Buffer.concat([Buffer.from([0x00]), buf]) : buf;
    return Buffer.concat([Buffer.from([0x02]), derLen(stripped), stripped]);
  };
  const rsaSeq = seq(Buffer.concat([toDerInt(b64(jwk.n)), toDerInt(b64(jwk.e))]));
  const algorithmId = Buffer.from('300d06092a864886f70d0101010500', 'hex');
  const bitStringContent = Buffer.concat([Buffer.from([0x00]), rsaSeq]);
  const bitString = Buffer.concat([Buffer.from([0x03]), derLen(bitStringContent), bitStringContent]);
  const outer = seq(Buffer.concat([algorithmId, bitString]));
  return `-----BEGIN PUBLIC KEY-----\n${outer.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`;
}

/** Décode un JWT sans vérifier (parties header/payload uniquement). */
export function decodeJwtParts(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Buffer } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Jeton JWT invalide (3 parties attendues).');
  const b64 = (s: string) => Buffer.from(s, 'base64url');
  return {
    header: JSON.parse(b64(parts[0]).toString('utf8')),
    payload: JSON.parse(b64(parts[1]).toString('utf8')),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: b64(parts[2]),
  };
}

/** Vérifie la signature RS256 du JWT contre l'un des JWKS fournis (matching par kid). */
export function verifyRs256(token: string, jwks: Jwk[], expectedKid?: string): void {
  const { header, signingInput, signature } = decodeJwtParts(token);
  const kid = (header.kid as string | undefined) ?? expectedKid;
  const candidates = kid ? jwks.filter((j) => j.kid === kid) : jwks;
  if (candidates.length === 0) throw new Error('Aucune clé JWKS ne correspond au kid du jeton.');
  let lastErr: Error | null = null;
  for (const jwk of candidates) {
    try {
      const key = createPublicKey(jwkRsaToPem(jwk));
      const ok = cryptoVerify('RSA-SHA256', Buffer.from(signingInput), key, signature);
      if (ok) return;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error('Signature JWT invalide.');
}

/** Contrôles standards d'un id_token : aud, iss, exp (+nonce optionnel). */
export function assertIdTokenClaims(
  payload: Record<string, unknown>,
  opts: { issuer: string | RegExp; audience: string; nonce?: string },
): void {
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('id_token expiré.');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new Error('id_token iat dans le futur.');
  const issOk = typeof opts.issuer === 'string' ? payload.iss === opts.issuer : opts.issuer.test(String(payload.iss));
  if (!issOk) throw new Error('id_token issuer inattendu.');
  const aud = Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud)];
  if (!aud.includes(opts.audience)) throw new Error('id_token audience inattendue.');
  if (opts.nonce !== undefined && payload.nonce !== opts.nonce) throw new Error('id_token nonce mismatch.');
}
