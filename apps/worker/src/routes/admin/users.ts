import type { AdminUser } from '@memorix/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { getPagination, pageResult } from '../../lib/pagination';
import { escapeLike } from '../../lib/quizAccess';
import { zv } from '../../lib/validate';

interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: 'user' | 'admin';
  banned_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

function toAdminUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: row.role,
    bannedAt: row.banned_at,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

const USER_COLUMNS = 'id, email, name, avatar_url, role, banned_at, created_at, last_login_at';

const users = new Hono<AppEnv>();

// GET /api/admin/users?q=: email/name の LIKE 検索（エスケープ）、ページネーション（§7.7）
users.get('/', async (c) => {
  const p = getPagination(c);
  const q = c.req.query('q');

  const conditions: string[] = [];
  const binds: string[] = [];
  if (q) {
    conditions.push("(email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(q)}%`;
    binds.push(like, like);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT ${USER_COLUMNS} FROM users ${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
  )
    .bind(...binds, p.perPage, p.offset)
    .all<UserRow>();

  return c.json(pageResult(results.map(toAdminUser), total?.n ?? 0, p));
});

// POST /api/admin/users/:id/ban: banned_at 設定。KVセッションは次アクセス時に無効化（middleware/session.ts）。
// 自分自身のBANはロックアウト防止のため400（仕様に明記なしの防御的判断）
users.post('/:id/ban', async (c) => {
  const admin = c.get('user');
  if (!admin) throw new Error('unreachable');
  const id = c.req.param('id');

  if (id === admin.id) {
    return apiError(c, 400, 'VALIDATION', '自分自身をBANすることはできません。');
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'ユーザーが見つかりません。');
  }

  await c.env.DB.prepare('UPDATE users SET banned_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(id)
    .run();
  return c.body(null, 204);
});

// DELETE /api/admin/users/:id/ban: BAN解除
users.delete('/:id/ban', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'ユーザーが見つかりません。');
  }

  await c.env.DB.prepare('UPDATE users SET banned_at = NULL WHERE id = ?').bind(id).run();
  return c.body(null, 204);
});

const patchRoleSchema = z.object({
  role: z.enum(['user', 'admin']),
});

// PATCH /api/admin/users/:id/role: {role}。自分自身の降格はロックアウト防止のため400
// （仕様に明記なしの防御的判断）
users.patch('/:id/role', zv('json', patchRoleSchema), async (c) => {
  const admin = c.get('user');
  if (!admin) throw new Error('unreachable');
  const id = c.req.param('id');
  const { role } = c.req.valid('json');

  if (id === admin.id && role !== 'admin') {
    return apiError(c, 400, 'VALIDATION', '自分自身の権限を降格することはできません。');
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'ユーザーが見つかりません。');
  }

  await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run();
  return c.body(null, 204);
});

export default users;
