import type { QuizStats } from '@memorix/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { requireTeamRole } from '../../middleware/session';

const stats = new Hono<AppEnv>();

interface SessionScoreRow {
  correct_count: number | null;
  total_blanks: number | null;
}

interface DailyPlayRow {
  d: string;
  n: number;
}

interface BlankMetaRow {
  blank_id: string;
  blank_order: number;
  question_title: string | null;
}

interface AnswerAggRow {
  blank_id: string;
  is_correct: number;
  user_answer: string;
}

// GET .../quiz-sets/:id/stats: viewer 以上（§7.6）
stats.get('/:quizSetId/stats', requireTeamRole('viewer'), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const quizSetId = c.req.param('quizSetId');

  const quiz = await c.env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ? AND team_id = ?')
    .bind(quizSetId, teamId)
    .first();
  if (!quiz) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }

  // plays / completionRate / avgScorePercent（未提出セッションも started の分母に含める）
  const counts = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS started,
       SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS plays,
       AVG(CASE WHEN submitted_at IS NOT NULL AND total_blanks > 0
                THEN correct_count * 100.0 / total_blanks END) AS avg_score
     FROM quiz_sessions WHERE quiz_set_id = ?`,
  )
    .bind(quizSetId)
    .first<{ started: number; plays: number | null; avg_score: number | null }>();

  const started = counts?.started ?? 0;
  const plays = counts?.plays ?? 0;
  const completionRate = started > 0 ? plays / started : 0;
  const avgScorePercent = counts?.avg_score != null ? Math.round(counts.avg_score) : 0;

  // scoreHistogram: 提出済みセッションのスコア分布（0-19/20-39/40-59/60-79/80-100%）
  const { results: scoreRows } = await c.env.DB.prepare(
    `SELECT correct_count, total_blanks FROM quiz_sessions
     WHERE quiz_set_id = ? AND submitted_at IS NOT NULL`,
  )
    .bind(quizSetId)
    .all<SessionScoreRow>();

  const scoreHistogram = [0, 0, 0, 0, 0];
  for (const row of scoreRows) {
    const totalBlanks = row.total_blanks ?? 0;
    const percent = totalBlanks > 0 ? ((row.correct_count ?? 0) / totalBlanks) * 100 : 0;
    const idx = Math.min(Math.floor(percent / 20), 4);
    scoreHistogram[idx] = (scoreHistogram[idx] ?? 0) + 1;
  }

  // dailyPlays: 直近30日(当日含む)を0埋めで日付昇順に整形
  const { results: dailyRows } = await c.env.DB.prepare(
    `SELECT date(submitted_at) AS d, COUNT(*) AS n
     FROM quiz_sessions
     WHERE quiz_set_id = ? AND submitted_at IS NOT NULL
       AND submitted_at >= datetime('now', '-29 days', 'start of day')
     GROUP BY d`,
  )
    .bind(quizSetId)
    .all<DailyPlayRow>();
  const dailyMap = new Map(dailyRows.map((r) => [r.d, r.n]));
  const dailyPlays: Array<{ date: string; count: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyPlays.push({ date: key, count: dailyMap.get(key) ?? 0 });
  }

  // blankStats: 空欄ごとの正答率・出題回数・誤答トップ5
  const { results: blankRows } = await c.env.DB.prepare(
    `SELECT b.id AS blank_id, b.blank_order, q.title AS question_title
     FROM blanks b JOIN questions q ON q.id = b.question_id
     WHERE q.quiz_set_id = ?
     ORDER BY q.display_order, b.blank_order`,
  )
    .bind(quizSetId)
    .all<BlankMetaRow>();

  const { results: answerRows } = await c.env.DB.prepare(
    `SELECT ua.blank_id, ua.is_correct, ua.user_answer
     FROM user_answers ua JOIN blanks b ON b.id = ua.blank_id
     WHERE b.question_id IN (SELECT id FROM questions WHERE quiz_set_id = ?)`,
  )
    .bind(quizSetId)
    .all<AnswerAggRow>();

  interface BlankAgg {
    attempts: number;
    correct: number;
    wrong: Map<string, number>;
  }
  const aggByBlank = new Map<string, BlankAgg>();
  for (const row of answerRows) {
    let agg = aggByBlank.get(row.blank_id);
    if (!agg) {
      agg = { attempts: 0, correct: 0, wrong: new Map() };
      aggByBlank.set(row.blank_id, agg);
    }
    agg.attempts += 1;
    if (row.is_correct === 1) {
      agg.correct += 1;
    } else if (row.user_answer !== '') {
      // 誤答集計: 空文字(未入力)はノイズが大きいため除外する（実装判断）
      agg.wrong.set(row.user_answer, (agg.wrong.get(row.user_answer) ?? 0) + 1);
    }
  }

  const blankStats = blankRows.map((b) => {
    const agg = aggByBlank.get(b.blank_id);
    const attempts = agg?.attempts ?? 0;
    const correct = agg?.correct ?? 0;
    const topWrongAnswers = agg
      ? [...agg.wrong.entries()]
          .sort((x, y) => y[1] - x[1])
          .slice(0, 5)
          .map(([answer, count]) => ({ answer, count }))
      : [];
    return {
      questionTitle: b.question_title,
      blankOrder: b.blank_order,
      correctRate: attempts > 0 ? correct / attempts : 0,
      attempts,
      topWrongAnswers,
    };
  });

  const body: QuizStats = {
    plays,
    completionRate,
    avgScorePercent,
    scoreHistogram,
    dailyPlays,
    blankStats,
  };
  return c.json(body);
});

export default stats;
