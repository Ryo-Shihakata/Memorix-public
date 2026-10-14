import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';

interface ImageKeyRow {
  r2_key: string;
}

const img = new Hono<AppEnv>();

// GET /img/:imageId: 認証不要。images から r2_key を引き R2 から stream（§9 配信）。
// 画像はイミュータブル運用のため 1年キャッシュ。
img.get('/:imageId', async (c) => {
  const imageId = c.req.param('imageId');
  const row = await c.env.DB.prepare('SELECT r2_key FROM images WHERE id = ?')
    .bind(imageId)
    .first<ImageKeyRow>();
  if (!row) {
    return apiError(c, 404, 'NOT_FOUND', '画像が見つかりません。');
  }

  const object = await c.env.IMAGES.get(row.r2_key);
  if (!object) {
    return apiError(c, 404, 'NOT_FOUND', '画像が見つかりません。');
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('etag', object.httpEtag);

  return new Response(object.body, { headers });
});

export default img;
