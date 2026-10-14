import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { apiError } from './errors';

// §11 レートリミット: KV 固定ウィンドウカウンタ。
// キー rl:{bucket}:{key}:{floor(now/window)}、TTL=window×2。KV は結果整合なので
// 厳密性は求めない（防御目的で十分）。

export interface RateLimitConfig {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

const HOUR = 3600;
const DAY = 24 * 3600;

// §11 の全バケット定義（invite_accept 以外は後続チャンクで使用）
export const RATE_LIMITS = {
  share: { bucket: 'share', limit: 30, windowSeconds: HOUR },
  session: { bucket: 'session', limit: 60, windowSeconds: HOUR },
  report: { bucket: 'report', limit: 5, windowSeconds: DAY },
  upload: { bucket: 'upload', limit: 60, windowSeconds: DAY },
  inviteAccept: { bucket: 'invite_accept', limit: 20, windowSeconds: HOUR },
} as const satisfies Record<string, RateLimitConfig>;

// カウントを進め、上限内なら true
export async function checkRateLimit(
  kv: KVNamespace,
  cfg: RateLimitConfig,
  key: string,
): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / 1000 / cfg.windowSeconds);
  const kvKey = `rl:${cfg.bucket}:${key}:${windowStart}`;
  const current = Number((await kv.get(kvKey)) ?? '0');
  if (current >= cfg.limit) {
    return false;
  }
  await kv.put(kvKey, String(current + 1), { expirationTtl: cfg.windowSeconds * 2 });
  return true;
}

export function clientIp(c: Context): string {
  return c.req.header('CF-Connecting-IP') ?? 'unknown';
}

// keyFn 省略時は IP キー（upload バケット等は teamId を返す keyFn を渡す）
export function rateLimit(cfg: RateLimitConfig, keyFn: (c: Context) => string = clientIp) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ok = await checkRateLimit(c.env.KV, cfg, keyFn(c));
    if (!ok) {
      return apiError(
        c,
        429,
        'RATE_LIMITED',
        'リクエストが多すぎます。しばらく待ってから再試行してください。',
      );
    }
    await next();
  });
}
