import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { newId } from '../../lib/id';
import { getPagination, pageResult } from '../../lib/pagination';
import { zv } from '../../lib/validate';
import { requireTeamRole } from '../../middleware/session';

const MAX_EXPIRES_HOURS = 720;

const createInviteSchema = z.object({
  role: z.enum(['editor', 'viewer']),
  expiresInHours: z.number().int().min(1).max(MAX_EXPIRES_HOURS),
  maxUses: z.number().int().min(1).optional(),
});

// token は crypto.randomUUID() を2連結し '-' 除去（§3）
function newInviteToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '');
}

interface InviteRow {
  id: string;
  role: 'editor' | 'viewer';
  token: string;
  expires_at: string;
  max_uses: number | null;
  use_count: number;
  created_at: string;
}

const invites = new Hono<AppEnv>();

// POST .../invites: owner。{role, expiresInHours(≤720), maxUses?} → {url}（§7.5）
invites.post('/', requireTeamRole('owner'), zv('json', createInviteSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const teamId = c.req.param('teamId');
  const { role, expiresInHours, maxUses } = c.req.valid('json');

  const team = await c.env.DB.prepare('SELECT id FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) {
    return apiError(c, 404, 'NOT_FOUND', 'チームが見つかりません。');
  }

  const token = newInviteToken();
  await c.env.DB.prepare(
    `INSERT INTO team_invites (id, team_id, token, role, expires_at, max_uses, created_by)
     VALUES (?, ?, ?, ?, datetime('now', ?), ?, ?)`,
  )
    .bind(newId(), teamId, token, role, `+${expiresInHours} hours`, maxUses ?? null, user.id)
    .run();

  return c.json({ url: `${c.env.APP_ORIGIN}/invites/${token}` }, 201);
});

// GET .../invites: owner。有効な招待一覧（失効・期限切れ・回数超過を除く）
invites.get('/', requireTeamRole('owner'), async (c) => {
  const teamId = c.req.param('teamId');
  const p = getPagination(c);
  const validCond = `team_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     AND (max_uses IS NULL OR use_count < max_uses)`;

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM team_invites WHERE ${validCond}`)
    .bind(teamId)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT id, role, token, expires_at, max_uses, use_count, created_at
     FROM team_invites WHERE ${validCond}
     ORDER BY created_at DESC, id
     LIMIT ? OFFSET ?`,
  )
    .bind(teamId, p.perPage, p.offset)
    .all<InviteRow>();

  const items = results.map((r) => ({
    id: r.id,
    role: r.role,
    url: `${c.env.APP_ORIGIN}/invites/${r.token}`,
    expiresAt: r.expires_at,
    maxUses: r.max_uses,
    useCount: r.use_count,
    createdAt: r.created_at,
  }));
  return c.json(pageResult(items, total?.n ?? 0, p));
});

// DELETE .../invites/:id: owner（失効）
invites.delete('/:inviteId', requireTeamRole('owner'), async (c) => {
  const teamId = c.req.param('teamId');
  const inviteId = c.req.param('inviteId');
  const invite = await c.env.DB.prepare('SELECT id FROM team_invites WHERE id = ? AND team_id = ?')
    .bind(inviteId, teamId)
    .first();
  if (!invite) {
    return apiError(c, 404, 'NOT_FOUND', '招待が見つかりません。');
  }
  await c.env.DB.prepare('UPDATE team_invites SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(inviteId)
    .run();
  return c.body(null, 204);
});

export default invites;
