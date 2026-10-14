import type { Team } from '@memorix/shared';
import { LIMITS } from '@memorix/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { newId } from '../../lib/id';
import { zv } from '../../lib/validate';
import { requireAuth, requireTeamRole } from '../../middleware/session';
import { teamFollow, teamProfile } from '../social';
import csv from './csv';
import folders from './folders';
import images from './images';
import invites from './invites';
import members from './members';
import questions from './questions';
import quizzes from './quizzes';
import stats from './stats';

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  avatar_image_id: string | null;
  is_personal: number;
  storage_used_bytes: number;
  follower_count: number;
  created_at: string;
  updated_at: string;
}

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    avatarImageId: row.avatar_image_id,
    isPersonal: row.is_personal === 1,
    storageUsedBytes: row.storage_used_bytes,
    followerCount: row.follower_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TEAM_COLUMNS =
  'id, name, description, avatar_image_id, is_personal, storage_used_bytes, follower_count, created_at, updated_at';

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.TITLE_MAX_LEN),
  description: z.string().max(LIMITS.DESCRIPTION_MAX_LEN).optional(),
});

const patchTeamSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.TITLE_MAX_LEN).optional(),
  description: z.string().max(LIMITS.DESCRIPTION_MAX_LEN).nullable().optional(),
  avatarImageId: z.string().length(32).nullable().optional(),
});

const teams = new Hono<AppEnv>();

// POST /api/teams: owner として作成（§7.5）。所有チーム上限 10（§4.2）
teams.post('/', requireAuth, zv('json', createTeamSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const { name, description } = c.req.valid('json');

  const owned = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM team_members WHERE user_id = ? AND role = 'owner'",
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((owned?.n ?? 0) >= LIMITS.OWNED_TEAMS_PER_USER) {
    return apiError(
      c,
      403,
      'QUOTA_EXCEEDED',
      `所有できるチームは${LIMITS.OWNED_TEAMS_PER_USER}個までです。`,
    );
  }

  const teamId = newId();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO teams (id, name, description) VALUES (?, ?, ?)').bind(
      teamId,
      name,
      description ?? null,
    ),
    c.env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')",
    ).bind(teamId, user.id),
  ]);

  const row = await c.env.DB.prepare(`SELECT ${TEAM_COLUMNS} FROM teams WHERE id = ?`)
    .bind(teamId)
    .first<TeamRow>();
  if (!row) throw new Error('team insert failed');
  return c.json(toTeam(row), 201);
});

// GET /api/teams/:teamId: メンバーなら詳細（storageUsedBytes 含む）
teams.get('/:teamId', requireTeamRole('viewer'), async (c) => {
  const row = await c.env.DB.prepare(`SELECT ${TEAM_COLUMNS} FROM teams WHERE id = ?`)
    .bind(c.req.param('teamId'))
    .first<TeamRow>();
  if (!row) {
    return apiError(c, 404, 'NOT_FOUND', 'チームが見つかりません。');
  }
  return c.json(toTeam(row));
});

// PATCH /api/teams/:teamId: owner。name/description/avatarImageId
teams.patch('/:teamId', requireTeamRole('owner'), zv('json', patchTeamSchema), async (c) => {
  const teamId = c.req.param('teamId');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare('SELECT id FROM teams WHERE id = ?').bind(teamId).first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'チームが見つかりません。');
  }

  if (body.avatarImageId) {
    const image = await c.env.DB.prepare('SELECT id FROM images WHERE id = ? AND team_id = ?')
      .bind(body.avatarImageId, teamId)
      .first();
    if (!image) {
      return apiError(c, 400, 'VALIDATION', '指定された画像が見つかりません。');
    }
  }

  const sets: string[] = [];
  const binds: (string | null)[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    binds.push(body.name);
  }
  if (body.description !== undefined) {
    sets.push('description = ?');
    binds.push(body.description);
  }
  if (body.avatarImageId !== undefined) {
    sets.push('avatar_image_id = ?');
    binds.push(body.avatarImageId);
  }
  if (sets.length > 0) {
    await c.env.DB.prepare(
      `UPDATE teams SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(...binds, teamId)
      .run();
  }

  const row = await c.env.DB.prepare(`SELECT ${TEAM_COLUMNS} FROM teams WHERE id = ?`)
    .bind(teamId)
    .first<TeamRow>();
  if (!row) throw new Error('unreachable');
  return c.json(toTeam(row));
});

// DELETE /api/teams/:teamId: owner。is_personal は 400（§6 補足）
teams.delete('/:teamId', requireTeamRole('owner'), async (c) => {
  const teamId = c.req.param('teamId');
  const team = await c.env.DB.prepare('SELECT is_personal FROM teams WHERE id = ?')
    .bind(teamId)
    .first<{ is_personal: number }>();
  if (!team) {
    return apiError(c, 404, 'NOT_FOUND', 'チームが見つかりません。');
  }
  if (team.is_personal === 1) {
    return apiError(c, 400, 'VALIDATION', '個人チームは削除できません。');
  }
  await c.env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(teamId).run();
  return c.body(null, 204);
});

teams.route('/:teamId/members', members);
teams.route('/:teamId/invites', invites);
teams.route('/:teamId/folders', folders);
teams.route('/:teamId/quiz-sets', quizzes);
teams.route('/:teamId/quiz-sets', csv);
teams.route('/:teamId/quiz-sets', stats);
teams.route('/:teamId/questions', questions);
teams.route('/:teamId/images', images);
teams.route('/:teamId/profile', teamProfile);
teams.route('/:teamId/follow', teamFollow);

export default teams;
