import type { TeamMember } from '@memorix/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { getPagination, pageResult } from '../../lib/pagination';
import { zv } from '../../lib/validate';
import { requireAuth, requireTeamRole } from '../../middleware/session';

const patchRoleSchema = z.object({
  role: z.enum(['owner', 'editor', 'viewer']),
});

interface MemberRow {
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: 'owner' | 'editor' | 'viewer';
  created_at: string;
}

async function ownerCount(db: D1Database, teamId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'owner'")
    .bind(teamId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const members = new Hono<AppEnv>();

// GET .../members: viewer 以上（§7.5）
members.get('/', requireTeamRole('viewer'), async (c) => {
  const teamId = c.req.param('teamId');
  const p = getPagination(c);
  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?')
    .bind(teamId)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT tm.user_id, u.name, u.email, u.avatar_url, tm.role, tm.created_at
     FROM team_members tm JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ?
     ORDER BY tm.created_at, tm.user_id
     LIMIT ? OFFSET ?`,
  )
    .bind(teamId, p.perPage, p.offset)
    .all<MemberRow>();

  const items: TeamMember[] = results.map((m) => ({
    userId: m.user_id,
    name: m.name,
    email: m.email,
    avatarUrl: m.avatar_url,
    role: m.role,
    createdAt: m.created_at,
  }));
  return c.json(pageResult(items, total?.n ?? 0, p));
});

// PATCH .../members/:userId: owner。{role}（LAST_OWNER 検査）
members.patch('/:userId', requireTeamRole('owner'), zv('json', patchRoleSchema), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const targetUserId = c.req.param('userId');
  const { role } = c.req.valid('json');

  const target = await c.env.DB.prepare(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
  )
    .bind(teamId, targetUserId)
    .first<{ role: string }>();
  if (!target) {
    return apiError(c, 404, 'NOT_FOUND', 'メンバーが見つかりません。');
  }

  if (target.role === 'owner' && role !== 'owner' && (await ownerCount(c.env.DB, teamId)) <= 1) {
    return apiError(c, 400, 'LAST_OWNER', '最後のオーナーは降格できません。');
  }

  await c.env.DB.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?')
    .bind(role, teamId, targetUserId)
    .run();
  return c.json({ userId: targetUserId, role });
});

// DELETE .../members/:userId: owner または本人（脱退）。
// 個人チーム owner の脱退不可・最後の owner は 400 LAST_OWNER（§6 補足）
members.delete('/:userId', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const teamId = c.req.param('teamId') ?? '';
  const targetUserId = c.req.param('userId');

  const isSelf = user.id === targetUserId;
  if (!isSelf && user.role !== 'admin') {
    const requester = await c.env.DB.prepare(
      'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    )
      .bind(teamId, user.id)
      .first<{ role: string }>();
    if (requester?.role !== 'owner') {
      return apiError(c, 403, 'FORBIDDEN', 'このチームでの権限がありません。');
    }
  }

  const target = await c.env.DB.prepare(
    `SELECT tm.role, t.is_personal FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.team_id = ? AND tm.user_id = ?`,
  )
    .bind(teamId, targetUserId)
    .first<{ role: string; is_personal: number }>();
  if (!target) {
    return apiError(c, 404, 'NOT_FOUND', 'メンバーが見つかりません。');
  }

  if (target.role === 'owner') {
    if (target.is_personal === 1) {
      return apiError(c, 400, 'VALIDATION', '個人チームのオーナーは脱退できません。');
    }
    if ((await ownerCount(c.env.DB, teamId)) <= 1) {
      return apiError(c, 400, 'LAST_OWNER', '最後のオーナーは脱退・削除できません。');
    }
  }

  await c.env.DB.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?')
    .bind(teamId, targetUserId)
    .run();
  return c.body(null, 204);
});

export default members;
