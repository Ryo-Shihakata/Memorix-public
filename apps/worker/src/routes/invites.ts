import { LIMITS } from '@memorix/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { RATE_LIMITS, rateLimit } from '../lib/rateLimit';
import { requireAuth } from '../middleware/session';

interface InviteTokenRow {
  id: string;
  team_id: string;
  role: 'editor' | 'viewer';
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  expired: number; // expires_at <= CURRENT_TIMESTAMP
  team_name: string;
}

// token で招待を引き、期限/回数/失効を検査（§7.5）。
// 不正時はエラーレスポンスを返し、有効なら行を返す。
async function findValidInvite(
  c: Context<AppEnv>,
  token: string,
): Promise<InviteTokenRow | Response> {
  const row = await c.env.DB.prepare(
    `SELECT i.id, i.team_id, i.role, i.max_uses, i.use_count, i.revoked_at,
            (i.expires_at <= CURRENT_TIMESTAMP) AS expired, t.name AS team_name
     FROM team_invites i JOIN teams t ON t.id = i.team_id
     WHERE i.token = ?`,
  )
    .bind(token)
    .first<InviteTokenRow>();

  if (!row) {
    return apiError(c, 404, 'NOT_FOUND', '招待リンクが見つかりません。');
  }
  if (row.revoked_at !== null) {
    return apiError(c, 400, 'VALIDATION', 'この招待リンクは失効しています。');
  }
  if (row.expired === 1) {
    return apiError(c, 400, 'VALIDATION', 'この招待リンクは有効期限が切れています。');
  }
  if (row.max_uses !== null && row.use_count >= row.max_uses) {
    return apiError(c, 400, 'VALIDATION', 'この招待リンクは使用回数の上限に達しています。');
  }
  return row;
}

const invites = new Hono<AppEnv>();

// GET /api/invites/:token: 招待プレビュー {teamName, role}（未ログインでも可）
invites.get('/:token', async (c) => {
  const result = await findValidInvite(c, c.req.param('token'));
  if (result instanceof Response) return result;
  return c.json({ teamName: result.team_name, role: result.role });
});

// POST /api/invites/:token/accept: 要ログイン。RL: 20回/時/IP（§11）
invites.post('/:token/accept', rateLimit(RATE_LIMITS.inviteAccept), requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');

  const result = await findValidInvite(c, c.req.param('token'));
  if (result instanceof Response) return result;

  const existing = await c.env.DB.prepare(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
  )
    .bind(result.team_id, user.id)
    .first();
  if (existing) {
    return apiError(c, 409, 'CONFLICT', 'すでにこのチームのメンバーです。');
  }

  const memberCount = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?',
  )
    .bind(result.team_id)
    .first<{ n: number }>();
  if ((memberCount?.n ?? 0) >= LIMITS.MEMBERS_PER_TEAM) {
    return apiError(
      c,
      403,
      'QUOTA_EXCEEDED',
      `チームのメンバーは${LIMITS.MEMBERS_PER_TEAM}人までです。`,
    );
  }

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').bind(
      result.team_id,
      user.id,
      result.role,
    ),
    c.env.DB.prepare('UPDATE team_invites SET use_count = use_count + 1 WHERE id = ?').bind(
      result.id,
    ),
  ]);

  return c.json({ teamId: result.team_id, role: result.role });
});

export default invites;
