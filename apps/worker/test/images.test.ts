import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newId } from '../src/lib/id';
import { addMember, errorCode, request, seedTeam, seedUser } from './helpers';

// §9 画像パイプライン（サーバー・配信）

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2,
]);

function uploadForm(
  bytes: Uint8Array,
  opts: { filename?: string; type?: string; width?: number; height?: number } = {},
): FormData {
  const form = new FormData();
  const file = new File([bytes], opts.filename ?? 'test.bin', {
    type: opts.type ?? 'application/octet-stream',
  });
  form.set('file', file);
  if (opts.width !== undefined) form.set('width', String(opts.width));
  if (opts.height !== undefined) form.set('height', String(opts.height));
  return form;
}

async function uploadImage(
  teamId: string,
  cookie: string,
  bytes: Uint8Array,
  opts?: { filename?: string; width?: number; height?: number },
): Promise<Response> {
  return request(`/api/teams/${teamId}/images`, {
    method: 'POST',
    headers: { cookie },
    body: uploadForm(bytes, opts),
  });
}

describe('POST /api/teams/:teamId/images', () => {
  it('WebP/PNG/JPEG/GIF を正常アップロードできる（images行 + storage_used_bytes 増加 + R2 に存在）', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');

    const cases: Array<[string, Uint8Array]> = [
      ['image/png', PNG_BYTES],
      ['image/jpeg', JPEG_BYTES],
      ['image/gif', GIF_BYTES],
      ['image/webp', WEBP_BYTES],
    ];

    let expectedTotal = 0;
    for (const [mime, bytes] of cases) {
      const res = await uploadImage(teamId, editor.cookie, bytes, { width: 100, height: 50 });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        url: string;
        mimeType: string;
        fileSize: number;
      };
      expect(body.url).toBe(`/img/${body.id}`);
      expect(body.mimeType).toBe(mime);
      expectedTotal += bytes.length;

      const row = await env.DB.prepare('SELECT r2_key, file_size FROM images WHERE id = ?')
        .bind(body.id)
        .first<{ r2_key: string; file_size: number }>();
      expect(row?.file_size).toBe(bytes.length);
      const obj = await env.IMAGES.get(row?.r2_key ?? '');
      expect(obj).not.toBeNull();
    }

    const team = await env.DB.prepare('SELECT storage_used_bytes FROM teams WHERE id = ?')
      .bind(teamId)
      .first<{ storage_used_bytes: number }>();
    expect(team?.storage_used_bytes).toBe(expectedTotal);
  });

  it('マジックバイト不一致（SVG等）は 400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');

    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const res = await uploadImage(teamId, editor.cookie, svgBytes);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
  });

  it('2MB超は 413 PAYLOAD_TOO_LARGE', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');

    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG_BYTES);
    const res = await uploadImage(teamId, editor.cookie, big);
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('クォータ超過（storage_used_bytes が上限近く）は 403 QUOTA_EXCEEDED', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    // 200MB - 5 バイトまで埋める → PNG_BYTES(12バイト) の追加でオーバー
    await env.DB.prepare('UPDATE teams SET storage_used_bytes = ? WHERE id = ?')
      .bind(200 * 1024 * 1024 - 5, teamId)
      .run();

    const res = await uploadImage(teamId, editor.cookie, PNG_BYTES);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('QUOTA_EXCEEDED');
  });

  it('viewer は 403、非メンバーは 403', async () => {
    const viewer = await seedUser();
    const outsider = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, viewer.id, 'viewer');

    const viewerRes = await uploadImage(teamId, viewer.cookie, PNG_BYTES);
    expect(viewerRes.status).toBe(403);

    const outsiderRes = await uploadImage(teamId, outsider.cookie, PNG_BYTES);
    expect(outsiderRes.status).toBe(403);
  });

  it('upload バケットは 60/日/チーム。61枚目は 429', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');

    for (let i = 0; i < 60; i++) {
      const res = await uploadImage(teamId, editor.cookie, PNG_BYTES);
      expect(res.status).toBe(201);
    }
    const blocked = await uploadImage(teamId, editor.cookie, PNG_BYTES);
    expect(blocked.status).toBe(429);
    expect(await errorCode(blocked)).toBe('RATE_LIMITED');
  }, 20000);
});

describe('GET /api/teams/:teamId/images', () => {
  it('viewer 以上がライブラリ一覧をページネーション形式で取得できる', async () => {
    const editor = await seedUser();
    const viewer = await seedUser();
    const outsider = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    await addMember(teamId, viewer.id, 'viewer');

    await uploadImage(teamId, editor.cookie, PNG_BYTES);
    await uploadImage(teamId, editor.cookie, JPEG_BYTES);

    const res = await request(`/api/teams/${teamId}/images`, {
      headers: { cookie: viewer.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);

    const ng = await request(`/api/teams/${teamId}/images`, {
      headers: { cookie: outsider.cookie },
    });
    expect(ng.status).toBe(403);
  });
});

describe('DELETE /api/teams/:teamId/images/:id', () => {
  it('参照中の画像は 409、未参照は削除成功して使用量が減る', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');

    const uploaded = await uploadImage(teamId, editor.cookie, PNG_BYTES);
    const { id: imageId, fileSize } = (await uploaded.json()) as {
      id: string;
      fileSize: number;
    };

    // questions.image_id から参照させる
    const quizSetId = newId();
    const questionId = newId();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO quiz_sets (id, team_id, title, visibility) VALUES (?, ?, 'テスト', 'private')",
      ).bind(quizSetId, teamId),
      env.DB.prepare(
        "INSERT INTO questions (id, quiz_set_id, type, image_id) VALUES (?, ?, 'text', ?)",
      ).bind(questionId, quizSetId, imageId),
    ]);

    const conflict = await request(`/api/teams/${teamId}/images/${imageId}`, {
      method: 'DELETE',
      headers: { cookie: editor.cookie },
    });
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe('CONFLICT');

    // 参照を外して再削除
    await env.DB.prepare('UPDATE questions SET image_id = NULL WHERE id = ?')
      .bind(questionId)
      .run();

    const before = await env.DB.prepare('SELECT storage_used_bytes FROM teams WHERE id = ?')
      .bind(teamId)
      .first<{ storage_used_bytes: number }>();

    const ok = await request(`/api/teams/${teamId}/images/${imageId}`, {
      method: 'DELETE',
      headers: { cookie: editor.cookie },
    });
    expect(ok.status).toBe(204);

    const row = await env.DB.prepare('SELECT id FROM images WHERE id = ?').bind(imageId).first();
    expect(row).toBeNull();

    const after = await env.DB.prepare('SELECT storage_used_bytes FROM teams WHERE id = ?')
      .bind(teamId)
      .first<{ storage_used_bytes: number }>();
    expect(after?.storage_used_bytes).toBe((before?.storage_used_bytes ?? 0) - fileSize);
  });
});

describe('GET /img/:imageId', () => {
  it('Cache-Control: immutable 付きで画像を返す。存在しない ID は 404', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const uploaded = await uploadImage(teamId, editor.cookie, PNG_BYTES);
    const { id: imageId } = (await uploaded.json()) as { id: string };

    const res = await request(`/img/${imageId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('etag')).toBeTruthy();
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(PNG_BYTES));

    const missing = await request(`/img/${newId()}`);
    expect(missing.status).toBe(404);
  });
});
