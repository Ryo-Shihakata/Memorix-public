import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newId } from '../src/lib/id';
import { errorCode, jsonInit, request, seedTeam, seedUser } from './helpers';

// ---- テスト用シードヘルパー ----------------------------------------------

async function seedSubject(overrides: Partial<{ slug: string; isActive: number }> = {}) {
  const id = newId();
  await env.DB.prepare('INSERT INTO subjects (id, slug, name, is_active) VALUES (?, ?, ?, ?)')
    .bind(id, overrides.slug ?? `subject-${id}`, 'テスト科目', overrides.isActive ?? 1)
    .run();
  return id;
}

interface SeedQuizOptions {
  teamId: string;
  title?: string;
  description?: string;
  visibility?: 'public' | 'unlisted' | 'private';
  subjectId?: string | null;
  playCount?: number;
  publishedAt?: string | null;
  suspendedAt?: string | null;
}

async function seedQuiz(opts: SeedQuizOptions): Promise<string> {
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO quiz_sets
      (id, team_id, subject_id, title, description, visibility, play_count, published_at, suspended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      opts.teamId,
      opts.subjectId ?? null,
      opts.title ?? 'クイズ',
      opts.description ?? null,
      opts.visibility ?? 'public',
      opts.playCount ?? 0,
      opts.publishedAt ?? new Date().toISOString(),
      opts.suspendedAt ?? null,
    )
    .run();
  return id;
}

// ---- GET /api/subjects ----------------------------------------------------

describe('GET /api/subjects', () => {
  it('is_active=1 のみ display_order 順で返す', async () => {
    const s1 = newId();
    const s2 = newId();
    const inactive = newId();
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO subjects (id, slug, name, display_order, is_active) VALUES (?, ?, ?, ?, 1)',
      ).bind(s1, 'math', '数学', 1),
      env.DB.prepare(
        'INSERT INTO subjects (id, slug, name, display_order, is_active) VALUES (?, ?, ?, ?, 1)',
      ).bind(s2, 'english', '英語', 0),
      env.DB.prepare(
        'INSERT INTO subjects (id, slug, name, display_order, is_active) VALUES (?, ?, ?, ?, 0)',
      ).bind(inactive, 'archived', '廃止科目', 2),
    ]);

    const res = await request('/api/subjects');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; slug: string }>;
    expect(body.map((s) => s.id)).toEqual([s2, s1]);
  });
});

// ---- GET /api/discover ------------------------------------------------

describe('GET /api/discover', () => {
  it('public かつ非suspend のみ返す（private/unlisted/suspended は除外）', async () => {
    const teamId = await seedTeam();
    const pub = await seedQuiz({ teamId, title: '公開クイズ' });
    await seedQuiz({ teamId, title: '限定公開', visibility: 'unlisted' });
    await seedQuiz({ teamId, title: '非公開', visibility: 'private' });
    await seedQuiz({ teamId, title: '停止中', suspendedAt: new Date().toISOString() });

    const res = await request('/api/discover');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items.map((i) => i.id)).toEqual([pub]);
  });

  it('subject フィルタで絞り込める', async () => {
    const teamId = await seedTeam();
    const subjectA = await seedSubject({ slug: 'math' });
    const subjectB = await seedSubject({ slug: 'english' });
    const quizA = await seedQuiz({ teamId, subjectId: subjectA, title: '数学' });
    await seedQuiz({ teamId, subjectId: subjectB, title: '英語' });

    const res = await request('/api/discover?subject=math');
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((i) => i.id)).toEqual([quizA]);
  });

  it('sort=new は published_at DESC、sort=popular は play_count DESC', async () => {
    const teamId = await seedTeam();
    const older = await seedQuiz({
      teamId,
      title: '古いが人気',
      publishedAt: '2026-01-01T00:00:00Z',
      playCount: 100,
    });
    const newer = await seedQuiz({
      teamId,
      title: '新しいが不人気',
      publishedAt: '2026-06-01T00:00:00Z',
      playCount: 1,
    });

    const byNew = await request('/api/discover?sort=new');
    const newBody = (await byNew.json()) as { items: Array<{ id: string }> };
    expect(newBody.items.map((i) => i.id)).toEqual([newer, older]);

    const byPopular = await request('/api/discover?sort=popular');
    const popularBody = (await byPopular.json()) as { items: Array<{ id: string }> };
    expect(popularBody.items.map((i) => i.id)).toEqual([older, newer]);
  });

  it('q はタイトル+説明の部分一致。%・_ を含む文字列でも LIKE 爆発しない（エスケープ）', async () => {
    const teamId = await seedTeam();
    const withPercent = await seedQuiz({ teamId, title: '割引100%クイズ' });
    await seedQuiz({ teamId, title: '無関係なクイズ' });

    const res = await request(`/api/discover?q=${encodeURIComponent('100%')}`);
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items.map((i) => i.id)).toEqual([withPercent]);
  });
});

// ---- GET /api/teams/:id/profile ---------------------------------------

describe('GET /api/teams/:id/profile', () => {
  it('公開情報+followerCount+publicQuizzes を返す。非公開クイズは含まない', async () => {
    const teamId = await seedTeam();
    const pub = await seedQuiz({ teamId, title: '公開' });
    await seedQuiz({ teamId, title: '非公開', visibility: 'private' });

    const res = await request(`/api/teams/${teamId}/profile`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      team: { id: string };
      followerCount: number;
      publicQuizzes: Array<{ id: string }>;
    };
    expect(body.team.id).toBe(teamId);
    expect(body.followerCount).toBe(0);
    expect(body.publicQuizzes.map((q) => q.id)).toEqual([pub]);
  });

  it('存在しないチームは404', async () => {
    const res = await request(`/api/teams/${newId()}/profile`);
    expect(res.status).toBe(404);
  });
});

// ---- PUT/DELETE /api/teams/:id/follow -----------------------------------

describe('PUT/DELETE /api/teams/:id/follow', () => {
  it('冪等: 2回 PUT しても follower_count は1、DELETE で0に戻る', async () => {
    const { cookie } = await seedUser();
    const teamId = await seedTeam();

    const put1 = await request(`/api/teams/${teamId}/follow`, {
      method: 'PUT',
      headers: { cookie },
    });
    expect(put1.status).toBe(204);
    const put2 = await request(`/api/teams/${teamId}/follow`, {
      method: 'PUT',
      headers: { cookie },
    });
    expect(put2.status).toBe(204);

    const afterPut = await env.DB.prepare('SELECT follower_count FROM teams WHERE id = ?')
      .bind(teamId)
      .first<{ follower_count: number }>();
    expect(afterPut?.follower_count).toBe(1);

    const del = await request(`/api/teams/${teamId}/follow`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(del.status).toBe(204);
    const afterDel = await env.DB.prepare('SELECT follower_count FROM teams WHERE id = ?')
      .bind(teamId)
      .first<{ follower_count: number }>();
    expect(afterDel?.follower_count).toBe(0);
  });

  it('未ログインは401', async () => {
    const teamId = await seedTeam();
    const res = await request(`/api/teams/${teamId}/follow`, { method: 'PUT' });
    expect(res.status).toBe(401);
  });
});

// ---- GET /api/me/feed ---------------------------------------------------

describe('GET /api/me/feed', () => {
  it('フォロー中チームの public クイズのみ新着順で返す', async () => {
    const { cookie } = await seedUser();
    const followedTeam = await seedTeam();
    const otherTeam = await seedTeam();
    await request(`/api/teams/${followedTeam}/follow`, { method: 'PUT', headers: { cookie } });

    const older = await seedQuiz({
      teamId: followedTeam,
      title: '古い',
      publishedAt: '2026-01-01T00:00:00Z',
    });
    const newer = await seedQuiz({
      teamId: followedTeam,
      title: '新しい',
      publishedAt: '2026-06-01T00:00:00Z',
    });
    await seedQuiz({ teamId: followedTeam, title: '非公開', visibility: 'private' });
    await seedQuiz({ teamId: otherTeam, title: '他チーム' });

    const res = await request('/api/me/feed', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((i) => i.id)).toEqual([newer, older]);
  });
});

// ---- PUT/DELETE /api/quiz-sets/:id/bookmark ------------------------------

describe('PUT/DELETE /api/quiz-sets/:id/bookmark', () => {
  it('冪等・folderId 上書き。DELETE で解除', async () => {
    const { cookie } = await seedUser();
    const teamId = await seedTeam();
    const quizId = await seedQuiz({ teamId, title: 'クイズ' });

    const folderRes = await request(
      '/api/me/bookmark-folders',
      jsonInit('POST', { name: 'お気に入り' }, cookie),
    );
    expect(folderRes.status).toBe(201);
    const folder = (await folderRes.json()) as { id: string };

    const put1 = await request(`/api/quiz-sets/${quizId}/bookmark`, jsonInit('PUT', {}, cookie));
    expect(put1.status).toBe(204);
    const put2 = await request(
      `/api/quiz-sets/${quizId}/bookmark`,
      jsonInit('PUT', { folderId: folder.id }, cookie),
    );
    expect(put2.status).toBe(204);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE quiz_set_id = ?')
      .bind(quizId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    const del = await request(`/api/quiz-sets/${quizId}/bookmark`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(del.status).toBe(204);
    const afterDel = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM bookmarks WHERE quiz_set_id = ?',
    )
      .bind(quizId)
      .first<{ n: number }>();
    expect(afterDel?.n).toBe(0);
  });

  it('非公開クイズへの非メンバーのブックマークは404', async () => {
    const { cookie } = await seedUser();
    const teamId = await seedTeam();
    const quizId = await seedQuiz({ teamId, title: '非公開', visibility: 'private' });

    const res = await request(`/api/quiz-sets/${quizId}/bookmark`, jsonInit('PUT', {}, cookie));
    expect(res.status).toBe(404);
  });

  it('BOOKMARKS_PER_USER(1000)上限は403 QUOTA_EXCEEDED', async () => {
    const user = await seedUser();
    const teamId = await seedTeam();
    const stmts = [];
    for (let i = 0; i < 1000; i++) {
      const quizId = newId();
      stmts.push(
        env.DB.prepare(
          "INSERT INTO quiz_sets (id, team_id, title, visibility) VALUES (?, ?, ?, 'public')",
        ).bind(quizId, teamId, `q-${i}`),
      );
      stmts.push(
        env.DB.prepare('INSERT INTO bookmarks (user_id, quiz_set_id) VALUES (?, ?)').bind(
          user.id,
          quizId,
        ),
      );
    }
    await env.DB.batch(stmts);

    const oneMore = await seedQuiz({ teamId, title: '上限突破' });
    const res = await request(
      `/api/quiz-sets/${oneMore}/bookmark`,
      jsonInit('PUT', {}, user.cookie),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('QUOTA_EXCEEDED');
  });
});

// ---- bookmark-folders / me/bookmarks -------------------------------------

describe('bookmark-folders と me/bookmarks', () => {
  it('作成上限50件、folder_id で絞り込める、削除で bookmarks.folder_id が外れる', async () => {
    const { id: userId, cookie } = await seedUser();
    const teamId = await seedTeam();

    const stmts = [];
    for (let i = 0; i < 50; i++) {
      stmts.push(
        env.DB.prepare('INSERT INTO bookmark_folders (id, user_id, name) VALUES (?, ?, ?)').bind(
          newId(),
          userId,
          `folder-${i}`,
        ),
      );
    }
    await env.DB.batch(stmts);

    const overLimit = await request(
      '/api/me/bookmark-folders',
      jsonInit('POST', { name: '51個目' }, cookie),
    );
    expect(overLimit.status).toBe(403);
    expect(await errorCode(overLimit)).toBe('QUOTA_EXCEEDED');

    const folderId = newId();
    await env.DB.prepare('INSERT INTO bookmark_folders (id, user_id, name) VALUES (?, ?, ?)')
      .bind(folderId, userId, 'テストフォルダ')
      .run();

    const quiz1 = await seedQuiz({ teamId, title: 'クイズ1' });
    const quiz2 = await seedQuiz({ teamId, title: 'クイズ2' });
    await env.DB.prepare('INSERT INTO bookmarks (user_id, quiz_set_id, folder_id) VALUES (?, ?, ?)')
      .bind(userId, quiz1, folderId)
      .run();
    await env.DB.prepare('INSERT INTO bookmarks (user_id, quiz_set_id, folder_id) VALUES (?, ?, ?)')
      .bind(userId, quiz2, null)
      .run();

    const filtered = await request(`/api/me/bookmarks?folder_id=${folderId}`, {
      headers: { cookie },
    });
    const filteredBody = (await filtered.json()) as { items: Array<{ id: string }> };
    expect(filteredBody.items.map((i) => i.id)).toEqual([quiz1]);

    const all = await request('/api/me/bookmarks', { headers: { cookie } });
    const allBody = (await all.json()) as { items: Array<{ id: string }> };
    expect(allBody.items.length).toBe(2);

    const del = await request(`/api/me/bookmark-folders/${folderId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(del.status).toBe(204);

    const afterDelRow = await env.DB.prepare(
      'SELECT folder_id FROM bookmarks WHERE quiz_set_id = ?',
    )
      .bind(quiz1)
      .first<{ folder_id: string | null }>();
    expect(afterDelRow?.folder_id).toBeNull();
  });
});

// ---- admin subjects -------------------------------------------------------

describe('/api/admin/subjects', () => {
  it('非 admin は403', async () => {
    const { cookie } = await seedUser();
    const res = await request(
      '/api/admin/subjects',
      jsonInit('POST', { slug: 'x', name: 'X' }, cookie),
    );
    expect(res.status).toBe(403);
  });

  it('slug 重複は409、使用中の科目の削除は409', async () => {
    const admin = await seedUser('admin');

    const create1 = await request(
      '/api/admin/subjects',
      jsonInit('POST', { slug: 'science', name: '理科' }, admin.cookie),
    );
    expect(create1.status).toBe(201);
    const subject1 = (await create1.json()) as { id: string };

    const dup = await request(
      '/api/admin/subjects',
      jsonInit('POST', { slug: 'science', name: '理科2' }, admin.cookie),
    );
    expect(dup.status).toBe(409);
    expect(await errorCode(dup)).toBe('CONFLICT');

    const teamId = await seedTeam();
    await seedQuiz({ teamId, subjectId: subject1.id, title: '使用中' });

    const del = await request(`/api/admin/subjects/${subject1.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    });
    expect(del.status).toBe(409);
    expect(await errorCode(del)).toBe('CONFLICT');
  });

  it('未使用の科目は削除できる', async () => {
    const admin = await seedUser('admin');
    const create = await request(
      '/api/admin/subjects',
      jsonInit('POST', { slug: 'unused', name: '未使用' }, admin.cookie),
    );
    const subject = (await create.json()) as { id: string };

    const del = await request(`/api/admin/subjects/${subject.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    });
    expect(del.status).toBe(204);
  });
});
