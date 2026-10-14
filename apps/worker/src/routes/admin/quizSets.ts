import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { zv } from '../../lib/validate';

const quizSets = new Hono<AppEnv>();

const suspendSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

// POST /api/admin/quiz-sets/:id/suspend: {reason} → suspended_at/suspended_reason 設定（§7.7）
quizSets.post('/:id/suspend', zv('json', suspendSchema), async (c) => {
  const id = c.req.param('id');
  const { reason } = c.req.valid('json');

  const existing = await c.env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ?').bind(id).first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }

  await c.env.DB.prepare(
    `UPDATE quiz_sets SET suspended_at = CURRENT_TIMESTAMP, suspended_reason = ? WHERE id = ?`,
  )
    .bind(reason, id)
    .run();

  return c.body(null, 204);
});

// DELETE /api/admin/quiz-sets/:id/suspend: 停止解除
quizSets.delete('/:id/suspend', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ?').bind(id).first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }

  await c.env.DB.prepare(
    'UPDATE quiz_sets SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?',
  )
    .bind(id)
    .run();

  return c.body(null, 204);
});

// DELETE /api/admin/quiz-sets/:id: 完全削除（questions/blanks/table_cells は ON DELETE CASCADE）
quizSets.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ?').bind(id).first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }

  await c.env.DB.prepare('DELETE FROM quiz_sets WHERE id = ?').bind(id).run();
  return c.body(null, 204);
});

export default quizSets;
