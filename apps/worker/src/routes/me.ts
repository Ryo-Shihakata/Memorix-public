import type {
  BookmarkFolder,
  Me,
  MeSessionDetail,
  MeSessionSummary,
  MeStats,
} from '@memorix/shared';
import { LIMITS } from '@memorix/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { newId } from '../lib/id';
import { getPagination, pageResult } from '../lib/pagination';
import {
  QUIZ_SET_COLUMNS,
  QUIZ_SET_FROM,
  type QuizSetRow,
  toQuizSetSummary,
} from '../lib/quizAccess';
import { zv } from '../lib/validate';
import { requireAuth } from '../middleware/session';

const me = new Hono<AppEnv>();

// GET /api/me: {user, teams}（§5.1 / §7.1）。未ログインは requireAuth が 401 を返す。
me.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) {
    // requireAuth 通過後は到達しない（型ガード）
    throw new Error('unreachable');
  }
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, tm.role, t.is_personal
     FROM team_members tm JOIN teams t ON t.id = tm.team_id
     WHERE tm.user_id = ?
     ORDER BY t.created_at`,
  )
    .bind(user.id)
    .all<{ id: string; name: string; role: 'owner' | 'editor' | 'viewer'; is_personal: number }>();

  const body: Me = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
      role: user.role,
    },
    teams: results.map((t) => ({
      id: t.id,
      name: t.name,
      role: t.role,
      isPersonal: t.is_personal === 1,
    })),
  };
  return c.json(body);
});

interface MeSessionRow {
  id: string;
  quiz_set_id: string;
  quiz_title: string;
  team_name: string;
  started_at: string;
  submitted_at: string | null;
  total_blanks: number | null;
  correct_count: number | null;
}

function toMeSessionSummary(row: MeSessionRow): MeSessionSummary {
  const totalBlanks = row.total_blanks ?? 0;
  const correctCount = row.correct_count ?? 0;
  return {
    id: row.id,
    quizSetId: row.quiz_set_id,
    quizTitle: row.quiz_title,
    teamName: row.team_name,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    score:
      row.submitted_at !== null
        ? {
            correct: correctCount,
            total: totalBlanks,
            percent: totalBlanks > 0 ? Math.round((correctCount / totalBlanks) * 100) : 0,
          }
        : null,
  };
}

const ME_SESSION_COLUMNS = `qs.id, qs.quiz_set_id, q.title AS quiz_title, t.name AS team_name,
  qs.started_at, qs.submitted_at, qs.total_blanks, qs.correct_count`;
const ME_SESSION_FROM = `FROM quiz_sessions qs
  JOIN quiz_sets q ON q.id = qs.quiz_set_id
  JOIN teams t ON t.id = q.team_id`;

// GET /api/me/sessions: 受験履歴一覧（ページネーション）（§7.1）
me.get('/sessions', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const p = getPagination(c);

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n ${ME_SESSION_FROM} WHERE qs.user_id = ?`,
  )
    .bind(user.id)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT ${ME_SESSION_COLUMNS} ${ME_SESSION_FROM}
     WHERE qs.user_id = ?
     ORDER BY qs.started_at DESC, qs.id LIMIT ? OFFSET ?`,
  )
    .bind(user.id, p.perPage, p.offset)
    .all<MeSessionRow>();

  return c.json(pageResult(results.map(toMeSessionSummary), total?.n ?? 0, p));
});

// GET /api/me/sessions/:id: 受験詳細（本人のみ。他人のセッションは404で隠す）（§7.1）
me.get('/sessions/:id', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    `SELECT ${ME_SESSION_COLUMNS}, qs.user_id, qs.question_order ${ME_SESSION_FROM}
     WHERE qs.id = ?`,
  )
    .bind(id)
    .first<MeSessionRow & { user_id: string | null; question_order: string }>();
  if (!row || row.user_id !== user.id) {
    return apiError(c, 404, 'NOT_FOUND', 'セッションが見つかりません。');
  }

  const { results: answerRows } = await c.env.DB.prepare(
    `SELECT ua.blank_id, ua.user_answer, ua.is_correct, ua.question_id,
            b.blank_order, b.accepted_answers
     FROM user_answers ua JOIN blanks b ON b.id = ua.blank_id
     WHERE ua.session_id = ?`,
  )
    .bind(id)
    .all<{
      blank_id: string;
      user_answer: string;
      is_correct: number;
      question_id: string;
      blank_order: number;
      accepted_answers: string;
    }>();

  const questionOrder = JSON.parse(row.question_order) as string[];
  const orderIndex = new Map(questionOrder.map((qid, i) => [qid, i]));
  const orderedAnswers = [...answerRows].sort((x, y) => {
    const xi = orderIndex.get(x.question_id) ?? 0;
    const yi = orderIndex.get(y.question_id) ?? 0;
    if (xi !== yi) return xi - yi;
    return x.blank_order - y.blank_order;
  });

  const body: MeSessionDetail = {
    ...toMeSessionSummary(row),
    results: orderedAnswers.map((a) => ({
      blankId: a.blank_id,
      userAnswer: a.user_answer,
      isCorrect: a.is_correct === 1,
      correctAnswer: (JSON.parse(a.accepted_answers) as string[])[0] ?? '',
    })),
  };
  return c.json(body);
});

// GET /api/me/stats: {totalSessions, avgScore, recentScores[], weakBlanks[]}（§7.1）
me.get('/stats', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');

  const agg = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            AVG(CASE WHEN total_blanks > 0 THEN correct_count * 100.0 / total_blanks END) AS avg_score
     FROM quiz_sessions
     WHERE user_id = ? AND submitted_at IS NOT NULL`,
  )
    .bind(user.id)
    .first<{ total: number; avg_score: number | null }>();

  // recentScores: 提出済みの直近20件
  const { results: recentRows } = await c.env.DB.prepare(
    `SELECT q.title AS quiz_title, qs.submitted_at, qs.total_blanks, qs.correct_count
     FROM quiz_sessions qs JOIN quiz_sets q ON q.id = qs.quiz_set_id
     WHERE qs.user_id = ? AND qs.submitted_at IS NOT NULL
     ORDER BY qs.submitted_at DESC LIMIT 20`,
  )
    .bind(user.id)
    .all<{
      quiz_title: string;
      submitted_at: string;
      total_blanks: number | null;
      correct_count: number | null;
    }>();
  const recentScores = recentRows.map((r) => {
    const totalBlanks = r.total_blanks ?? 0;
    const correctCount = r.correct_count ?? 0;
    return {
      quizTitle: r.quiz_title,
      percent: totalBlanks > 0 ? Math.round((correctCount / totalBlanks) * 100) : 0,
      submittedAt: r.submitted_at,
    };
  });

  // weakBlanks: 自分が解答したことのある空欄ごとの正答率を集計し、低い順に最大10件（実装判断）
  const { results: blankRows } = await c.env.DB.prepare(
    `SELECT b.id AS blank_id, b.blank_order, q.title AS question_title,
            COUNT(*) AS attempts, SUM(ua.is_correct) AS correct
     FROM user_answers ua
     JOIN blanks b ON b.id = ua.blank_id
     JOIN questions q ON q.id = ua.question_id
     JOIN quiz_sessions qs ON qs.id = ua.session_id
     WHERE qs.user_id = ?
     GROUP BY ua.blank_id`,
  )
    .bind(user.id)
    .all<{
      blank_id: string;
      blank_order: number;
      question_title: string | null;
      attempts: number;
      correct: number;
    }>();
  const weakBlanks = blankRows
    .map((r) => ({
      questionTitle: r.question_title,
      blankOrder: r.blank_order,
      correctRate: r.attempts > 0 ? r.correct / r.attempts : 0,
    }))
    .sort((a, b2) => a.correctRate - b2.correctRate)
    .slice(0, 10);

  const body: MeStats = {
    totalSessions: agg?.total ?? 0,
    avgScore: agg?.avg_score != null ? Math.round(agg.avg_score) : 0,
    recentScores,
    weakBlanks,
  };
  return c.json(body);
});

// GET /api/me/feed: フォロー中チームの public 非suspend クイズ新着順（ページネーション）（§7.1, §7.4）
me.get('/feed', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const p = getPagination(c);

  const where = `qs.team_id IN (SELECT team_id FROM follows WHERE user_id = ?)
     AND qs.visibility = 'public' AND qs.suspended_at IS NULL`;

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${QUIZ_SET_FROM} WHERE ${where}`)
    .bind(user.id)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT ${QUIZ_SET_COLUMNS} ${QUIZ_SET_FROM} WHERE ${where}
     ORDER BY qs.published_at DESC, qs.id LIMIT ? OFFSET ?`,
  )
    .bind(user.id, p.perPage, p.offset)
    .all<QuizSetRow>();

  return c.json(pageResult(results.map(toQuizSetSummary), total?.n ?? 0, p));
});

// GET /api/me/bookmarks?folder_id=: ブックマーク一覧（§7.1, §7.4）
me.get('/bookmarks', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const p = getPagination(c);
  const folderId = c.req.query('folder_id');

  const conditions = ['b.user_id = ?'];
  const binds: (string | number)[] = [user.id];
  if (folderId) {
    conditions.push('b.folder_id = ?');
    binds.push(folderId);
  }
  const where = conditions.join(' AND ');
  // bookmarks 起点で quiz_sets を JOIN する（QUIZ_SET_FROM は quiz_sets 起点のため使えない）
  const bookmarkFrom = `FROM bookmarks b
    JOIN quiz_sets qs ON qs.id = b.quiz_set_id
    JOIN teams t ON t.id = qs.team_id
    LEFT JOIN subjects s ON s.id = qs.subject_id`;

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${bookmarkFrom} WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT ${QUIZ_SET_COLUMNS} ${bookmarkFrom}
     WHERE ${where}
     ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, p.perPage, p.offset)
    .all<QuizSetRow>();

  return c.json(pageResult(results.map(toQuizSetSummary), total?.n ?? 0, p));
});

interface BookmarkFolderRow {
  id: string;
  name: string;
  display_order: number;
}

function toBookmarkFolder(row: BookmarkFolderRow): BookmarkFolder {
  return { id: row.id, name: row.name, displayOrder: row.display_order };
}

const createBookmarkFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

const patchBookmarkFolderSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  displayOrder: z.number().int().min(0).optional(),
});

// POST /api/me/bookmark-folders: {name} → 201。BOOKMARK_FOLDERS_PER_USER=50 上限（§7.1）
me.post('/bookmark-folders', requireAuth, zv('json', createBookmarkFolderSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const { name } = c.req.valid('json');

  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM bookmark_folders WHERE user_id = ?',
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= LIMITS.BOOKMARK_FOLDERS_PER_USER) {
    return apiError(
      c,
      403,
      'QUOTA_EXCEEDED',
      `ブックマークフォルダは${LIMITS.BOOKMARK_FOLDERS_PER_USER}個までです。`,
    );
  }

  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO bookmark_folders (id, user_id, name, display_order)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(display_order) + 1, 0) FROM bookmark_folders WHERE user_id = ?))`,
  )
    .bind(id, user.id, name, user.id)
    .run();

  const row = await c.env.DB.prepare(
    'SELECT id, name, display_order FROM bookmark_folders WHERE id = ?',
  )
    .bind(id)
    .first<BookmarkFolderRow>();
  if (!row) throw new Error('bookmark folder insert failed');
  return c.json(toBookmarkFolder(row), 201);
});

// PATCH /api/me/bookmark-folders/:id
me.patch('/bookmark-folders/:id', requireAuth, zv('json', patchBookmarkFolderSchema), async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM bookmark_folders WHERE id = ? AND user_id = ?',
  )
    .bind(id, user.id)
    .first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'ブックマークフォルダが見つかりません。');
  }

  const sets: string[] = [];
  const binds: (string | number)[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    binds.push(body.name);
  }
  if (body.displayOrder !== undefined) {
    sets.push('display_order = ?');
    binds.push(body.displayOrder);
  }
  if (sets.length > 0) {
    await c.env.DB.prepare(`UPDATE bookmark_folders SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run();
  }

  const row = await c.env.DB.prepare(
    'SELECT id, name, display_order FROM bookmark_folders WHERE id = ?',
  )
    .bind(id)
    .first<BookmarkFolderRow>();
  if (!row) throw new Error('unreachable');
  return c.json(toBookmarkFolder(row));
});

// DELETE /api/me/bookmark-folders/:id: 削除時は bookmarks.folder_id が ON DELETE SET NULL で外れる
me.delete('/bookmark-folders/:id', requireAuth, async (c) => {
  const user = c.get('user');
  if (!user) throw new Error('unreachable');
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM bookmark_folders WHERE id = ? AND user_id = ?',
  )
    .bind(id, user.id)
    .first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'ブックマークフォルダが見つかりません。');
  }
  await c.env.DB.prepare('DELETE FROM bookmark_folders WHERE id = ?').bind(id).run();
  return c.body(null, 204);
});

export default me;
