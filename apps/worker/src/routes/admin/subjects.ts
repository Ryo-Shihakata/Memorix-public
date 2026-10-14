import type { Subject } from '@memorix/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { newId } from '../../lib/id';
import { zv } from '../../lib/validate';

interface SubjectRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  display_order: number;
  is_active: number;
}

function toSubject(row: SubjectRow): Subject {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    icon: row.icon,
    color: row.color,
    displayOrder: row.display_order,
    isActive: row.is_active === 1,
  };
}

const SUBJECT_COLUMNS = 'id, slug, name, icon, color, display_order, is_active';

// slug: URL・CSV等で使う識別子のため英数小文字とハイフン・アンダースコアに制限
const createSubjectSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, 'slug は英数小文字・ハイフン・アンダースコアのみ使用できます。'),
  name: z.string().trim().min(1).max(50),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
});

const patchSubjectSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, 'slug は英数小文字・ハイフン・アンダースコアのみ使用できます。')
    .optional(),
  name: z.string().trim().min(1).max(50).optional(),
  icon: z.string().max(10).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const subjects = new Hono<AppEnv>();

// GET /api/admin/subjects: requireAdmin（呼び出し元でマウント）。is_active問わず全件
subjects.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${SUBJECT_COLUMNS} FROM subjects ORDER BY display_order, id`,
  ).all<SubjectRow>();
  return c.json(results.map(toSubject));
});

// POST /api/admin/subjects: {slug, name, icon?, color?}。slug 重複 409
subjects.post('/', zv('json', createSubjectSchema), async (c) => {
  const { slug, name, icon, color } = c.req.valid('json');

  const existing = await c.env.DB.prepare('SELECT id FROM subjects WHERE slug = ?')
    .bind(slug)
    .first();
  if (existing) {
    return apiError(c, 409, 'CONFLICT', 'このslugは既に使用されています。');
  }

  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO subjects (id, slug, name, icon, color, display_order)
     VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(display_order) + 1, 0) FROM subjects))`,
  )
    .bind(id, slug, name, icon ?? null, color ?? null)
    .run();

  const row = await c.env.DB.prepare(`SELECT ${SUBJECT_COLUMNS} FROM subjects WHERE id = ?`)
    .bind(id)
    .first<SubjectRow>();
  if (!row) throw new Error('subject insert failed');
  return c.json(toSubject(row), 201);
});

// PATCH /api/admin/subjects/:id
subjects.patch('/:id', zv('json', patchSubjectSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare('SELECT id FROM subjects WHERE id = ?').bind(id).first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', '科目が見つかりません。');
  }

  if (body.slug !== undefined) {
    const dup = await c.env.DB.prepare('SELECT id FROM subjects WHERE slug = ? AND id != ?')
      .bind(body.slug, id)
      .first();
    if (dup) {
      return apiError(c, 409, 'CONFLICT', 'このslugは既に使用されています。');
    }
  }

  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  if (body.slug !== undefined) {
    sets.push('slug = ?');
    binds.push(body.slug);
  }
  if (body.name !== undefined) {
    sets.push('name = ?');
    binds.push(body.name);
  }
  if (body.icon !== undefined) {
    sets.push('icon = ?');
    binds.push(body.icon);
  }
  if (body.color !== undefined) {
    sets.push('color = ?');
    binds.push(body.color);
  }
  if (body.displayOrder !== undefined) {
    sets.push('display_order = ?');
    binds.push(body.displayOrder);
  }
  if (body.isActive !== undefined) {
    sets.push('is_active = ?');
    binds.push(body.isActive ? 1 : 0);
  }
  if (sets.length > 0) {
    await c.env.DB.prepare(`UPDATE subjects SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run();
  }

  const row = await c.env.DB.prepare(`SELECT ${SUBJECT_COLUMNS} FROM subjects WHERE id = ?`)
    .bind(id)
    .first<SubjectRow>();
  if (!row) throw new Error('unreachable');
  return c.json(toSubject(row));
});

// DELETE /api/admin/subjects/:id: 使用中（quiz_sets.subject_id 参照あり）は 409
subjects.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM subjects WHERE id = ?').bind(id).first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', '科目が見つかりません。');
  }

  const inUse = await c.env.DB.prepare('SELECT 1 FROM quiz_sets WHERE subject_id = ? LIMIT 1')
    .bind(id)
    .first();
  if (inUse) {
    return apiError(
      c,
      409,
      'CONFLICT',
      'この科目はクイズで使用中のため削除できません。無効化(is_active=0)をご利用ください。',
    );
  }

  await c.env.DB.prepare('DELETE FROM subjects WHERE id = ?').bind(id).run();
  return c.body(null, 204);
});

export default subjects;
