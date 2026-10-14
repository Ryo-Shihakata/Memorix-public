import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, SessionUser } from '../env';
import { apiError } from '../lib/errors';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionData, sessionKey } from '../lib/session';

// Cookie → KV → users を引き、c.set('user', ...) する。
// banned_at 非NULLなら KV セッションを削除して 403 BANNED（§5.1）。
// 未ログインはエラーにせず user=null で通す（各ルートで requireAuth）。
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', null);
  c.set('sessionId', null);

  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) {
    const key = sessionKey(sessionId);
    const session = await c.env.KV.get<SessionData>(key, 'json');
    if (session) {
      const user = await c.env.DB.prepare(
        'SELECT id, email, name, avatar_url, role, banned_at FROM users WHERE id = ?',
      )
        .bind(session.userId)
        .first<SessionUser>();
      if (user) {
        if (user.banned_at !== null) {
          await c.env.KV.delete(key);
          return apiError(c, 403, 'BANNED', 'このアカウントは利用停止されています。');
        }
        // スライディング TTL: アクセスごとに 30 日へ再設定
        await c.env.KV.put(key, JSON.stringify(session), {
          expirationTtl: SESSION_TTL_SECONDS,
        });
        c.set('user', user);
        c.set('sessionId', sessionId);
      }
    }
  }

  await next();
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) {
    return apiError(c, 401, 'UNAUTHORIZED', 'ログインが必要です。');
  }
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return apiError(c, 401, 'UNAUTHORIZED', 'ログインが必要です。');
  }
  if (user.role !== 'admin') {
    return apiError(c, 403, 'FORBIDDEN', 'この操作を行う権限がありません。');
  }
  await next();
});

export type TeamRole = 'owner' | 'editor' | 'viewer';

const ROLE_RANK: Record<TeamRole, number> = { viewer: 1, editor: 2, owner: 3 };

// パスの :teamId と現ユーザーで team_members を引き、viewer < editor < owner で比較（§5.2）。
// service admin はすべてのチームで owner 相当。
export function requireTeamRole(minRole: TeamRole) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return apiError(c, 401, 'UNAUTHORIZED', 'ログインが必要です。');
    }
    if (user.role === 'admin') {
      return next();
    }
    const teamId = c.req.param('teamId');
    if (!teamId) {
      return apiError(c, 404, 'NOT_FOUND', 'チームが見つかりません。');
    }
    const member = await c.env.DB.prepare(
      'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    )
      .bind(teamId, user.id)
      .first<{ role: TeamRole }>();
    if (!member || ROLE_RANK[member.role] < ROLE_RANK[minRole]) {
      return apiError(c, 403, 'FORBIDDEN', 'このチームでの権限がありません。');
    }
    await next();
  });
}
