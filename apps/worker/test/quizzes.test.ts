import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newId } from '../src/lib/id';
import { addMember, errorCode, jsonInit, request, seedTeam, seedUser } from './helpers';

// ---- テスト用シードヘルパー ----------------------------------------------

async function seedSubject(): Promise<string> {
  const id = newId();
  await env.DB.prepare('INSERT INTO subjects (id, slug, name) VALUES (?, ?, ?)')
    .bind(id, `subject-${id}`, 'テスト科目')
    .run();
  return id;
}

async function seedImage(teamId: string): Promise<string> {
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO images (id, team_id, r2_key, filename, mime_type, file_size)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, teamId, `teams/${teamId}/${id}.webp`, 'test.webp', 'image/webp', 1000)
    .run();
  return id;
}

interface QuizSetJson {
  id: string;
  title: string;
  visibility: string;
  shareUrl: string | null;
  questionCount: number;
}

async function createQuiz(
  teamId: string,
  cookie: string,
  body: Record<string, unknown> = { title: 'テストクイズ' },
): Promise<QuizSetJson> {
  const res = await request(`/api/teams/${teamId}/quiz-sets`, jsonInit('POST', body, cookie));
  expect(res.status).toBe(201);
  return (await res.json()) as QuizSetJson;
}

async function addTextQuestion(
  teamId: string,
  quizId: string,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> {
  const body = {
    type: 'text',
    textContent: '東京は[b:1]の首都です。',
    blanks: [{ blankOrder: 1, acceptedAnswers: ['日本'] }],
    ...overrides,
  };
  const res = await request(
    `/api/teams/${teamId}/quiz-sets/${quizId}/questions`,
    jsonInit('POST', body, cookie),
  );
  return { status: res.status, body: await res.json() };
}

// ---- クイズ CRUD（§7.6） -------------------------------------------------

describe('quiz-sets CRUD', () => {
  it('editor は作成できる(201)。viewer は403', async () => {
    const editor = await seedUser();
    const viewer = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    await addMember(teamId, viewer.id, 'viewer');

    const ng = await request(
      `/api/teams/${teamId}/quiz-sets`,
      jsonInit('POST', { title: 'x' }, viewer.cookie),
    );
    expect(ng.status).toBe(403);

    const quiz = await createQuiz(teamId, editor.cookie, {
      title: '数学クイズ',
      description: '説明',
    });
    expect(quiz.title).toBe('数学クイズ');
    expect(quiz.visibility).toBe('private');
    expect(quiz.questionCount).toBe(0);
  });

  it('QUIZ_SETS_PER_TEAM(500)超過は403 QUOTA_EXCEEDED', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');

    const stmts = [];
    for (let i = 0; i < 500; i++) {
      stmts.push(
        env.DB.prepare('INSERT INTO quiz_sets (id, team_id, title) VALUES (?, ?, ?)').bind(
          newId(),
          teamId,
          `q-${i}`,
        ),
      );
    }
    await env.DB.batch(stmts);

    const res = await request(
      `/api/teams/${teamId}/quiz-sets`,
      jsonInit('POST', { title: '501個目' }, editor.cookie),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('QUOTA_EXCEEDED');
  });

  it('存在しない folderId/subjectId は400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');

    const badFolder = await request(
      `/api/teams/${teamId}/quiz-sets`,
      jsonInit('POST', { title: 'x', folderId: newId() }, editor.cookie),
    );
    expect(badFolder.status).toBe(400);

    const badSubject = await request(
      `/api/teams/${teamId}/quiz-sets`,
      jsonInit('POST', { title: 'x', subjectId: newId() }, editor.cookie),
    );
    expect(badSubject.status).toBe(400);
  });

  it('GET .../quiz-sets?q= はタイトル・説明の部分一致', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    await createQuiz(teamId, editor.cookie, { title: '英単語クイズ' });
    await createQuiz(teamId, editor.cookie, { title: '数学クイズ', description: '英語も少し' });
    await createQuiz(teamId, editor.cookie, { title: '歴史クイズ' });

    const res = await request(`/api/teams/${teamId}/quiz-sets?q=${encodeURIComponent('英')}`, {
      headers: { cookie: editor.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: QuizSetJson[]; total: number };
    expect(body.total).toBe(2);
  });

  it('GET .../quiz-sets/:id は viewer もフル構造(正解込み)取得可。書き込みは403', async () => {
    const editor = await seedUser();
    const viewer = await seedUser();
    const outsider = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    await addMember(teamId, viewer.id, 'viewer');
    const quiz = await createQuiz(teamId, editor.cookie);
    await addTextQuestion(teamId, quiz.id, editor.cookie);

    const viewerGet = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}`, {
      headers: { cookie: viewer.cookie },
    });
    expect(viewerGet.status).toBe(200);
    const full = (await viewerGet.json()) as {
      questions: Array<{ blanks: Array<{ acceptedAnswers: string[] }> }>;
    };
    expect(full.questions[0]?.blanks[0]?.acceptedAnswers).toEqual(['日本']);

    const viewerPatch = await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}`,
      jsonInit('PATCH', { title: 'x' }, viewer.cookie),
    );
    expect(viewerPatch.status).toBe(403);

    const outsiderGet = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}`, {
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderGet.status).toBe(403);
  });

  it('PATCH は editor 以上。title/description/folderId/subjectId/shuffleQuestions/normalizeKana/timeLimitSecs を更新', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const subjectId = await seedSubject();

    const res = await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}`,
      jsonInit(
        'PATCH',
        {
          title: '改題',
          subjectId,
          shuffleQuestions: true,
          normalizeKana: true,
          timeLimitSecs: 60,
        },
        editor.cookie,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      title: string;
      shuffleQuestions: boolean;
      normalizeKana: boolean;
      timeLimitSecs: number;
    };
    expect(body.title).toBe('改題');
    expect(body.shuffleQuestions).toBe(true);
    expect(body.normalizeKana).toBe(true);
    expect(body.timeLimitSecs).toBe(60);
  });

  it('DELETE は editor 以上。他チームの id 指定は404', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    const otherTeamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    await addMember(otherTeamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const cross = await request(`/api/teams/${otherTeamId}/quiz-sets/${quiz.id}`, {
      method: 'DELETE',
      headers: { cookie: editor.cookie },
    });
    expect(cross.status).toBe(404);

    const ok = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}`, {
      method: 'DELETE',
      headers: { cookie: editor.cookie },
    });
    expect(ok.status).toBe(204);
    expect(
      await env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ?').bind(quiz.id).first(),
    ).toBeNull();
  });
});

// ---- 複製（§7.6） --------------------------------------------------------

describe('POST .../quiz-sets/:id/duplicate', () => {
  it('子(questions/blanks)がコピーされ、visibility=private・share_tokenはコピーされない', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const subjectId = await seedSubject();
    const quiz = await createQuiz(teamId, editor.cookie, { title: '元クイズ', subjectId });
    await addTextQuestion(teamId, quiz.id, editor.cookie);

    // public化 + share-token発行してからコピーされないことを確認する
    await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'public' }, editor.cookie),
    );
    await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/share-token`, {
      method: 'POST',
      headers: { cookie: editor.cookie },
    });

    const dup = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/duplicate`, {
      method: 'POST',
      headers: { cookie: editor.cookie },
    });
    expect(dup.status).toBe(201);
    const body = (await dup.json()) as {
      id: string;
      visibility: string;
      shareUrl: string | null;
      questions: Array<{ blanks: Array<{ acceptedAnswers: string[] }> }>;
    };
    expect(body.id).not.toBe(quiz.id);
    expect(body.visibility).toBe('private');
    expect(body.shareUrl).toBeNull();
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0]?.blanks[0]?.acceptedAnswers).toEqual(['日本']);

    const shareToken = await env.DB.prepare('SELECT share_token FROM quiz_sets WHERE id = ?')
      .bind(body.id)
      .first<{ share_token: string | null }>();
    expect(shareToken?.share_token).toBeNull();
  });
});

// ---- visibility 切替（§7.6） ----------------------------------------------

describe('PATCH .../quiz-sets/:id/visibility', () => {
  it('科目未設定・質問0問での public 化は400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const noSubject = await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'public' }, editor.cookie),
    );
    expect(noSubject.status).toBe(400);

    const subjectId = await seedSubject();
    await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}`,
      jsonInit('PATCH', { subjectId }, editor.cookie),
    );
    const noQuestion = await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'public' }, editor.cookie),
    );
    expect(noQuestion.status).toBe(400);

    await addTextQuestion(teamId, quiz.id, editor.cookie);
    const ok = await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'public' }, editor.cookie),
    );
    expect(ok.status).toBe(200);
  });

  it('published_at は初回 public/unlisted 化でのみ設定される', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'unlisted' }, editor.cookie),
    );
    const first = await env.DB.prepare('SELECT published_at FROM quiz_sets WHERE id = ?')
      .bind(quiz.id)
      .first<{ published_at: string }>();
    expect(first?.published_at).not.toBeNull();

    await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'private' }, editor.cookie),
    );
    await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'unlisted' }, editor.cookie),
    );
    const second = await env.DB.prepare('SELECT published_at FROM quiz_sets WHERE id = ?')
      .bind(quiz.id)
      .first<{ published_at: string }>();
    expect(second?.published_at).toBe(first?.published_at);
  });
});

// ---- share-token（§7.6） --------------------------------------------------

describe('share-token', () => {
  it('POST で再生成、旧トークンの GET /api/share/:token は404、DELETE で無効化', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    // share エンドポイントは public/unlisted のみアクセス可（private は404）なので unlisted 化しておく
    await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'unlisted' }, editor.cookie),
    );

    const first = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/share-token`, {
      method: 'POST',
      headers: { cookie: editor.cookie },
    });
    expect(first.status).toBe(200);
    const { shareUrl: firstUrl } = (await first.json()) as { shareUrl: string };
    const firstToken = firstUrl.split('/').at(-1) ?? '';

    const okFirst = await request(`/api/share/${firstToken}`);
    expect(okFirst.status).toBe(200);

    const second = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/share-token`, {
      method: 'POST',
      headers: { cookie: editor.cookie },
    });
    const { shareUrl: secondUrl } = (await second.json()) as { shareUrl: string };
    expect(secondUrl).not.toBe(firstUrl);

    const staleAfterRegenerate = await request(`/api/share/${firstToken}`);
    expect(staleAfterRegenerate.status).toBe(404);

    const del = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/share-token`, {
      method: 'DELETE',
      headers: { cookie: editor.cookie },
    });
    expect(del.status).toBe(204);

    const secondToken = secondUrl.split('/').at(-1) ?? '';
    const afterDelete = await request(`/api/share/${secondToken}`);
    expect(afterDelete.status).toBe(404);
  });
});

// ---- 公開閲覧・正解非漏洩（§7.2, §0） -------------------------------------

describe('公開閲覧 GET /api/quiz-sets/:id, /api/share/:token', () => {
  it('public/unlisted は誰でも閲覧可、private は所属チームメンバーのみ(非メンバーは404)', async () => {
    const editor = await seedUser();
    const member = await seedUser();
    const outsider = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    await addMember(teamId, member.id, 'viewer');
    const subjectId = await seedSubject();
    const quiz = await createQuiz(teamId, editor.cookie, { title: '公開テスト', subjectId });
    await addTextQuestion(teamId, quiz.id, editor.cookie);
    await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'public' }, editor.cookie),
    );

    const guest = await request(`/api/quiz-sets/${quiz.id}`);
    expect(guest.status).toBe(200);

    // private に戻すと非メンバーは404、メンバーは200
    await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'private' }, editor.cookie),
    );
    const outsiderRes = await request(`/api/quiz-sets/${quiz.id}`, {
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderRes.status).toBe(404);
    const memberRes = await request(`/api/quiz-sets/${quiz.id}`, {
      headers: { cookie: member.cookie },
    });
    expect(memberRes.status).toBe(200);

    const guestPrivate = await request(`/api/quiz-sets/${quiz.id}`);
    expect(guestPrivate.status).toBe(404);
  });

  it('正解データ(accepted_answers/日本)がレスポンス文字列に含まれない', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const subjectId = await seedSubject();
    const quiz = await createQuiz(teamId, editor.cookie, { title: '正解漏洩チェック', subjectId });
    await addTextQuestion(teamId, quiz.id, editor.cookie);
    await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'public' }, editor.cookie),
    );

    const res = await request(`/api/quiz-sets/${quiz.id}`);
    const text = await res.text();
    expect(text).not.toContain('accepted_answers');
    expect(text).not.toContain('日本');
  });

  it('suspend 済みクイズの公開GETは404、所有チームメンバーには見える', async () => {
    const editor = await seedUser();
    const admin = await seedUser('admin');
    const outsider = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const subjectId = await seedSubject();
    const quiz = await createQuiz(teamId, editor.cookie, { title: 'suspendテスト', subjectId });
    await addTextQuestion(teamId, quiz.id, editor.cookie);
    await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/visibility`,
      jsonInit('PATCH', { visibility: 'public' }, editor.cookie),
    );
    await env.DB.prepare(
      "UPDATE quiz_sets SET suspended_at = CURRENT_TIMESTAMP, suspended_reason = 'test' WHERE id = ?",
    )
      .bind(quiz.id)
      .run();

    const guest = await request(`/api/quiz-sets/${quiz.id}`);
    expect(guest.status).toBe(404);

    const outsiderRes = await request(`/api/quiz-sets/${quiz.id}`, {
      headers: { cookie: outsider.cookie },
    });
    expect(outsiderRes.status).toBe(404);

    const editorRes = await request(`/api/quiz-sets/${quiz.id}`, {
      headers: { cookie: editor.cookie },
    });
    expect(editorRes.status).toBe(200);

    const adminRes = await request(`/api/quiz-sets/${quiz.id}`, {
      headers: { cookie: admin.cookie },
    });
    expect(adminRes.status).toBe(200);
  });

  it('存在しない画像参照(他チーム)は400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    const otherTeamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const otherImageId = await seedImage(otherTeamId);

    const res = await addTextQuestion(teamId, quiz.id, editor.cookie, {
      imageId: otherImageId,
    });
    expect(res.status).toBe(400);
  });
});
