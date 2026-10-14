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

// ---- テスト用シードヘルパー（sessions.test.ts / quizzes.test.ts の流儀に合わせる） -------

interface QuizSetJson {
  id: string;
  title: string;
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

// quiz_sessions に直接1行挿入する（plays/completionRate/avgScorePercent/scoreHistogram/dailyPlays の
// 手計算検証用。question_order は空配列で十分、実際の blanks とは紐付けない）
async function seedRawSession(
  quizSetId: string,
  opts: {
    userId?: string | null;
    totalBlanks?: number | null;
    correctCount?: number | null;
    submittedAt?: string | null;
  } = {},
): Promise<string> {
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO quiz_sessions (id, quiz_set_id, user_id, question_order, total_blanks, correct_count, submitted_at)
     VALUES (?, ?, ?, '[]', ?, ?, ?)`,
  )
    .bind(
      id,
      quizSetId,
      opts.userId ?? null,
      opts.totalBlanks ?? null,
      opts.correctCount ?? null,
      opts.submittedAt ?? null,
    )
    .run();
  return id;
}

async function startAndSubmit(
  quizId: string,
  blankId: string,
  answer: string,
  cookie?: string,
): Promise<void> {
  const startRes = await request('/api/sessions', jsonInit('POST', { quizSetId: quizId }, cookie));
  expect(startRes.status).toBe(201);
  const { sessionId } = (await startRes.json()) as { sessionId: string };
  const submitRes = await request(
    `/api/sessions/${sessionId}/submit`,
    jsonInit('POST', { answers: [{ blankId, answer }] }, cookie),
  );
  expect(submitRes.status).toBe(200);
}

// ---- GET .../quiz-sets/:id/stats（§7.6） -----------------------------------

describe('GET /api/teams/:teamId/quiz-sets/:id/stats', () => {
  it('viewer は閲覧できる。非メンバーは403、存在しないクイズは404', async () => {
    const { teamId, quiz } = await setupPublicQuiz();
    const viewer = await seedUser();
    await addMember(teamId, viewer.id, 'viewer');
    const outsider = await seedUser();

    const ok = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/stats`, {
      headers: { cookie: viewer.cookie },
    });
    expect(ok.status).toBe(200);

    const forbidden = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/stats`, {
      headers: { cookie: outsider.cookie },
    });
    expect(forbidden.status).toBe(403);

    const notFound = await request(`/api/teams/${teamId}/quiz-sets/${newId()}/stats`, {
      headers: { cookie: viewer.cookie },
    });
    expect(notFound.status).toBe(404);
  });

  it('プレイ0件では0除算エラーにならず全て0で返る', async () => {
    const { teamId, editor, quiz } = await setupPublicQuiz();
    const res = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/stats`, {
      headers: { cookie: editor.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plays: number;
      completionRate: number;
      avgScorePercent: number;
      scoreHistogram: number[];
      dailyPlays: Array<{ date: string; count: number }>;
      blankStats: unknown[];
    };
    expect(body.plays).toBe(0);
    expect(body.completionRate).toBe(0);
    expect(body.avgScorePercent).toBe(0);
    expect(body.scoreHistogram).toEqual([0, 0, 0, 0, 0]);
    expect(body.dailyPlays).toHaveLength(30);
    expect(body.dailyPlays.every((d) => d.count === 0)).toBe(true);
    expect(body.blankStats).toHaveLength(1); // 空欄自体は存在する
  });

  it('plays/completionRate/avgScorePercent/scoreHistogramが手計算と一致(境界値0%/20%/100%含む)', async () => {
    const { teamId, editor, quiz } = await setupPublicQuiz();

    // 提出済み3件: 100%(1/1), 0%(0/1), 20%(1/5) → 平均 = (100+0+20)/3 = 40
    await seedRawSession(quiz.id, {
      totalBlanks: 1,
      correctCount: 1,
      submittedAt: new Date().toISOString(),
    });
    await seedRawSession(quiz.id, {
      totalBlanks: 1,
      correctCount: 0,
      submittedAt: new Date().toISOString(),
    });
    await seedRawSession(quiz.id, {
      totalBlanks: 5,
      correctCount: 1,
      submittedAt: new Date().toISOString(),
    });
    // 未提出2件: completionRate の分母には入るが plays には入らない
    await seedRawSession(quiz.id, {});
    await seedRawSession(quiz.id, {});

    const res = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/stats`, {
      headers: { cookie: editor.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plays: number;
      completionRate: number;
      avgScorePercent: number;
      scoreHistogram: number[];
    };
    expect(body.plays).toBe(3);
    expect(body.completionRate).toBeCloseTo(3 / 5);
    expect(body.avgScorePercent).toBe(40);
    // 100% → idx4(80-100%), 0% → idx0(0-19%), 20% → idx1(20-39%)
    expect(body.scoreHistogram).toEqual([1, 1, 0, 0, 1]);
  });

  it('dailyPlaysは30要素・日付昇順・0埋めで、範囲外(31日以上前)の提出は含まれない', async () => {
    const { teamId, editor, quiz } = await setupPublicQuiz();

    const today = new Date();
    await seedRawSession(quiz.id, {
      totalBlanks: 1,
      correctCount: 1,
      submittedAt: today.toISOString(),
    });
    const tooOld = new Date(today.getTime() - 40 * 24 * 60 * 60 * 1000);
    await seedRawSession(quiz.id, {
      totalBlanks: 1,
      correctCount: 1,
      submittedAt: tooOld.toISOString(),
    });

    const res = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/stats`, {
      headers: { cookie: editor.cookie },
    });
    const body = (await res.json()) as { dailyPlays: Array<{ date: string; count: number }> };
    expect(body.dailyPlays).toHaveLength(30);
    // 昇順(古い→新しい)であること
    const dates = body.dailyPlays.map((d) => d.date);
    expect(dates).toEqual([...dates].sort());
    // 最終日(今日)のみカウント1、それ以外は0
    const todayKey = today.toISOString().slice(0, 10);
    const totalCount = body.dailyPlays.reduce((sum, d) => sum + d.count, 0);
    expect(totalCount).toBe(1); // 40日前の分は範囲外で含まれない
    expect(body.dailyPlays.at(-1)?.date).toBe(todayKey);
    expect(body.dailyPlays.at(-1)?.count).toBe(1);
  });

  it('blankStatsのcorrectRate/attempts/topWrongAnswersが実際の提出と一致する(空文字誤答は集計除外)', async () => {
    const { teamId, editor, quiz, question } = await setupPublicQuiz();
    const blankId = question.blanks[0]?.id as string;

    // 正解2件、誤答「パリ」1件、誤答「ロンドン」2件、空文字誤答1件 → attempts=6, correct=2
    await startAndSubmit(quiz.id, blankId, '日本');
    await startAndSubmit(quiz.id, blankId, '日本');
    await startAndSubmit(quiz.id, blankId, 'パリ');
    await startAndSubmit(quiz.id, blankId, 'ロンドン');
    await startAndSubmit(quiz.id, blankId, 'ロンドン');
    await startAndSubmit(quiz.id, blankId, '');

    const res = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/stats`, {
      headers: { cookie: editor.cookie },
    });
    const body = (await res.json()) as {
      blankStats: Array<{
        questionTitle: string | null;
        blankOrder: number;
        correctRate: number;
        attempts: number;
        topWrongAnswers: Array<{ answer: string; count: number }>;
      }>;
    };
    expect(body.blankStats).toHaveLength(1);
    const bs = body.blankStats[0];
    expect(bs?.blankOrder).toBe(1);
    expect(bs?.attempts).toBe(6);
    expect(bs?.correctRate).toBeCloseTo(2 / 6);
    expect(bs?.topWrongAnswers).toEqual([
      { answer: 'ロンドン', count: 2 },
      { answer: 'パリ', count: 1 },
    ]);
  });
});

// ---- GET /api/me/sessions・:id・GET /api/me/stats（§7.1） ------------------

describe('GET /api/me/sessions, /api/me/sessions/:id, /api/me/stats', () => {
  it('me/sessions は本人の分のみページネーションで返る', async () => {
    const { quiz, question } = await setupPublicQuiz();
    const blankId = question.blanks[0]?.id as string;
    const player = await seedUser();
    const other = await seedUser();

    await startAndSubmit(quiz.id, blankId, '日本', player.cookie);
    await startAndSubmit(quiz.id, blankId, 'パリ', other.cookie);

    const res = await request('/api/me/sessions', { headers: { cookie: player.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        id: string;
        score: { correct: number; total: number; percent: number } | null;
      }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]?.score).toEqual({ correct: 1, total: 1, percent: 100 });
  });

  it('me/sessions/:id は本人のみ閲覧でき、他人のセッションIDは404', async () => {
    const { quiz, question } = await setupPublicQuiz();
    const blankId = question.blanks[0]?.id as string;
    const player = await seedUser();
    const other = await seedUser();

    const startRes = await request(
      '/api/sessions',
      jsonInit('POST', { quizSetId: quiz.id }, player.cookie),
    );
    const { sessionId } = (await startRes.json()) as { sessionId: string };
    await request(
      `/api/sessions/${sessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId, answer: '日本' }] }, player.cookie),
    );

    const ownRes = await request(`/api/me/sessions/${sessionId}`, {
      headers: { cookie: player.cookie },
    });
    expect(ownRes.status).toBe(200);
    const ownBody = (await ownRes.json()) as {
      results: Array<{ blankId: string; isCorrect: boolean }>;
    };
    expect(ownBody.results).toHaveLength(1);
    expect(ownBody.results[0]?.isCorrect).toBe(true);

    const otherRes = await request(`/api/me/sessions/${sessionId}`, {
      headers: { cookie: other.cookie },
    });
    expect(otherRes.status).toBe(404);

    const unauth = await request(`/api/me/sessions/${sessionId}`);
    expect(unauth.status).toBe(401);
  });

  it('me/stats: totalSessions/avgScore/recentScores/weakBlanksが手計算と一致', async () => {
    const { quiz, question } = await setupPublicQuiz();
    const blankId = question.blanks[0]?.id as string;
    const player = await seedUser();

    // 正解1件、不正解1件 → avgScore = (100+0)/2 = 50
    await startAndSubmit(quiz.id, blankId, '日本', player.cookie);
    await startAndSubmit(quiz.id, blankId, '違う答え', player.cookie);

    const res = await request('/api/me/stats', { headers: { cookie: player.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalSessions: number;
      avgScore: number;
      recentScores: Array<{ quizTitle: string; percent: number }>;
      weakBlanks: Array<{ blankOrder: number; correctRate: number }>;
    };
    expect(body.totalSessions).toBe(2);
    expect(body.avgScore).toBe(50);
    expect(body.recentScores).toHaveLength(2);
    expect(body.weakBlanks).toHaveLength(1);
    expect(body.weakBlanks[0]?.correctRate).toBeCloseTo(0.5);
  });
});

// ---- GET /api/admin/stats/overview（§7.7） ---------------------------------

describe('GET /api/admin/stats/overview', () => {
  it('非adminは403', async () => {
    const user = await seedUser();
    const res = await request('/api/admin/stats/overview', { headers: { cookie: user.cookie } });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FORBIDDEN');
  });

  it('プレイ0件でも0除算エラーにならず全て0で返る', async () => {
    const admin = await seedUser('admin');
    const res = await request('/api/admin/stats/overview', { headers: { cookie: admin.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dau7: number;
      dau30: number;
      totalPlays: number;
      guestRatio: number;
      deviceRatio: { pc: number; mobile: number; tablet: number };
      topQuizzes: unknown[];
    };
    expect(body.dau7).toBe(0);
    expect(body.dau30).toBe(0);
    expect(body.totalPlays).toBe(0);
    expect(body.guestRatio).toBe(0);
    expect(body.deviceRatio).toEqual({ pc: 0, mobile: 0, tablet: 0 });
  });

  it('guestRatio・deviceRatio・topQuizzesがゲスト/ログイン混在・UA混在のシードと一致する', async () => {
    const { quiz, question } = await setupPublicQuiz();
    const blankId = question.blanks[0]?.id as string;
    const admin = await seedUser('admin');
    const player = await seedUser();

    // ゲスト提出1件(UA未指定→pc扱い)、ログイン提出1件(モバイルUA)
    const guestStart = await request('/api/sessions', jsonInit('POST', { quizSetId: quiz.id }));
    const { sessionId: guestSessionId } = (await guestStart.json()) as { sessionId: string };
    await request(
      `/api/sessions/${guestSessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId, answer: '日本' }] }),
    );

    const userStart = await request('/api/sessions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: player.cookie,
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS) Mobile/15E148',
      },
      body: JSON.stringify({ quizSetId: quiz.id }),
    });
    const { sessionId: userSessionId } = (await userStart.json()) as { sessionId: string };
    await request(
      `/api/sessions/${userSessionId}/submit`,
      jsonInit('POST', { answers: [{ blankId, answer: '日本' }] }, player.cookie),
    );

    const res = await request('/api/admin/stats/overview', { headers: { cookie: admin.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dau7: number;
      totalPlays: number;
      guestRatio: number;
      deviceRatio: { pc: number; mobile: number; tablet: number };
      topQuizzes: Array<{ id: string }>;
    };
    expect(body.totalPlays).toBe(2);
    expect(body.guestRatio).toBeCloseTo(0.5);
    expect(body.deviceRatio).toEqual({ pc: 0.5, mobile: 0.5, tablet: 0 });
    expect(body.dau7).toBe(1); // ログインユーザーのみカウント、ゲストは除外
    expect(body.topQuizzes[0]?.id).toBe(quiz.id);
  });
});
