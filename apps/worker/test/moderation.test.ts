import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newId } from '../src/lib/id';
import { addMember, errorCode, jsonInit, request, seedTeam, seedUser } from './helpers';

// ---- テスト用シードヘルパー（discover.test.ts / quizzes.test.ts の流儀に合わせる） -------

interface SeedQuizOptions {
  teamId: string;
  title?: string;
  visibility?: 'public' | 'unlisted' | 'private';
  suspendedAt?: string | null;
}

async function seedQuiz(opts: SeedQuizOptions): Promise<string> {
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO quiz_sets (id, team_id, title, visibility, published_at, suspended_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      opts.teamId,
      opts.title ?? 'クイズ',
      opts.visibility ?? 'public',
      opts.visibility === 'private' ? null : new Date().toISOString(),
      opts.suspendedAt ?? null,
    )
    .run();
  return id;
}

async function seedQuestionWithBlank(
  quizSetId: string,
): Promise<{ questionId: string; blankId: string }> {
  const questionId = newId();
  await env.DB.prepare(
    `INSERT INTO questions (id, quiz_set_id, type, text_content) VALUES (?, ?, 'text', ?)`,
  )
    .bind(questionId, quizSetId, '[b:1]')
    .run();
  const blankId = newId();
  await env.DB.prepare(
    `INSERT INTO blanks (id, question_id, blank_order, accepted_answers) VALUES (?, ?, 1, ?)`,
  )
    .bind(blankId, questionId, JSON.stringify(['答え']))
    .run();
  return { questionId, blankId };
}

// ---- POST /api/quiz-sets/:id/reports（§7.4, §11） -------------------------

describe('POST /api/quiz-sets/:id/reports', () => {
  it('ゲストは201、reporter_user_id は NULL', async () => {
    const teamId = await seedTeam();
    const quizId = await seedQuiz({ teamId });

    const res = await request(
      `/api/quiz-sets/${quizId}/reports`,
      jsonInit('POST', { reason: 'spam' }),
    );
    expect(res.status).toBe(201);

    const row = await env.DB.prepare(
      'SELECT reporter_user_id, reason FROM reports WHERE quiz_set_id = ?',
    )
      .bind(quizId)
      .first<{ reporter_user_id: string | null; reason: string }>();
    expect(row?.reporter_user_id).toBeNull();
    expect(row?.reason).toBe('spam');
  });

  it('ログイン時は reporter_user_id が設定される', async () => {
    const { id: userId, cookie } = await seedUser();
    const teamId = await seedTeam();
    const quizId = await seedQuiz({ teamId });

    const res = await request(
      `/api/quiz-sets/${quizId}/reports`,
      jsonInit('POST', { reason: 'inappropriate', detail: '不適切な内容です' }, cookie),
    );
    expect(res.status).toBe(201);

    const row = await env.DB.prepare('SELECT reporter_user_id FROM reports WHERE quiz_set_id = ?')
      .bind(quizId)
      .first<{ reporter_user_id: string | null }>();
    expect(row?.reporter_user_id).toBe(userId);
  });

  it('6件目/日/IPで429', async () => {
    const teamId = await seedTeam();
    const quizId = await seedQuiz({ teamId });

    for (let i = 0; i < 5; i++) {
      const res = await request(
        `/api/quiz-sets/${quizId}/reports`,
        jsonInit('POST', { reason: 'other' }),
      );
      expect(res.status).toBe(201);
    }
    const sixth = await request(
      `/api/quiz-sets/${quizId}/reports`,
      jsonInit('POST', { reason: 'other' }),
    );
    expect(sixth.status).toBe(429);
    expect(await errorCode(sixth)).toBe('RATE_LIMITED');
  });

  it('private の非メンバーは404', async () => {
    const { cookie } = await seedUser();
    const teamId = await seedTeam();
    const quizId = await seedQuiz({ teamId, visibility: 'private' });

    const res = await request(
      `/api/quiz-sets/${quizId}/reports`,
      jsonInit('POST', { reason: 'spam' }, cookie),
    );
    expect(res.status).toBe(404);
  });

  it('存在しないクイズは404', async () => {
    const res = await request(
      `/api/quiz-sets/${newId()}/reports`,
      jsonInit('POST', { reason: 'spam' }),
    );
    expect(res.status).toBe(404);
  });

  it('detail 1001文字は400', async () => {
    const teamId = await seedTeam();
    const quizId = await seedQuiz({ teamId });

    const res = await request(
      `/api/quiz-sets/${quizId}/reports`,
      jsonInit('POST', { reason: 'spam', detail: 'a'.repeat(1001) }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
  });
});

// ---- admin: /api/admin/reports ---------------------------------------------

describe('/api/admin/reports', () => {
  it('非adminは403', async () => {
    const { cookie } = await seedUser();
    const res = await request('/api/admin/reports', { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it('status フィルタで絞り込める', async () => {
    const admin = await seedUser('admin');
    const teamId = await seedTeam();
    const quizId = await seedQuiz({ teamId });

    const openId = newId();
    await env.DB.prepare(
      `INSERT INTO reports (id, quiz_set_id, reason, status) VALUES (?, ?, 'spam', 'open')`,
    )
      .bind(openId, quizId)
      .run();
    const dismissedId = newId();
    await env.DB.prepare(
      `INSERT INTO reports (id, quiz_set_id, reason, status) VALUES (?, ?, 'spam', 'dismissed')`,
    )
      .bind(dismissedId, quizId)
      .run();

    const res = await request('/api/admin/reports?status=open', {
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items.map((r) => r.id)).toEqual([openId]);
  });

  it('suspend済みクイズの通報一覧で quizSuspendedAt が非nullで返る', async () => {
    const admin = await seedUser('admin');
    const teamId = await seedTeam();
    const suspendedQuizId = await seedQuiz({ teamId, suspendedAt: new Date().toISOString() });
    const activeQuizId = await seedQuiz({ teamId });

    const suspendedReportId = newId();
    await env.DB.prepare(
      `INSERT INTO reports (id, quiz_set_id, reason, status) VALUES (?, ?, 'spam', 'open')`,
    )
      .bind(suspendedReportId, suspendedQuizId)
      .run();
    const activeReportId = newId();
    await env.DB.prepare(
      `INSERT INTO reports (id, quiz_set_id, reason, status) VALUES (?, ?, 'spam', 'open')`,
    )
      .bind(activeReportId, activeQuizId)
      .run();

    const res = await request('/api/admin/reports?status=open', {
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; quizSuspendedAt: string | null }>;
    };
    const suspendedReport = body.items.find((r) => r.id === suspendedReportId);
    const activeReport = body.items.find((r) => r.id === activeReportId);
    expect(suspendedReport?.quizSuspendedAt).not.toBeNull();
    expect(activeReport?.quizSuspendedAt).toBeNull();
  });

  it('PATCH で status・resolved_by・resolved_at が更新される', async () => {
    const admin = await seedUser('admin');
    const teamId = await seedTeam();
    const quizId = await seedQuiz({ teamId });
    const reportId = newId();
    await env.DB.prepare(
      `INSERT INTO reports (id, quiz_set_id, reason, status) VALUES (?, ?, 'spam', 'open')`,
    )
      .bind(reportId, quizId)
      .run();

    const res = await request(
      `/api/admin/reports/${reportId}`,
      jsonInit('PATCH', { status: 'actioned' }, admin.cookie),
    );
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT status, resolved_by, resolved_at FROM reports WHERE id = ?',
    )
      .bind(reportId)
      .first<{ status: string; resolved_by: string | null; resolved_at: string | null }>();
    expect(row?.status).toBe('actioned');
    expect(row?.resolved_by).toBe(admin.id);
    expect(row?.resolved_at).not.toBeNull();
  });

  it('存在しない通報のPATCHは404', async () => {
    const admin = await seedUser('admin');
    const res = await request(
      `/api/admin/reports/${newId()}`,
      jsonInit('PATCH', { status: 'actioned' }, admin.cookie),
    );
    expect(res.status).toBe(404);
  });
});

// ---- admin: /api/admin/quiz-sets/:id/suspend, DELETE -----------------------

describe('/api/admin/quiz-sets/:id/suspend', () => {
  it('非adminは403', async () => {
    const { cookie } = await seedUser();
    const res = await request(
      `/api/admin/quiz-sets/${newId()}/suspend`,
      jsonInit('POST', { reason: 'x' }, cookie),
    );
    expect(res.status).toBe(403);
  });

  it('設定後: 公開GETは非所有者404・所有チームメンバーは取得可、セッション作成も404。解除で復帰', async () => {
    const admin = await seedUser('admin');
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quizId = await seedQuiz({ teamId });
    await seedQuestionWithBlank(quizId);

    const suspendRes = await request(
      `/api/admin/quiz-sets/${quizId}/suspend`,
      jsonInit('POST', { reason: '不適切な内容' }, admin.cookie),
    );
    expect(suspendRes.status).toBe(204);

    const guestGet = await request(`/api/quiz-sets/${quizId}`);
    expect(guestGet.status).toBe(404);

    const memberGet = await request(`/api/quiz-sets/${quizId}`, {
      headers: { cookie: editor.cookie },
    });
    expect(memberGet.status).toBe(200);

    const sessionRes = await request('/api/sessions', jsonInit('POST', { quizSetId: quizId }));
    expect(sessionRes.status).toBe(404);

    const unsuspendRes = await request(`/api/admin/quiz-sets/${quizId}/suspend`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    });
    expect(unsuspendRes.status).toBe(204);

    const afterGuestGet = await request(`/api/quiz-sets/${quizId}`);
    expect(afterGuestGet.status).toBe(200);

    const afterSessionRes = await request('/api/sessions', jsonInit('POST', { quizSetId: quizId }));
    expect(afterSessionRes.status).toBe(201);
  });
});

describe('DELETE /api/admin/quiz-sets/:id', () => {
  it('非adminは403', async () => {
    const { cookie } = await seedUser();
    const res = await request(`/api/admin/quiz-sets/${newId()}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(res.status).toBe(403);
  });

  it('完全削除で quiz_sets と子(questions/blanks)がCASCADE削除される', async () => {
    const admin = await seedUser('admin');
    const teamId = await seedTeam();
    const quizId = await seedQuiz({ teamId });
    const { questionId, blankId } = await seedQuestionWithBlank(quizId);

    const res = await request(`/api/admin/quiz-sets/${quizId}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(204);

    const quiz = await env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ?').bind(quizId).first();
    expect(quiz).toBeNull();
    const question = await env.DB.prepare('SELECT id FROM questions WHERE id = ?')
      .bind(questionId)
      .first();
    expect(question).toBeNull();
    const blank = await env.DB.prepare('SELECT id FROM blanks WHERE id = ?').bind(blankId).first();
    expect(blank).toBeNull();
  });

  it('存在しないクイズは404', async () => {
    const admin = await seedUser('admin');
    const res = await request(`/api/admin/quiz-sets/${newId()}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(404);
  });
});

// ---- admin: /api/admin/users ------------------------------------------------

describe('/api/admin/users', () => {
  it('非adminは全エンドポイントで403', async () => {
    const { cookie } = await seedUser();
    const targetId = newId();

    expect((await request('/api/admin/users', { headers: { cookie } })).status).toBe(403);
    expect(
      (await request(`/api/admin/users/${targetId}/ban`, jsonInit('POST', {}, cookie))).status,
    ).toBe(403);
    expect(
      (
        await request(`/api/admin/users/${targetId}/ban`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/admin/users/${targetId}/role`,
          jsonInit('PATCH', { role: 'admin' }, cookie),
        )
      ).status,
    ).toBe(403);
  });

  it('q は email/name の LIKE 部分一致検索', async () => {
    const admin = await seedUser('admin');
    const target = await seedUser();
    await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?')
      .bind('検索対象太郎', target.id)
      .run();

    const res = await request('/api/admin/users?q=検索対象', { headers: { cookie: admin.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number };
    expect(body.items.map((u) => u.id)).toContain(target.id);
  });

  it('BANの設定後は該当ユーザーのセッションが403 BANNED、解除で復帰', async () => {
    const admin = await seedUser('admin');
    const target = await seedUser();

    const banRes = await request(
      `/api/admin/users/${target.id}/ban`,
      jsonInit('POST', {}, admin.cookie),
    );
    expect(banRes.status).toBe(204);

    const meRes = await request('/api/me', { headers: { cookie: target.cookie } });
    expect(meRes.status).toBe(403);
    expect(await errorCode(meRes)).toBe('BANNED');

    const unbanRes = await request(`/api/admin/users/${target.id}/ban`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie },
    });
    expect(unbanRes.status).toBe(204);

    // BAN解除後、KVセッションは既に削除されているためログインし直しが必要（middleware/session.tsの挙動通り）
    const row = await env.DB.prepare('SELECT banned_at FROM users WHERE id = ?')
      .bind(target.id)
      .first<{ banned_at: string | null }>();
    expect(row?.banned_at).toBeNull();
  });

  it('自分自身のBANは400', async () => {
    const admin = await seedUser('admin');
    const res = await request(
      `/api/admin/users/${admin.id}/ban`,
      jsonInit('POST', {}, admin.cookie),
    );
    expect(res.status).toBe(400);
  });

  it('存在しないユーザーのBANは404', async () => {
    const admin = await seedUser('admin');
    const res = await request(
      `/api/admin/users/${newId()}/ban`,
      jsonInit('POST', {}, admin.cookie),
    );
    expect(res.status).toBe(404);
  });

  it('PATCH role でユーザーの権限を変更できる', async () => {
    const admin = await seedUser('admin');
    const target = await seedUser();

    const res = await request(
      `/api/admin/users/${target.id}/role`,
      jsonInit('PATCH', { role: 'admin' }, admin.cookie),
    );
    expect(res.status).toBe(204);

    const row = await env.DB.prepare('SELECT role FROM users WHERE id = ?')
      .bind(target.id)
      .first<{ role: string }>();
    expect(row?.role).toBe('admin');
  });

  it('自分自身の降格は400', async () => {
    const admin = await seedUser('admin');
    const res = await request(
      `/api/admin/users/${admin.id}/role`,
      jsonInit('PATCH', { role: 'user' }, admin.cookie),
    );
    expect(res.status).toBe(400);

    const row = await env.DB.prepare('SELECT role FROM users WHERE id = ?')
      .bind(admin.id)
      .first<{ role: string }>();
    expect(row?.role).toBe('admin');
  });
});
