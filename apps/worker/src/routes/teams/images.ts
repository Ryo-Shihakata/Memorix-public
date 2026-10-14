import { LIMITS } from '@memorix/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { newId } from '../../lib/id';
import { getPagination, pageResult } from '../../lib/pagination';
import { RATE_LIMITS, rateLimit } from '../../lib/rateLimit';
import { requireTeamRole } from '../../middleware/session';

interface ImageRow {
  id: string;
  team_id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

interface ImageResponse {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

function toImage(row: ImageRow): ImageResponse {
  return {
    id: row.id,
    url: `/img/${row.id}`,
    filename: row.filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
}

// §9 マジックバイト検証: WebP=RIFF....WEBP / PNG=89 50 4E 47 / JPEG=FF D8 FF / GIF=GIF8
// 不一致・SVG・その他は拒否。判定できたら {mimeType, ext} を返す。
function detectImageType(bytes: Uint8Array): { mimeType: string; ext: string } | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { mimeType: 'image/png', ext: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return { mimeType: 'image/gif', ext: 'gif' };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mimeType: 'image/webp', ext: 'webp' };
  }
  return null;
}

const images = new Hono<AppEnv>();

// POST .../images: editor 以上、multipart（file + 任意 width/height）。§9
images.post(
  '/',
  requireTeamRole('editor'),
  rateLimit(RATE_LIMITS.upload, (c) => c.req.param('teamId') ?? ''),
  async (c) => {
    const teamId = c.req.param('teamId');

    let form: Record<string, string | File>;
    try {
      form = await c.req.parseBody();
    } catch {
      return apiError(c, 400, 'VALIDATION', 'アップロード内容が正しくありません。');
    }
    const file = form.file;
    if (!(file instanceof File)) {
      return apiError(c, 400, 'VALIDATION', 'ファイルが指定されていません。');
    }

    if (file.size > LIMITS.IMAGE_MAX_BYTES) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'ファイルサイズは2MB以下にしてください。');
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const detected = detectImageType(bytes);
    if (!detected) {
      return apiError(c, 400, 'VALIDATION', '対応していない画像形式です。');
    }

    const team = await c.env.DB.prepare('SELECT storage_used_bytes FROM teams WHERE id = ?')
      .bind(teamId)
      .first<{ storage_used_bytes: number }>();
    if (!team) {
      return apiError(c, 404, 'NOT_FOUND', 'チームが見つかりません。');
    }
    if (team.storage_used_bytes + bytes.length > LIMITS.TEAM_STORAGE_MAX_BYTES) {
      return apiError(c, 403, 'QUOTA_EXCEEDED', 'チームの画像保存容量の上限に達しています。');
    }

    const width = typeof form.width === 'string' ? Number.parseInt(form.width, 10) : null;
    const height = typeof form.height === 'string' ? Number.parseInt(form.height, 10) : null;
    const filename = typeof form.filename === 'string' ? form.filename : file.name;

    const imageId = newId();
    const r2Key = `teams/${teamId}/${imageId}.${detected.ext}`;
    const user = c.get('user');

    await c.env.IMAGES.put(r2Key, bytes, { httpMetadata: { contentType: detected.mimeType } });

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO images (id, team_id, r2_key, filename, mime_type, file_size, width, height, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        imageId,
        teamId,
        r2Key,
        filename,
        detected.mimeType,
        bytes.length,
        Number.isFinite(width) ? width : null,
        Number.isFinite(height) ? height : null,
        user?.id ?? null,
      ),
      c.env.DB.prepare(
        'UPDATE teams SET storage_used_bytes = storage_used_bytes + ? WHERE id = ?',
      ).bind(bytes.length, teamId),
    ]);

    const row = await c.env.DB.prepare(
      'SELECT id, team_id, filename, mime_type, file_size, width, height, created_at FROM images WHERE id = ?',
    )
      .bind(imageId)
      .first<ImageRow>();
    if (!row) throw new Error('image insert failed');
    return c.json(toImage(row), 201);
  },
);

// GET .../images: viewer 以上。ライブラリ一覧（§7 共通ページネーション）
images.get('/', requireTeamRole('viewer'), async (c) => {
  const teamId = c.req.param('teamId');
  const p = getPagination(c);
  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM images WHERE team_id = ?')
    .bind(teamId)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT id, team_id, filename, mime_type, file_size, width, height, created_at
     FROM images WHERE team_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(teamId, p.perPage, p.offset)
    .all<ImageRow>();
  return c.json(pageResult(results.map(toImage), total?.n ?? 0, p));
});

// DELETE .../images/:id: editor 以上。参照中（questions/table_cells/blanks）なら 409
images.delete('/:imageId', requireTeamRole('editor'), async (c) => {
  const teamId = c.req.param('teamId');
  const imageId = c.req.param('imageId');

  const existing = await c.env.DB.prepare(
    'SELECT r2_key, file_size FROM images WHERE id = ? AND team_id = ?',
  )
    .bind(imageId, teamId)
    .first<{ r2_key: string; file_size: number }>();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', '画像が見つかりません。');
  }

  const referenced = await c.env.DB.prepare(
    `SELECT 1 AS x FROM questions WHERE image_id = ?
     UNION ALL
     SELECT 1 FROM table_cells WHERE image_id = ?
     UNION ALL
     SELECT 1 FROM blanks WHERE hint_image_id = ?
     LIMIT 1`,
  )
    .bind(imageId, imageId, imageId)
    .first();
  if (referenced) {
    return apiError(c, 409, 'CONFLICT', 'この画像は問題で使用中のため削除できません。');
  }

  await c.env.IMAGES.delete(existing.r2_key);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM images WHERE id = ?').bind(imageId),
    c.env.DB.prepare(
      'UPDATE teams SET storage_used_bytes = storage_used_bytes - ? WHERE id = ?',
    ).bind(existing.file_size, teamId),
  ]);

  return c.body(null, 204);
});

export default images;
