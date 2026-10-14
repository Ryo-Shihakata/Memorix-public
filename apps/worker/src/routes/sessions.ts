import { checkAnswer, LIMITS } from '@memorix/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { apiError } from '../lib/errors';
import { newId } from '../lib/id';
import {
  checkPublicQuizAccess,
  fetchQuizSetRow,
  fetchQuizSetRowByShareToken,
  loadPlayPayload,
  type QuizSetRow,
} from '../lib/quizAccess';
import { RATE_LIMITS, rateLimit } from '../lib/rateLimit';
import { createSessionSchema, submitAnswersSchema } from '../lib/sessionSchemas';
import { zv } from '../lib/validate';

const sessions = new Hono<AppEnv>();

// 出題順シャッフル（§8.1）。公平なランダム性は求めるが暗号学的な安全性は不要なため Math.random で十分。
function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

// POST /api/sessions: 認証不要。{quizSetId} または {shareToken}。RL: session 60/時/IP（§8.1, §11）
sessions.post('/', rateLimit(RATE_LIMITS.session), zv('json', createSessionSchema), async (c) => {
  const { quizSetId, shareToken } = c.req.valid('json');
  const user = c.get('user');

  let row: QuizSetRow | null;
  if (shareToken) {
    row = await fetchQuizSetRowByShareToken(c.env.DB, shareToken);
  } else {
    row = await fetchQuizSetRow(c.env.DB, quizSetId as string);
    // unlisted は shareToken 経由必須。quizSetId 直指定は404（§8.1、quiz-sets/:id のメタ取得とは異なる規則）
    if (row && row.visibility === 'unlisted') {
      return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
    }
  }
  if (!row) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  const access = await checkPublicQuizAccess(c.env.DB, row, user);
  if (access === 'not_found') {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }

  const { results: questionRows } = await c.env.DB.prepare(
    'SELECT id FROM questions WHERE quiz_set_id = ? ORDER BY display_order, id',
  )
    .bind(row.id)
    .all<{ id: string }>();
  let questionOrder = questionRows.map((q) => q.id);
  if (row.shuffle_questions === 1) {
    questionOrder = shuffle(questionOrder);
  }

  const sessionId = newId();
  const userAgent = c.req.header('user-agent') ?? null;
  const ipCountry = c.req.raw.cf?.country ?? null;

  await c.env.DB.prepare(
    `INSERT INTO quiz_sessions
       (id, quiz_set_id, user_id, question_order, visibility_snapshot, user_agent, ip_country)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      sessionId,
      row.id,
      user?.id ?? null,
      JSON.stringify(questionOrder),
      row.visibility,
      userAgent,
      ipCountry,
    )
    .run();

  const payload = await loadPlayPayload(c.env.DB, sessionId, row, questionOrder);
  return c.json(payload, 201);
});

interface SessionRow {
  id: string;
  quiz_set_id: string;
  submitted_at: string | null;
  question_order: string;
  expired: number;
}

interface QuizBlankRow {
  id: string;
  question_id: string;
  blank_order: number;
  accepted_answers: string;
}

// POST /api/sessions/:id/submit: §8.2
sessions.post('/:id/submit', zv('json', submitAnswersSchema), async (c) => {
  const sessionId = c.req.param('id');
  const { answers } = c.req.valid('json');

  const session = await c.env.DB.prepare(
    `SELECT id, quiz_set_id, submitted_at, question_order,
       (started_at <= datetime('now', ?)) AS expired
     FROM quiz_sessions WHERE id = ?`,
  )
    .bind(`-${LIMITS.SESSION_SUBMIT_WINDOW_HOURS} hours`, sessionId)
    .first<SessionRow>();
  if (!session) {
    return apiError(c, 404, 'NOT_FOUND', 'セッションが見つかりません。');
  }
  if (session.submitted_at !== null) {
    return apiError(c, 409, 'CONFLICT', 'このセッションは既に提出済みです。');
  }
  if (session.expired === 1) {
    return apiError(c, 409, 'CONFLICT', '提出期限が切れています。');
  }

  const quizSet = await c.env.DB.prepare('SELECT normalize_kana FROM quiz_sets WHERE id = ?')
    .bind(session.quiz_set_id)
    .first<{ normalize_kana: number }>();
  if (!quizSet) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  const normalizeKana = quizSet.normalize_kana === 1;

  const { results: blanks } = await c.env.DB.prepare(
    `SELECT b.id, b.question_id, b.blank_order, b.accepted_answers
     FROM blanks b JOIN questions q ON q.id = b.question_id
     WHERE q.quiz_set_id = ?`,
  )
    .bind(session.quiz_set_id)
    .all<QuizBlankRow>();
  const blankById = new Map(blanks.map((b) => [b.id, b]));

  // このクイズに属さない blankId が混じっていたら400（§8.2）
  for (const a of answers) {
    if (!blankById.has(a.blankId)) {
      return apiError(c, 400, 'VALIDATION', '不正な空欄IDが含まれています。');
    }
  }

  const answerByBlankId = new Map(answers.map((a) => [a.blankId, a]));
  const questionOrder = JSON.parse(session.question_order) as string[];
  const orderIndex = new Map(questionOrder.map((id, i) => [id, i]));
  const orderedBlanks = [...blanks].sort((x, y) => {
    const xi = orderIndex.get(x.question_id) ?? 0;
    const yi = orderIndex.get(y.question_id) ?? 0;
    if (xi !== yi) return xi - yi;
    return x.blank_order - y.blank_order;
  });

  let correctCount = 0;
  const insertStmts = [];
  const results: Array<{
    blankId: string;
    userAnswer: string;
    isCorrect: boolean;
    correctAnswer: string;
  }> = [];
  for (const blank of orderedBlanks) {
    const acceptedAnswers = JSON.parse(blank.accepted_answers) as string[];
    const answered = answerByBlankId.get(blank.id);
    const userAnswer = answered?.answer ?? ''; // 未入力は不正解として記録（§8.2）
    const isCorrect = checkAnswer(userAnswer, acceptedAnswers, { normalizeKana });
    if (isCorrect) correctCount++;

    insertStmts.push(
      c.env.DB.prepare(
        `INSERT INTO user_answers
           (id, session_id, blank_id, question_id, user_answer, is_correct, time_to_answer_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId(),
        sessionId,
        blank.id,
        blank.question_id,
        userAnswer,
        isCorrect ? 1 : 0,
        answered?.timeToAnswerMs ?? null,
      ),
    );
    results.push({
      blankId: blank.id,
      userAnswer,
      isCorrect,
      correctAnswer: acceptedAnswers[0] ?? '',
    });
  }

  const totalBlanks = orderedBlanks.length;
  insertStmts.push(
    c.env.DB.prepare(
      `UPDATE quiz_sessions SET submitted_at = CURRENT_TIMESTAMP, total_blanks = ?, correct_count = ?
       WHERE id = ?`,
    ).bind(totalBlanks, correctCount, sessionId),
  );
  insertStmts.push(
    c.env.DB.prepare('UPDATE quiz_sets SET play_count = play_count + 1 WHERE id = ?').bind(
      session.quiz_set_id,
    ),
  );
  await c.env.DB.batch(insertStmts);

  return c.json({
    score: {
      correct: correctCount,
      total: totalBlanks,
      percent: totalBlanks > 0 ? Math.round((correctCount / totalBlanks) * 100) : 0,
    },
    results,
  });
});

// GET /api/sessions/:id/result: 提出済みセッションの結果再取得。
// 認可はセッションID（128bitランダム）を知っていること自体（§8.3）。未提出は404
sessions.get('/:id/result', async (c) => {
  const sessionId = c.req.param('id');
  const session = await c.env.DB.prepare(
    `SELECT qs.id, qs.submitted_at, qs.total_blanks, qs.correct_count, qs.question_order,
            q.id AS quiz_set_id, q.title AS quiz_title, q.description AS quiz_description,
            t.name AS team_name
     FROM quiz_sessions qs
     JOIN quiz_sets q ON q.id = qs.quiz_set_id
     JOIN teams t ON t.id = q.team_id
     WHERE qs.id = ?`,
  )
    .bind(sessionId)
    .first<{
      id: string;
      submitted_at: string | null;
      total_blanks: number | null;
      correct_count: number | null;
      question_order: string;
      quiz_set_id: string;
      quiz_title: string;
      quiz_description: string | null;
      team_name: string;
    }>();
  if (!session || session.submitted_at === null) {
    return apiError(c, 404, 'NOT_FOUND', '結果が見つかりません。');
  }

  const { results: answerRows } = await c.env.DB.prepare(
    `SELECT ua.blank_id, ua.user_answer, ua.is_correct, ua.question_id,
            b.blank_order, b.accepted_answers
     FROM user_answers ua JOIN blanks b ON b.id = ua.blank_id
     WHERE ua.session_id = ?`,
  )
    .bind(sessionId)
    .all<{
      blank_id: string;
      user_answer: string;
      is_correct: number;
      question_id: string;
      blank_order: number;
      accepted_answers: string;
    }>();

  const questionOrder = JSON.parse(session.question_order) as string[];
  const orderIndex = new Map(questionOrder.map((id, i) => [id, i]));
  const orderedAnswers = [...answerRows].sort((x, y) => {
    const xi = orderIndex.get(x.question_id) ?? 0;
    const yi = orderIndex.get(y.question_id) ?? 0;
    if (xi !== yi) return xi - yi;
    return x.blank_order - y.blank_order;
  });

  const totalBlanks = session.total_blanks ?? 0;
  const correctCount = session.correct_count ?? 0;
  return c.json({
    score: {
      correct: correctCount,
      total: totalBlanks,
      percent: totalBlanks > 0 ? Math.round((correctCount / totalBlanks) * 100) : 0,
    },
    results: orderedAnswers.map((a) => ({
      blankId: a.blank_id,
      userAnswer: a.user_answer,
      isCorrect: a.is_correct === 1,
      correctAnswer: (JSON.parse(a.accepted_answers) as string[])[0] ?? '',
    })),
    quizSet: {
      id: session.quiz_set_id,
      title: session.quiz_title,
      description: session.quiz_description,
      teamName: session.team_name,
    },
  });
});

export default sessions;
