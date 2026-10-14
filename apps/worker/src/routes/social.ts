import type { TeamProfile } from '@memorix/shared';
import { LIMITS } from '@memorix/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import {
  checkPublicQuizAccess,
  fetchQuizSetRow,
  QUIZ_SET_COLUMNS,
  QUIZ_SET_FROM,
  type QuizSetRow,
  toQuizSetSummary,
} from '../lib/quizAccess';
import { zv } from '../lib/validate';
import { requireAuth } from '../middleware/session';

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  avatar_image_id: string | null;
  follower_count: number;
}

// GET /api/teams/:teamId/profile: 認証不要。{team(公開情報のみ), followerCount, publicQuizzes[]}（§7.2）
export const teamProfile = new Hono<AppEnv>();

teamProfile.get('/', async (c) => {
  const teamId = c.req.param('teamId');
  const team = await c.env.DB.prepare(
    'SELECT id, name, description, avatar_image_id, follower_count FROM teams WHERE id = ?',
  )
    .bind(teamId)
    .first<TeamRow>();
  if (!team) {
    return apiError(c, 404, 'NOT_FOUND', 'チームが見つかりません。');
  }

  const { results } = await c.env.DB.prepare(
    `SELECT ${QUIZ_SET_COLUMNS} ${QUIZ_SET_FROM}
     WHERE qs.team_id = ? AND qs.visibility = 'public' AND qs.suspended_at IS NULL
     ORDER BY qs.published_at DESC, qs.id`,
  )
    .bind(teamId)
    .all<QuizSetRow>();

  const body: TeamProfile = {
    team: {
      id: team.id,
      name: team.name,
      description: team.description,
      avatarImageId: team.avatar_image_id,
    },
    followerCount: team.follower_count,
    publicQuizzes: results.map(toQuizSetSummary),
  };
  return c.json(body);
});

// PUT/DELETE /api/teams/:teamId/follow: 要ログイン。204（冪等）。follower_count を増減（§7.4）
export const teamFollow = new Hono<AppEnv>();

teamFollow.put('/', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const teamId = c.req.param('teamId');

  const team = await c.env.DB.prepare('SELECT id FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) {
    return apiError(c, 404, 'NOT_FOUND', 'チームが見つかりません。');
  }

  const existing = await c.env.DB.prepare('SELECT 1 FROM follows WHERE user_id = ? AND team_id = ?')
    .bind(user.id, teamId)
    .first();
  if (!existing) {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO follows (user_id, team_id) VALUES (?, ?)').bind(
        user.id,
        teamId,
      ),
      c.env.DB.prepare('UPDATE teams SET follower_count = follower_count + 1 WHERE id = ?').bind(
        teamId,
      ),
    ]);
  }
  return c.body(null, 204);
});

teamFollow.delete('/', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const teamId = c.req.param('teamId');

  const existing = await c.env.DB.prepare('SELECT 1 FROM follows WHERE user_id = ? AND team_id = ?')
    .bind(user.id, teamId)
    .first();
  if (existing) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM follows WHERE user_id = ? AND team_id = ?').bind(
        user.id,
        teamId,
      ),
      c.env.DB.prepare(
        'UPDATE teams SET follower_count = MAX(follower_count - 1, 0) WHERE id = ?',
      ).bind(teamId),
    ]);
  }
  return c.body(null, 204);
});

// PUT/DELETE /api/quiz-sets/:id/bookmark: 要ログイン。body {folderId?}（§7.4）
export const quizBookmark = new Hono<AppEnv>();

const bookmarkSchema = z.object({
  folderId: z.string().length(32).nullable().optional(),
});

quizBookmark.put('/:id/bookmark', requireAuth, zv('json', bookmarkSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const quizSetId = c.req.param('id');
  const { folderId } = c.req.valid('json');

  const row = await fetchQuizSetRow(c.env.DB, quizSetId);
  if (!row) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  const access = await checkPublicQuizAccess(c.env.DB, row, user);
  if (access === 'not_found') {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }

  if (folderId) {
    const folder = await c.env.DB.prepare(
      'SELECT id FROM bookmark_folders WHERE id = ? AND user_id = ?',
    )
      .bind(folderId, user.id)
      .first();
    if (!folder) {
      return apiError(c, 400, 'VALIDATION', 'ブックマークフォルダが見つかりません。');
    }
  }

  const existing = await c.env.DB.prepare(
    'SELECT 1 FROM bookmarks WHERE user_id = ? AND quiz_set_id = ?',
  )
    .bind(user.id, quizSetId)
    .first();

  if (!existing) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?')
      .bind(user.id)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= LIMITS.BOOKMARKS_PER_USER) {
      return apiError(
        c,
        403,
        'QUOTA_EXCEEDED',
        `ブックマークは${LIMITS.BOOKMARKS_PER_USER}件までです。`,
      );
    }
    await c.env.DB.prepare(
      'INSERT INTO bookmarks (user_id, quiz_set_id, folder_id) VALUES (?, ?, ?)',
    )
      .bind(user.id, quizSetId, folderId ?? null)
      .run();
  } else {
    await c.env.DB.prepare(
      'UPDATE bookmarks SET folder_id = ? WHERE user_id = ? AND quiz_set_id = ?',
    )
      .bind(folderId ?? null, user.id, quizSetId)
      .run();
  }
  return c.body(null, 204);
});

quizBookmark.delete('/:id/bookmark', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const quizSetId = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM bookmarks WHERE user_id = ? AND quiz_set_id = ?')
    .bind(user.id, quizSetId)
    .run();
  return c.body(null, 204);
});
