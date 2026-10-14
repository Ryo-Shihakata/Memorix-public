import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';
import type { Env } from '../env';

export type Provider = 'google' | 'microsoft';

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  // Microsoft は iss がテナントごとに変わるため iss 完全一致検証をしない（§5.1）。
  // aud と署名（+ exp）で担保する。Google のみ issuer を検証する。
  issuer?: string[];
}

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    jwksUrl: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  },
};

export function isProvider(value: string): value is Provider {
  return value === 'google' || value === 'microsoft';
}

export function clientCredentials(env: Env, provider: Provider): { id: string; secret: string } {
  return provider === 'google'
    ? { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }
    : { id: env.MS_CLIENT_ID, secret: env.MS_CLIENT_SECRET };
}

export class OAuthError extends Error {}

// Authorization Code を token エンドポイントで交換し id_token を返す
export async function exchangeCode(
  provider: Provider,
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch(PROVIDERS[provider].tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new OAuthError(`token endpoint returned ${res.status}`);
  }
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) {
    throw new OAuthError('token response has no id_token');
  }
  return data.id_token;
}

// id_token を jose で検証（署名 + aud + exp。Microsoft は iss を検証しない）
export async function verifyIdToken(
  provider: Provider,
  idToken: string,
  clientId: string,
): Promise<JWTPayload> {
  const cfg = PROVIDERS[provider];
  const jwks = createRemoteJWKSet(new URL(cfg.jwksUrl));
  const { payload } = await jwtVerify(idToken, jwks, {
    audience: clientId,
    ...(cfg.issuer ? { issuer: cfg.issuer } : {}),
  });
  return payload;
}

export interface OAuthClaims {
  sub: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// claims から sub/email/name/picture を取り出す。
// email が無ければ preferred_username が email 形式なら採用（§5.1 手順3）。
export function extractClaims(payload: JWTPayload): OAuthClaims {
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  let email: string | null = null;
  if (typeof payload.email === 'string' && EMAIL_RE.test(payload.email)) {
    email = payload.email.trim().toLowerCase();
  } else if (
    typeof payload.preferred_username === 'string' &&
    EMAIL_RE.test(payload.preferred_username)
  ) {
    email = payload.preferred_username.trim().toLowerCase();
  }
  const name =
    typeof payload.name === 'string' && payload.name.trim() !== ''
      ? payload.name.trim()
      : (email?.split('@')[0] ?? '');
  const avatarUrl = typeof payload.picture === 'string' ? payload.picture : null;
  return { sub, email, name, avatarUrl };
}
