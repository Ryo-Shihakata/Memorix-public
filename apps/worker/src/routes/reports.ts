import { LIMITS } from '@memorix/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { newId } from '../lib/id';
import { checkPublicQuizAccess, fetchQuizSetRow } from '../lib/quizAccess';
import { RATE_LIMITS, rateLimit } from '../lib/rateLimit';
import { zv } from '../lib/validate';

const reports = new Hono<AppEnv>();

const createReportSchema = z.object({
  reason: z.enum(['inappropriate', 'copyright', 'spam', 'other']),
  detail: z.string().trim().min(1).max(LIMITS.REPORT_DETAIL_MAX_LEN).optional(),
});

// POST /api/quiz-sets/:id/reports: ゲスト可。RL: report 5/日/IP（§7.4, §11）
// reporter_user_id はログイン時のみ。対象クイズは公開閲覧可能なもの（checkPublicQuizAccess）に限る。
// private の非メンバー・存在しない・suspended は 404（存在を隠す）
reports.post(
  '/:id/reports',
  rateLimit(RATE_LIMITS.report),
  zv('json', createReportSchema),
  async (c) => {
    const user = c.get('user');
    const quizSetId = c.req.param('id');
    const { reason, detail } = c.req.valid('json');

    const row = await fetchQuizSetRow(c.env.DB, quizSetId);
    if (!row) {
      return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
    }
    const access = await checkPublicQuizAccess(c.env.DB, row, user);
    if (access === 'not_found') {
      return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
    }

    const id = newId();
    await c.env.DB.prepare(
      `INSERT INTO reports (id, quiz_set_id, reporter_user_id, reason, detail)
     VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, quizSetId, user?.id ?? null, reason, detail ?? null)
      .run();

    return c.json({ id }, 201);
  },
);

export default reports;
