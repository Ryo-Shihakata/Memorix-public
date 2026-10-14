import type { Report, ReportStatus } from '@memorix/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { getPagination, pageResult } from '../../lib/pagination';
import { zv } from '../../lib/validate';

interface ReportRow {
  id: string;
  quiz_set_id: string;
  quiz_title: string;
  team_name: string;
  reporter_user_id: string | null;
  reason: Report['reason'];
  detail: string | null;
  status: ReportStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  quiz_suspended_at: string | null;
}

function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    quizSetId: row.quiz_set_id,
    quizTitle: row.quiz_title,
    teamName: row.team_name,
    reporterUserId: row.reporter_user_id,
    reason: row.reason,
    detail: row.detail,
    status: row.status,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    quizSuspendedAt: row.quiz_suspended_at,
  };
}

const REPORT_COLUMNS = `
  r.id, r.quiz_set_id, qs.title AS quiz_title, t.name AS team_name,
  r.reporter_user_id, r.reason, r.detail, r.status, r.resolved_by, r.resolved_at, r.created_at,
  qs.suspended_at AS quiz_suspended_at
`;
const REPORT_FROM = `FROM reports r
  JOIN quiz_sets qs ON qs.id = r.quiz_set_id
  JOIN teams t ON t.id = qs.team_id`;

const reports = new Hono<AppEnv>();

// GET /api/admin/reports?status=open&page=&per_page=: requireAdmin（呼び出し元でマウント）
reports.get('/', async (c) => {
  const p = getPagination(c);
  const status = c.req.query('status');

  const conditions: string[] = [];
  const binds: string[] = [];
  if (status) {
    conditions.push('r.status = ?');
    binds.push(status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${REPORT_FROM} ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT ${REPORT_COLUMNS} ${REPORT_FROM} ${where}
     ORDER BY r.created_at DESC, r.id LIMIT ? OFFSET ?`,
  )
    .bind(...binds, p.perPage, p.offset)
    .all<ReportRow>();

  return c.json(pageResult(results.map(toReport), total?.n ?? 0, p));
});

const patchReportSchema = z.object({
  status: z.enum(['actioned', 'dismissed']),
});

// PATCH /api/admin/reports/:id: {status}。resolved_by/resolved_at を設定
reports.patch('/:id', zv('json', patchReportSchema), async (c) => {
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  const admin = c.get('user');
  if (!admin) throw new Error('unreachable');

  const existing = await c.env.DB.prepare('SELECT id FROM reports WHERE id = ?').bind(id).first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', '通報が見つかりません。');
  }

  await c.env.DB.prepare(
    `UPDATE reports SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`,
  )
    .bind(status, admin.id, id)
    .run();

  const row = await c.env.DB.prepare(`SELECT ${REPORT_COLUMNS} ${REPORT_FROM} WHERE r.id = ?`)
    .bind(id)
    .first<ReportRow>();
  if (!row) throw new Error('unreachable');
  return c.json(toReport(row));
});

export default reports;
