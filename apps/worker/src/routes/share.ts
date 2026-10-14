import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import {
  checkPublicQuizAccess,
  fetchQuizSetRowByShareToken,
  toQuizSetSummary,
} from '../lib/quizAccess';
import { RATE_LIMITS, rateLimit } from '../lib/rateLimit';

const share = new Hono<AppEnv>();

// GET /api/share/:token: 認証不要。share_token → 同メタ情報。RL: 30回/時/IP（§7.2, §11）
share.get('/:token', rateLimit(RATE_LIMITS.share), async (c) => {
  const row = await fetchQuizSetRowByShareToken(c.env.DB, c.req.param('token'));
  if (!row) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  const access = await checkPublicQuizAccess(c.env.DB, row, c.get('user'));
  if (access === 'not_found') {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  return c.json(toQuizSetSummary(row));
});

export default share;
