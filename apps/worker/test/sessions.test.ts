import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newId } from '../src/lib/id';
import {
  addMember,
  errorCode,
  jsonInit,
  request,
  type SeededUser,
  seedTeam,
  seedUser,
} from './helpers';

// ---- テスト用シードヘルパー（quizzes.test.ts の流儀に合わせる） -----------

interface QuizSetJson {
  id: string;
  title: string;
  visibility: string;
  shareUrl: string | null;
}

async function seedSubject(): Promise<string> {
  const id = newId();
  await env.DB.prepare('INSERT INTO subjects (id, slug, name) VALUES (?, ?, ?)')
    .bind(id, `subject-${id}`, 'テスト科目')
    .run();
  return id;
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

interface QuestionJson {
  id: string;
  blanks: Array<{ id: string; blankOrder: number }>;
  cells?: Array<{ blankId: string | null; cellType: string }> | null;
}

async function addTextQuestion(
  teamId: string,
  quizId: string,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<QuestionJson> {
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
  expect(res.status).toBe(201);
  return (await res.json()) as QuestionJson;
}

async function addTableQuestion(
  teamId: string,
  quizId: string,
  cookie: string,
): Promise<QuestionJson> {
  // text問題の本文に「東京」が出てくるため、正解漏洩テストと衝突しない値を使う
  const body = {
    type: 'table',
    blanks: [{ blankOrder: 1, acceptedAnswers: ['パリ'] }],
    cells: [
      { rowIndex: 0, colIndex: 0, cellType: 'header', content: 'フランスの首都' },
      { rowIndex: 1, colIndex: 0, cellType: 'blank', blankOrder: 1 },
    ],
  };
  const res = await request(
    `/api/teams/${teamId}/quiz-sets/${quizId}/questions`,
    jsonInit('POST', body, cookie),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as QuestionJson;
}

async function setVisibility(
  teamId: string,
  quizId: string,
  cookie: string,
  visibility: 'public' | 'unlisted' | 'private',
): Promise<void> {
  const res = await request(
    `/api/teams/${teamId}/quiz-sets/${quizId}/visibility`,
    jsonInit('PATCH', { visibility }, cookie),
  );
  expect(res.status).toBe(200);
}

// editor + subject + public 化済みクイズ + 1問(text, blank1つ, 正解「日本」)を用意
async function setupPublicQuiz(): Promise<{
  teamId: string;
  editor: SeededUser;
  quiz: QuizSetJson;
  question: QuestionJson;
}> {
  const editor = await seedUser();
  const teamId = await seedTeam();
  await addMember(teamId, editor.id, 'editor');
  const subjectId = await seedSubject();
  const quiz = await createQuiz(teamId, editor.cookie, { title: '地理クイズ', subjectId });
  const question = await addTextQuestion(teamId, quiz.id, editor.cookie);
  await setVisibility(teamId, quiz.id, editor.cookie, 'public');
  return { teamId, editor, quiz, question };
}

interface PlayPayloadJson {
  sessionId: string;
  quizSet: { id: string; title: string; normalizeKana: boolean };
  questions: Array<{
    id: string;
    blanks: Array<{ id: string }>;
    cells: Array<{ blankId: string | null }> | null;
  }>;
}

async function startSession(
  body: Record<string, unknown>,
  cookie?: string,
): Promise<{ status: number; res: Response }> {
  const res = await request('/api/sessions', jsonInit('POST', body, cookie));
  return { status: res.status, res };
}

// ---- セッション開始（§8.1） -----------------------------------------------

describe('POST /api/sessions', () => {
  it('正解データ(accepted_answers・正解値)がレスポンス文字列に含まれない(text/table両型)', async () => {
    const { teamId, editor, quiz } = await setupPublicQuiz();
    await addTableQuestion(teamId, quiz.id, editor.cookie);

    const { res, status } = await startSession({ quizSetId: quiz.id });
    expect(status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain('accepted_answers');
    expect(text).not.toContain('日本');
    expect(text).not.toContain('パリ');
  });

  it('ゲスト・ログインユーザーの双方でセッション開始→提出→結果取得できる', async () => {
    const { quiz, question } = await setupPublicQuiz();
    const blankId = question.blanks[0]?.id as string;

    // ゲスト
    const guestStart = await startSession({ quizSetId: quiz.id });
    expect(guestStart.status).toBe(201);
    const guestPayload = (await guestStart.res.json()) as PlayPayloadJson;
    expect(guestPayload.sessionId).toBeTruthy();

    const guestSubmit = await request(
      `/api/sessions/${guestPayload.sessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId, answer: '日本' }] }),
    );
    expect(guestSubmit.status).toBe(200);
    const guestResult = (await guestSubmit.json()) as { score: { correct: number; total: number } };
    expect(guestResult.score).toEqual({ correct: 1, total: 1, percent: 100 });

    const guestGet = await request(`/api/sessions/${guestPayload.sessionId}/result`);
    expect(guestGet.status).toBe(200);

    // ログインユーザー
    const player = await seedUser();
    const userStart = await startSession({ quizSetId: quiz.id }, player.cookie);
    expect(userStart.status).toBe(201);
    const userPayload = (await userStart.res.json()) as PlayPayloadJson;

    const userSubmit = await request(
      `/api/sessions/${userPayload.sessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId, answer: 'とうきょう' }] }, player.cookie),
    );
    expect(userSubmit.status).toBe(200);
    const userResult = (await userSubmit.json()) as { score: { correct: number; total: number } };
    // acceptedAnswers=['日本'] なので「とうきょう」は不正解
    expect(userResult.score).toEqual({ correct: 0, total: 1, percent: 0 });

    const sessionRow = await env.DB.prepare('SELECT user_id FROM quiz_sessions WHERE id = ?')
      .bind(userPayload.sessionId)
      .first<{ user_id: string }>();
    expect(sessionRow?.user_id).toBe(player.id);
  });

  it('unlisted: shareTokenなしのquizSetId直指定は404、shareToken経由は成功', async () => {
    const { teamId, editor, quiz } = await setupPublicQuiz();
    await setVisibility(teamId, quiz.id, editor.cookie, 'unlisted');
    const tokenRes = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/share-token`, {
      method: 'POST',
      headers: { cookie: editor.cookie },
    });
    const { shareUrl } = (await tokenRes.json()) as { shareUrl: string };
    const shareToken = shareUrl.split('/').at(-1) as string;

    const direct = await startSession({ quizSetId: quiz.id });
    expect(direct.status).toBe(404);

    const viaToken = await startSession({ shareToken });
    expect(viaToken.status).toBe(201);
  });

  it('private: 非メンバーは404、メンバーは成功', async () => {
    const editor = await seedUser();
    const member = await seedUser();
    const outsider = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    await addMember(teamId, member.id, 'viewer');
    const quiz = await createQuiz(teamId, editor.cookie, { title: '非公開クイズ' });
    await addTextQuestion(teamId, quiz.id, editor.cookie);
    // 作成直後は private のまま

    const guestRes = await startSession({ quizSetId: quiz.id });
    expect(guestRes.status).toBe(404);

    const outsiderRes = await startSession({ quizSetId: quiz.id }, outsider.cookie);
    expect(outsiderRes.status).toBe(404);

    const memberRes = await startSession({ quizSetId: quiz.id }, member.cookie);
    expect(memberRes.status).toBe(201);
  });

  it('shuffle_questions=1 でquestion_orderがセッションに保存され、レスポンスがその順になる', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const subjectId = await seedSubject();
    const quiz = await createQuiz(teamId, editor.cookie, { title: 'シャッフルクイズ', subjectId });
    for (let i = 1; i <= 5; i++) {
      await addTextQuestion(teamId, quiz.id, editor.cookie, {
        title: `問題${i}`,
        textContent: `${i}番目の[b:1]`,
        blanks: [{ blankOrder: 1, acceptedAnswers: ['x'] }],
      });
    }
    await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}`,
      jsonInit('PATCH', { shuffleQuestions: true }, editor.cookie),
    );
    await setVisibility(teamId, quiz.id, editor.cookie, 'public');

    const { status, res } = await startSession({ quizSetId: quiz.id });
    expect(status).toBe(201);
    const payload = (await res.json()) as PlayPayloadJson;

    const stored = await env.DB.prepare('SELECT question_order FROM quiz_sessions WHERE id = ?')
      .bind(payload.sessionId)
      .first<{ question_order: string }>();
    const storedOrder = JSON.parse(stored?.question_order ?? '[]') as string[];
    expect(payload.questions.map((q) => q.id)).toEqual(storedOrder);
    expect(storedOrder).toHaveLength(5);
  });

  it('RL: 61回目のセッション作成は429(別IPは別カウント)', async () => {
    const { quiz } = await setupPublicQuiz();
    const ipInit = (ip: string): RequestInit => ({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ quizSetId: quiz.id }),
    });

    for (let i = 0; i < 60; i++) {
      const res = await request('/api/sessions', ipInit('203.0.113.1'));
      expect(res.status).toBe(201);
    }
    const blocked = await request('/api/sessions', ipInit('203.0.113.1'));
    expect(blocked.status).toBe(429);
    expect(await errorCode(blocked)).toBe('RATE_LIMITED');

    const otherIp = await request('/api/sessions', ipInit('203.0.113.2'));
    expect(otherIp.status).toBe(201);
  }, 30000);
});

// ---- 提出（§8.2） ----------------------------------------------------------

describe('POST /api/sessions/:id/submit', () => {
  it('未入力の空欄は不正解として記録され、部分正解のスコアが計算される', async () => {
    const { teamId, editor, quiz, question } = await setupPublicQuiz();
    const question2 = await addTextQuestion(teamId, quiz.id, editor.cookie, {
      title: '2問目',
      textContent: '富士山は[b:1]で最も高い山です。',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['日本'] }],
    });

    const { res } = await startSession({ quizSetId: quiz.id });
    const payload = (await res.json()) as PlayPayloadJson;

    const blank1 = question.blanks[0]?.id as string;
    const submit = await request(
      `/api/sessions/${payload.sessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId: blank1, answer: '日本' }] }),
    );
    expect(submit.status).toBe(200);
    const body = (await submit.json()) as {
      score: { correct: number; total: number; percent: number };
      results: Array<{ blankId: string; userAnswer: string; isCorrect: boolean }>;
    };
    expect(body.score).toEqual({ correct: 1, total: 2, percent: 50 });
    const blank2Result = body.results.find((r) => r.blankId === question2.blanks[0]?.id);
    expect(blank2Result?.userAnswer).toBe('');
    expect(blank2Result?.isCorrect).toBe(false);
  });

  it('このクイズに属さないblankIdの混入は400', async () => {
    const { quiz } = await setupPublicQuiz();
    const { res } = await startSession({ quizSetId: quiz.id });
    const payload = (await res.json()) as PlayPayloadJson;

    const submit = await request(
      `/api/sessions/${payload.sessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId: newId(), answer: 'x' }] }),
    );
    expect(submit.status).toBe(400);
    expect(await errorCode(submit)).toBe('VALIDATION');
  });

  it('二重提出は409 CONFLICT', async () => {
    const { quiz, question } = await setupPublicQuiz();
    const { res } = await startSession({ quizSetId: quiz.id });
    const payload = (await res.json()) as PlayPayloadJson;
    const blankId = question.blanks[0]?.id as string;

    const first = await request(
      `/api/sessions/${payload.sessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId, answer: '日本' }] }),
    );
    expect(first.status).toBe(200);

    const second = await request(
      `/api/sessions/${payload.sessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId, answer: '日本' }] }),
    );
    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe('CONFLICT');
  });

  it('開始から24時間超過は409(期限切れ)', async () => {
    const { quiz, question } = await setupPublicQuiz();
    const { res } = await startSession({ quizSetId: quiz.id });
    const payload = (await res.json()) as PlayPayloadJson;
    const blankId = question.blanks[0]?.id as string;

    await env.DB.prepare(
      "UPDATE quiz_sessions SET started_at = datetime('now', '-25 hours') WHERE id = ?",
    )
      .bind(payload.sessionId)
      .run();

    const submit = await request(
      `/api/sessions/${payload.sessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId, answer: '日本' }] }),
    );
    expect(submit.status).toBe(409);
    expect(await errorCode(submit)).toBe('CONFLICT');
  });

  it('play_countはsubmit成功時のみ+1される', async () => {
    const { teamId, quiz, question } = await setupPublicQuiz();
    const blankId = question.blanks[0]?.id as string;

    const before = await env.DB.prepare('SELECT play_count FROM quiz_sets WHERE id = ?')
      .bind(quiz.id)
      .first<{ play_count: number }>();
    expect(before?.play_count).toBe(0);

    const { res } = await startSession({ quizSetId: quiz.id });
    const payload = (await res.json()) as PlayPayloadJson;
    // セッション開始のみでは増えない
    const afterStart = await env.DB.prepare('SELECT play_count FROM quiz_sets WHERE id = ?')
      .bind(quiz.id)
      .first<{ play_count: number }>();
    expect(afterStart?.play_count).toBe(0);

    const submit = await request(
      `/api/sessions/${payload.sessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId, answer: '日本' }] }),
    );
    expect(submit.status).toBe(200);
    const afterSubmit = await env.DB.prepare('SELECT play_count FROM quiz_sets WHERE id = ?')
      .bind(quiz.id)
      .first<{ play_count: number }>();
    expect(afterSubmit?.play_count).toBe(1);

    // 二重submit(409)では増えない
    await request(
      `/api/sessions/${payload.sessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId, answer: '日本' }] }),
    );
    const afterDouble = await env.DB.prepare('SELECT play_count FROM quiz_sets WHERE id = ?')
      .bind(quiz.id)
      .first<{ play_count: number }>();
    expect(afterDouble?.play_count).toBe(1);
    void teamId;
  });
});

// ---- 結果再取得（§8.3） ----------------------------------------------------

describe('GET /api/sessions/:id/result', () => {
  it('未提出セッションは404', async () => {
    const { quiz } = await setupPublicQuiz();
    const { res } = await startSession({ quizSetId: quiz.id });
    const payload = (await res.json()) as PlayPayloadJson;

    const result = await request(`/api/sessions/${payload.sessionId}/result`);
    expect(result.status).toBe(404);
  });

  it('存在しないセッションIDは404', async () => {
    const result = await request(`/api/sessions/${newId()}/result`);
    expect(result.status).toBe(404);
  });
});
