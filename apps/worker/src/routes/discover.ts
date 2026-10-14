import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getPagination, pageResult } from '../lib/pagination';
import {
  escapeLike,
  QUIZ_SET_COLUMNS,
  QUIZ_SET_FROM,
  type QuizSetRow,
  toQuizSetSummary,
} from '../lib/quizAccess';

const discover = new Hono<AppEnv>();

// GET /api/discover?subject=<slug>&sort=new|popular&q=&page=: 認証不要（§7.2）
// public かつ非suspend の QuizSetSummary 一覧。q はタイトル+説明の LIKE 部分一致。
// sort=new は published_at DESC（デフォルト）、popular は play_count DESC
discover.get('/', async (c) => {
  const p = getPagination(c);
  const subjectSlug = c.req.query('subject');
  const q = c.req.query('q');
  const sort = c.req.query('sort') === 'popular' ? 'popular' : 'new';

  const conditions = ["qs.visibility = 'public'", 'qs.suspended_at IS NULL'];
  const binds: (string | number)[] = [];
  if (subjectSlug) {
    conditions.push('s.slug = ?');
    binds.push(subjectSlug);
  }
  if (q) {
    conditions.push("(qs.title LIKE ? ESCAPE '\\' OR qs.description LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(q)}%`;
    binds.push(like, like);
  }
  const where = conditions.join(' AND ');
  const orderBy = sort === 'popular' ? 'qs.play_count DESC, qs.id' : 'qs.published_at DESC, qs.id';

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${QUIZ_SET_FROM} WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT ${QUIZ_SET_COLUMNS} ${QUIZ_SET_FROM} WHERE ${where}
     ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
  )
    .bind(...binds, p.perPage, p.offset)
    .all<QuizSetRow>();

  return c.json(pageResult(results.map(toQuizSetSummary), total?.n ?? 0, p));
});

export default discover;
