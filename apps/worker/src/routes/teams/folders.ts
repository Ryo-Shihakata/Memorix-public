import type { Folder } from '@memorix/shared';
import { LIMITS } from '@memorix/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { newId } from '../../lib/id';
import { getPagination, pageResult } from '../../lib/pagination';
import { zv } from '../../lib/validate';
import { requireTeamRole } from '../../middleware/session';

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.TITLE_MAX_LEN),
});

const patchFolderSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.TITLE_MAX_LEN).optional(),
  displayOrder: z.number().int().min(0).optional(),
});

interface FolderRow {
  id: string;
  team_id: string;
  name: string;
  display_order: number;
}

function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    displayOrder: row.display_order,
  };
}

const folders = new Hono<AppEnv>();

// GET .../folders: editor 以上（§7.6 Studio コンテンツ管理）
folders.get('/', requireTeamRole('editor'), async (c) => {
  const teamId = c.req.param('teamId');
  const p = getPagination(c);
  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM folders WHERE team_id = ?')
    .bind(teamId)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT id, team_id, name, display_order FROM folders
     WHERE team_id = ? ORDER BY display_order, created_at LIMIT ? OFFSET ?`,
  )
    .bind(teamId, p.perPage, p.offset)
    .all<FolderRow>();
  return c.json(pageResult(results.map(toFolder), total?.n ?? 0, p));
});

// POST .../folders: editor 以上。{name}
folders.post('/', requireTeamRole('editor'), zv('json', createFolderSchema), async (c) => {
  const teamId = c.req.param('teamId');
  const { name } = c.req.valid('json');

  const team = await c.env.DB.prepare('SELECT id FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) {
    return apiError(c, 404, 'NOT_FOUND', 'チームが見つかりません。');
  }

  const folderId = newId();
  await c.env.DB.prepare(
    `INSERT INTO folders (id, team_id, name, display_order)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(display_order) + 1, 0) FROM folders WHERE team_id = ?))`,
  )
    .bind(folderId, teamId, name, teamId)
    .run();

  const row = await c.env.DB.prepare(
    'SELECT id, team_id, name, display_order FROM folders WHERE id = ?',
  )
    .bind(folderId)
    .first<FolderRow>();
  if (!row) throw new Error('folder insert failed');
  return c.json(toFolder(row), 201);
});

// PATCH .../folders/:id: editor 以上。{name?, displayOrder?}
folders.patch('/:folderId', requireTeamRole('editor'), zv('json', patchFolderSchema), async (c) => {
  const teamId = c.req.param('teamId');
  const folderId = c.req.param('folderId');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare('SELECT id FROM folders WHERE id = ? AND team_id = ?')
    .bind(folderId, teamId)
    .first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'フォルダが見つかりません。');
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
    await c.env.DB.prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, folderId)
      .run();
  }

  const row = await c.env.DB.prepare(
    'SELECT id, team_id, name, display_order FROM folders WHERE id = ?',
  )
    .bind(folderId)
    .first<FolderRow>();
  if (!row) throw new Error('unreachable');
  return c.json(toFolder(row));
});

// DELETE .../folders/:id: editor 以上。quiz_sets.folder_id は ON DELETE SET NULL
folders.delete('/:folderId', requireTeamRole('editor'), async (c) => {
  const teamId = c.req.param('teamId');
  const folderId = c.req.param('folderId');
  const existing = await c.env.DB.prepare('SELECT id FROM folders WHERE id = ? AND team_id = ?')
    .bind(folderId, teamId)
    .first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'フォルダが見つかりません。');
  }
  await c.env.DB.prepare('DELETE FROM folders WHERE id = ?').bind(folderId).run();
  return c.body(null, 204);
});

export default folders;
