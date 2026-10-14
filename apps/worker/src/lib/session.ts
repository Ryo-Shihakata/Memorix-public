import { randomHex } from './id';

export const SESSION_COOKIE = '__Host-sess';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30日（アクセスごとに延長）

export interface SessionData {
  userId: string;
}

export function sessionKey(sessionId: string): string {
  return `sess:${sessionId}`;
}

// セッション発行: 32byte ランダム hex（§5.1 手順5）
export async function createSession(kv: KVNamespace, userId: string): Promise<string> {
  const sessionId = randomHex(32);
  await kv.put(sessionKey(sessionId), JSON.stringify({ userId } satisfies SessionData), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return sessionId;
}

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
