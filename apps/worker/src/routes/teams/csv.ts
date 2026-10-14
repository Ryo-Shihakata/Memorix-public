import { LIMITS } from '@memorix/shared';
import { strToU8, zipSync } from 'fflate';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import {
  type CsvFiles,
  CsvSyntaxError,
  isImgUrlFormat,
  type ParsedQuestion,
  parseCsvFiles,
  stringifyCsv,
} from '../../lib/csv';
import { apiError } from '../../lib/errors';
import { newId } from '../../lib/id';
import { fetchQuizSetRow, loadQuizSetFull } from '../../lib/quizAccess';
import { requireTeamRole } from '../../middleware/session';

const csv = new Hono<AppEnv>();

// multipart フィールド名: text_questions / table_questions / blanks（テンプレのファイル名基準。
// §10 に明記が無いため実装判断として採用。3ファイルとも任意 — 未添付は空扱い）
async function readCsvFiles(form: Record<string, string | File>): Promise<CsvFiles> {
  const read = async (key: string): Promise<string | undefined> => {
    const f = form[key];
    if (!(f instanceof File)) return undefined;
    return await f.text();
  };
  return {
    textCsv: await read('text_questions'),
    tableCsv: await read('table_questions'),
    blanksCsv: await read('blanks'),
  };
}

async function fetchQuizSet(
  db: D1Database,
  teamId: string,
  quizSetId: string,
): Promise<{ id: string } | null> {
  return db
    .prepare('SELECT id FROM quiz_sets WHERE id = ? AND team_id = ?')
    .bind(quizSetId, teamId)
    .first<{ id: string }>();
}

// image_url のチーム所有チェック（DB依存のため lib/csv.ts の外で行う）。
// 不正形式・他チーム画像はいずれも警告してスキップ（§10）。
async function resolveImageId(
  db: D1Database,
  teamId: string,
  rawUrl: string | null,
  contextLabel: string,
  warnings: string[],
): Promise<string | null> {
  if (!rawUrl) return null;
  const imageId = isImgUrlFormat(rawUrl);
  if (!imageId) {
    warnings.push(`${contextLabel}: image_url の形式が不正なためスキップしました(${rawUrl})。`);
    return null;
  }
  const row = await db
    .prepare('SELECT id FROM images WHERE id = ? AND team_id = ?')
    .bind(imageId, teamId)
    .first();
  if (!row) {
    warnings.push(`${contextLabel}: 画像が見つからないためスキップしました(${rawUrl})。`);
    return null;
  }
  return imageId;
}

interface ResolvedQuestion {
  parsed: ParsedQuestion;
  imageId: string | null;
}

async function resolveImages(
  db: D1Database,
  teamId: string,
  questions: ParsedQuestion[],
): Promise<{ resolved: ResolvedQuestion[]; warnings: string[] }> {
  const warnings: string[] = [];
  const resolved: ResolvedQuestion[] = [];
  for (const q of questions) {
    const imageId = await resolveImageId(
      db,
      teamId,
      q.imageUrl,
      `question_id「${q.importKey}」`,
      warnings,
    );
    resolved.push({ parsed: q, imageId });
  }
  return { resolved, warnings };
}

// POST .../quiz-sets/:id/import/preview: editor 以上。DB書き込みなし（§7.6）
csv.post('/:quizSetId/import/preview', requireTeamRole('editor'), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const quizSetId = c.req.param('quizSetId');
  const quiz = await fetchQuizSet(c.env.DB, teamId, quizSetId);
  if (!quiz) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }

  let form: Record<string, string | File>;
  try {
    form = await c.req.parseBody();
  } catch {
    return apiError(c, 400, 'VALIDATION', 'アップロード内容が正しくありません。');
  }
  const files = await readCsvFiles(form);

  let questions: ParsedQuestion[];
  let issues: { message: string; blocking: boolean }[];
  try {
    ({ questions, issues } = parseCsvFiles(files));
  } catch (e) {
    if (e instanceof CsvSyntaxError) {
      return apiError(c, 400, 'VALIDATION', e.message);
    }
    throw e;
  }

  const { warnings: imageWarnings } = await resolveImages(c.env.DB, teamId, questions);
  const warnings = [...issues.map((i) => i.message), ...imageWarnings];
  const blankCount = questions.reduce((n, q) => n + q.blanks.length, 0);

  return c.json({ questionCount: questions.length, blankCount, warnings });
});

// POST .../quiz-sets/:id/import/confirm: editor 以上。§7.6.1 と同じ整合性検査の上 upsert。
// 違反時は 400 VALIDATION で DB 無変更。question_id は import_key として保存し、
// 既存の同 import_key の問題は子ごと削除→再作成する（質問IDは変わる）。
csv.post('/:quizSetId/import/confirm', requireTeamRole('editor'), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const quizSetId = c.req.param('quizSetId');
  const quiz = await fetchQuizSet(c.env.DB, teamId, quizSetId);
  if (!quiz) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }

  let form: Record<string, string | File>;
  try {
    form = await c.req.parseBody();
  } catch {
    return apiError(c, 400, 'VALIDATION', 'アップロード内容が正しくありません。');
  }
  const files = await readCsvFiles(form);

  let questions: ParsedQuestion[];
  let issues: { message: string; blocking: boolean }[];
  try {
    ({ questions, issues } = parseCsvFiles(files));
  } catch (e) {
    if (e instanceof CsvSyntaxError) {
      return apiError(c, 400, 'VALIDATION', e.message);
    }
    throw e;
  }

  const blockingIssue = issues.find((i) => i.blocking);
  if (blockingIssue) {
    return apiError(c, 400, 'VALIDATION', blockingIssue.message);
  }

  const { resolved } = await resolveImages(c.env.DB, teamId, questions);

  // 既存の import_key -> question.id マップ（置換対象の判定用）
  const { results: existingRows } = await c.env.DB.prepare(
    'SELECT id, import_key FROM questions WHERE quiz_set_id = ? AND import_key IS NOT NULL',
  )
    .bind(quizSetId)
    .all<{ id: string; import_key: string }>();
  const existingIdByKey = new Map(existingRows.map((r) => [r.import_key, r.id]));

  const currentCount = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM questions WHERE quiz_set_id = ?',
  )
    .bind(quizSetId)
    .first<{ n: number }>();
  const replacedCount = resolved.filter((r) => existingIdByKey.has(r.parsed.importKey)).length;
  const finalCount = (currentCount?.n ?? 0) - replacedCount + resolved.length;
  if (finalCount > LIMITS.QUESTIONS_PER_QUIZ) {
    return apiError(c, 403, 'QUOTA_EXCEEDED', `問題は${LIMITS.QUESTIONS_PER_QUIZ}問までです。`);
  }

  const stmts = [];
  let created = 0;
  let updated = 0;

  for (const { parsed, imageId } of resolved) {
    const existingId = existingIdByKey.get(parsed.importKey);
    if (existingId) {
      stmts.push(c.env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(existingId));
      updated++;
    } else {
      created++;
    }

    const questionId = newId();
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO questions (id, quiz_set_id, type, title, display_order, text_content, image_id, import_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        questionId,
        quizSetId,
        parsed.type,
        parsed.title,
        parsed.displayOrder,
        parsed.type === 'text' ? parsed.textContent : null,
        imageId,
        parsed.importKey,
      ),
    );

    const blankIdByOrder = new Map<number, string>();
    for (const b of parsed.blanks) {
      const blankId = newId();
      blankIdByOrder.set(b.blankOrder, blankId);
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO blanks (id, question_id, blank_order, accepted_answers, hint)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(blankId, questionId, b.blankOrder, JSON.stringify(b.acceptedAnswers), b.hint),
      );
    }

    if (parsed.type === 'table' && parsed.cells) {
      for (const cell of parsed.cells) {
        const blankId =
          cell.cellType === 'blank' && cell.blankOrder !== null
            ? (blankIdByOrder.get(cell.blankOrder) ?? null)
            : null;
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO table_cells (id, question_id, row_index, col_index, cell_type, content, blank_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            newId(),
            questionId,
            cell.rowIndex,
            cell.colIndex,
            cell.cellType,
            cell.content,
            blankId,
          ),
        );
      }
    }
  }

  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
    await c.env.DB.prepare('UPDATE quiz_sets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(quizSetId)
      .run();
  }

  return c.json({ created, updated });
});

// GET .../quiz-sets/:id/export: editor 以上。zip(text/table/blanks csv)。§10
csv.get('/:quizSetId/export', requireTeamRole('editor'), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const quizSetId = c.req.param('quizSetId');
  const row = await fetchQuizSetRow(c.env.DB, quizSetId);
  if (!row || row.team_id !== teamId) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }

  const full = await loadQuizSetFull(c.env.DB, row, c.env.APP_ORIGIN);

  const { results: keyRows } = await c.env.DB.prepare(
    'SELECT id, import_key FROM questions WHERE quiz_set_id = ?',
  )
    .bind(quizSetId)
    .all<{ id: string; import_key: string | null }>();
  const importKeyById = new Map(keyRows.map((r) => [r.id, r.import_key]));

  const textRows: (string | number)[][] = [];
  const tableRows: (string | number)[][] = [];
  const blankRows: (string | number)[][] = [];

  for (const q of full.questions) {
    const importKey = importKeyById.get(q.id) ?? q.id;
    const imageUrl = q.imageId ? `/img/${q.imageId}` : '';

    if (q.type === 'text') {
      textRows.push([importKey, q.displayOrder, q.title ?? '', q.textContent ?? '', imageUrl]);
    } else {
      for (const cell of q.cells ?? []) {
        tableRows.push([
          importKey,
          q.displayOrder,
          q.title ?? '',
          imageUrl,
          cell.rowIndex,
          cell.colIndex,
          cell.cellType,
          cell.content ?? '',
          cell.cellType === 'blank' ? (cell.blankOrder ?? '') : '',
        ]);
      }
    }

    for (const b of q.blanks) {
      blankRows.push([importKey, b.blankOrder, b.acceptedAnswers.join('|'), b.hint ?? '']);
    }
  }

  const textCsv = stringifyCsv(
    ['question_id', 'display_order', 'question_title', 'text_content', 'image_url'],
    textRows,
  );
  const tableCsv = stringifyCsv(
    [
      'question_id',
      'display_order',
      'question_title',
      'image_url',
      'row',
      'col',
      'cell_type',
      'content',
      'is_blank',
    ],
    tableRows,
  );
  const blanksCsv = stringifyCsv(
    ['question_id', 'blank_order', 'accepted_answers', 'hint'],
    blankRows,
  );

  const zipped = zipSync({
    'text_questions.csv': strToU8(textCsv),
    'table_questions.csv': strToU8(tableCsv),
    'blanks.csv': strToU8(blanksCsv),
  });

  return new Response(zipped, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${row.id}.zip"`,
    },
  });
});

export default csv;
