import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { checkPublicQuizAccess, fetchQuizSetRow, toQuizSetSummary } from '../lib/quizAccess';

const quizSets = new Hono<AppEnv>();

// GET /api/quiz-sets/:id: 認証不要。メタ情報のみ(QuizSetSummary相当+問題数)。
// public/unlisted は誰でも、private は所属チームメンバーのみ。
// 非公開時は 404（suspend済みも同様、存在を隠す）（§7.2, §7 共通規約）
quizSets.get('/:id', async (c) => {
  const row = await fetchQuizSetRow(c.env.DB, c.req.param('id'));
  if (!row) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  const access = await checkPublicQuizAccess(c.env.DB, row, c.get('user'));
  if (access === 'not_found') {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  return c.json(toQuizSetSummary(row));
});

export default quizSets;
