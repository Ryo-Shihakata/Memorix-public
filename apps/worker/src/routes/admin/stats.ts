import type { AdminStatsOverview } from '@memorix/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import {
  QUIZ_SET_COLUMNS,
  QUIZ_SET_FROM,
  type QuizSetRow,
  toQuizSetSummary,
} from '../../lib/quizAccess';

const stats = new Hono<AppEnv>();

// user_agent の簡易判定（§7.7）: iPad/Tablet を含めば tablet、Mobile を含めば mobile、それ以外は pc
function classifyDevice(userAgent: string | null): 'pc' | 'mobile' | 'tablet' {
  if (!userAgent) return 'pc';
  if (userAgent.includes('iPad') || userAgent.includes('Tablet')) return 'tablet';
  if (userAgent.includes('Mobile')) return 'mobile';
  return 'pc';
}

// GET /api/admin/stats/overview: requireAdmin（呼び出し元でマウント）（§7.7）
stats.get('/overview', async (c) => {
  const dauRow = await c.env.DB.prepare(
    `SELECT
       COUNT(DISTINCT CASE WHEN started_at >= datetime('now', '-7 days') THEN user_id END) AS dau7,
       COUNT(DISTINCT CASE WHEN started_at >= datetime('now', '-30 days') THEN user_id END) AS dau30
     FROM quiz_sessions WHERE user_id IS NOT NULL`,
  ).first<{ dau7: number; dau30: number }>();

  // totalPlays / guestRatio: 提出済みセッションを「プレイ」とみなす
  const playRow = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS guest
     FROM quiz_sessions WHERE submitted_at IS NOT NULL`,
  ).first<{ total: number; guest: number | null }>();
  const totalPlays = playRow?.total ?? 0;
  const guestRatio = totalPlays > 0 ? (playRow?.guest ?? 0) / totalPlays : 0;

  // deviceRatio: 全セッション(開始時点)の user_agent を対象に判定
  const { results: uaRows } = await c.env.DB.prepare('SELECT user_agent FROM quiz_sessions').all<{
    user_agent: string | null;
  }>();
  const deviceCounts = { pc: 0, mobile: 0, tablet: 0 };
  for (const row of uaRows) {
    deviceCounts[classifyDevice(row.user_agent)] += 1;
  }
  const deviceTotal = uaRows.length;
  const deviceRatio = {
    pc: deviceTotal > 0 ? deviceCounts.pc / deviceTotal : 0,
    mobile: deviceTotal > 0 ? deviceCounts.mobile / deviceTotal : 0,
    tablet: deviceTotal > 0 ? deviceCounts.tablet / deviceTotal : 0,
  };

  const { results: topRows } = await c.env.DB.prepare(
    `SELECT ${QUIZ_SET_COLUMNS} ${QUIZ_SET_FROM} ORDER BY qs.play_count DESC, qs.id LIMIT 10`,
  ).all<QuizSetRow>();

  const body: AdminStatsOverview = {
    dau7: dauRow?.dau7 ?? 0,
    dau30: dauRow?.dau30 ?? 0,
    totalPlays,
    guestRatio,
    deviceRatio,
    topQuizzes: topRows.map(toQuizSetSummary),
  };
  return c.json(body);
});

export default stats;
