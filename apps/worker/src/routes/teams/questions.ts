import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { newId } from '../../lib/id';
import {
  extractMarkerOrders,
  imageBelongsToTeam,
  loadQuestionDetail,
  setsEqual,
  toBlankDetail,
  toCellDetail,
} from '../../lib/quizAccess';
import {
  patchQuestionSchema,
  putBlanksBodySchema,
  putCellsBodySchema,
} from '../../lib/quizSchemas';
import { zv } from '../../lib/validate';
import { requireTeamRole } from '../../middleware/session';

interface QuestionOwnerRow {
  id: string;
  quiz_set_id: string;
  type: 'text' | 'table';
  text_content: string | null;
}

// パスの :teamId 配下の問題であることを quiz_sets 経由で検証する（questions は
// /api/teams/:teamId/questions/:questionId というフラットなパスのため）
async function fetchQuestionForTeam(
  db: D1Database,
  teamId: string,
  questionId: string,
): Promise<QuestionOwnerRow | null> {
  return db
    .prepare(
      `SELECT q.id, q.quiz_set_id, q.type, q.text_content
       FROM questions q JOIN quiz_sets qs ON qs.id = q.quiz_set_id
       WHERE q.id = ? AND qs.team_id = ?`,
    )
    .bind(questionId, teamId)
    .first<QuestionOwnerRow>();
}

const questions = new Hono<AppEnv>();

// PATCH .../questions/:id: editor 以上。title/textContent/image* のみ
// (blanks/cells は PUT .../blanks, .../cells の全置換で管理)
questions.patch(
  '/:questionId',
  requireTeamRole('editor'),
  zv('json', patchQuestionSchema),
  async (c) => {
    const teamId = c.req.param('teamId') ?? '';
    const questionId = c.req.param('questionId');
    const body = c.req.valid('json');

    const question = await fetchQuestionForTeam(c.env.DB, teamId, questionId);
    if (!question) {
      return apiError(c, 404, 'NOT_FOUND', '問題が見つかりません。');
    }

    if (body.textContent !== undefined) {
      if (question.type !== 'text') {
        return apiError(c, 400, 'VALIDATION', 'テーブル型の問題に本文は設定できません。');
      }
      const { results: blankRows } = await c.env.DB.prepare(
        'SELECT blank_order FROM blanks WHERE question_id = ?',
      )
        .bind(questionId)
        .all<{ blank_order: number }>();
      const blankOrderSet = new Set(blankRows.map((r) => r.blank_order));
      const markerSet = extractMarkerOrders(body.textContent);
      if (!setsEqual(markerSet, blankOrderSet)) {
        return apiError(c, 400, 'VALIDATION', '本文の空欄マーカーと空欄設定が一致しません。');
      }
    }
    if (body.imageId) {
      if (!(await imageBelongsToTeam(c.env.DB, body.imageId, teamId))) {
        return apiError(c, 400, 'VALIDATION', '指定された画像が見つかりません。');
      }
    }

    const sets: string[] = [];
    const binds: (string | null)[] = [];
    if (body.title !== undefined) {
      sets.push('title = ?');
      binds.push(body.title);
    }
    if (body.textContent !== undefined) {
      sets.push('text_content = ?');
      binds.push(body.textContent);
    }
    if (body.imageId !== undefined) {
      sets.push('image_id = ?');
      binds.push(body.imageId);
    }
    if (body.imagePosition !== undefined) {
      sets.push('image_position = ?');
      binds.push(body.imagePosition);
    }
    if (body.imageCaption !== undefined) {
      sets.push('image_caption = ?');
      binds.push(body.imageCaption);
    }
    if (sets.length > 0) {
      await c.env.DB.prepare(
        `UPDATE questions SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
        .bind(...binds, questionId)
        .run();
      await c.env.DB.prepare('UPDATE quiz_sets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(question.quiz_set_id)
        .run();
    }

    const detail = await loadQuestionDetail(c.env.DB, questionId);
    if (!detail) throw new Error('unreachable');
    return c.json(detail);
  },
);

// DELETE .../questions/:id: editor 以上。子(blanks/table_cells)は FK CASCADE
questions.delete('/:questionId', requireTeamRole('editor'), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const questionId = c.req.param('questionId');
  const question = await fetchQuestionForTeam(c.env.DB, teamId, questionId);
  if (!question) {
    return apiError(c, 404, 'NOT_FOUND', '問題が見つかりません。');
  }
  await c.env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(questionId).run();
  await c.env.DB.prepare('UPDATE quiz_sets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(question.quiz_set_id)
    .run();
  return c.body(null, 204);
});

// PUT .../questions/:id/blanks: editor 以上。空欄全置換（§7.6）。
// blank_order が既存と一致する行は id を維持して UPDATE し、table_cells.blank_id の
// 参照を壊さないようにする（§3 注記）。整合性検査は type に応じて現在の
// text_content のマーカー、または table_cells の blank セルと比較する。
// v1.1改訂: body に {blanks, textContent?} 形式を許可（後方互換で素の配列も可）。
// textContent 同梱時（text型のみ）は、保存済み本文ではなく同梱された textContent と
// 整合性検査を行い、blanks と textContent を同一 batch で原子的に更新する。
questions.put(
  '/:questionId/blanks',
  requireTeamRole('editor'),
  zv('json', putBlanksBodySchema),
  async (c) => {
    const teamId = c.req.param('teamId') ?? '';
    const questionId = c.req.param('questionId');
    const body = c.req.valid('json');
    const payload = Array.isArray(body) ? body : body.blanks;
    const textContent = Array.isArray(body) ? undefined : body.textContent;

    const question = await fetchQuestionForTeam(c.env.DB, teamId, questionId);
    if (!question) {
      return apiError(c, 404, 'NOT_FOUND', '問題が見つかりません。');
    }

    const orders = payload.map((b) => b.blankOrder);
    if (new Set(orders).size !== orders.length) {
      return apiError(c, 400, 'VALIDATION', '空欄の番号が重複しています。');
    }
    const newOrderSet = new Set(orders);

    if (question.type === 'text') {
      const effectiveText = textContent !== undefined ? textContent : (question.text_content ?? '');
      const markerSet = extractMarkerOrders(effectiveText);
      if (!setsEqual(markerSet, newOrderSet)) {
        return apiError(c, 400, 'VALIDATION', '本文の空欄マーカーと空欄設定が一致しません。');
      }
    } else {
      if (textContent !== undefined) {
        return apiError(c, 400, 'VALIDATION', 'テーブル型の問題に本文は設定できません。');
      }
      const { results: cellBlanks } = await c.env.DB.prepare(
        `SELECT b.blank_order FROM table_cells tc JOIN blanks b ON b.id = tc.blank_id
         WHERE tc.question_id = ? AND tc.cell_type = 'blank'`,
      )
        .bind(questionId)
        .all<{ blank_order: number }>();
      if (cellBlanks.length !== newOrderSet.size) {
        return apiError(c, 400, 'VALIDATION', '表の空欄セル数と空欄設定の数が一致しません。');
      }
      for (const r of cellBlanks) {
        if (!newOrderSet.has(r.blank_order)) {
          return apiError(c, 400, 'VALIDATION', 'セルが参照する空欄が見つかりません。');
        }
      }
    }

    for (const b of payload) {
      if (b.hintImageId && !(await imageBelongsToTeam(c.env.DB, b.hintImageId, teamId))) {
        return apiError(c, 400, 'VALIDATION', 'ヒント画像が見つかりません。');
      }
    }

    const { results: existingRows } = await c.env.DB.prepare(
      'SELECT id, blank_order FROM blanks WHERE question_id = ?',
    )
      .bind(questionId)
      .all<{ id: string; blank_order: number }>();
    const existingByOrder = new Map(existingRows.map((r) => [r.blank_order, r.id]));

    const stmts = [];
    for (const b of payload) {
      const existingId = existingByOrder.get(b.blankOrder);
      if (existingId !== undefined) {
        stmts.push(
          c.env.DB.prepare(
            'UPDATE blanks SET accepted_answers = ?, hint = ?, hint_image_id = ? WHERE id = ?',
          ).bind(
            JSON.stringify(b.acceptedAnswers),
            b.hint ?? null,
            b.hintImageId ?? null,
            existingId,
          ),
        );
        existingByOrder.delete(b.blankOrder);
      } else {
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO blanks (id, question_id, blank_order, accepted_answers, hint, hint_image_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).bind(
            newId(),
            questionId,
            b.blankOrder,
            JSON.stringify(b.acceptedAnswers),
            b.hint ?? null,
            b.hintImageId ?? null,
          ),
        );
      }
    }
    for (const staleId of existingByOrder.values()) {
      stmts.push(c.env.DB.prepare('DELETE FROM blanks WHERE id = ?').bind(staleId));
    }
    if (textContent !== undefined) {
      stmts.push(
        c.env.DB.prepare(
          'UPDATE questions SET text_content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ).bind(textContent, questionId),
      );
    }
    if (stmts.length > 0) {
      await c.env.DB.batch(stmts);
    }
    await c.env.DB.prepare('UPDATE quiz_sets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(question.quiz_set_id)
      .run();

    const { results: updated } = await c.env.DB.prepare(
      'SELECT id, question_id, blank_order, accepted_answers, hint, hint_image_id FROM blanks WHERE question_id = ? ORDER BY blank_order',
    )
      .bind(questionId)
      .all<{
        id: string;
        question_id: string;
        blank_order: number;
        accepted_answers: string;
        hint: string | null;
        hint_image_id: string | null;
      }>();
    return c.json(updated.map(toBlankDetail));
  },
);

// PUT .../questions/:id/cells: editor 以上。セル全置換（§7.6）。
// cell_type='blank' のセル数・各セルの blankOrder は blanks と照合する。
// v1.1改訂: body に {cells, blanks?} 形式を許可（後方互換で素の配列も可）。
// blanks 同梱時（table型のみ、本エンドポイントは元々table型限定）は、DB保存済みの
// blanks ではなく同梱された blanks と照合し、cells と blanks を同一 batch で
// 原子的に全置換する（blank_order 一致なら既存 blanks.id を維持）。
questions.put(
  '/:questionId/cells',
  requireTeamRole('editor'),
  zv('json', putCellsBodySchema),
  async (c) => {
    const teamId = c.req.param('teamId') ?? '';
    const questionId = c.req.param('questionId');
    const body = c.req.valid('json');
    const payload = Array.isArray(body) ? body : body.cells;
    const blanksPayload = Array.isArray(body) ? undefined : body.blanks;

    const question = await fetchQuestionForTeam(c.env.DB, teamId, questionId);
    if (!question) {
      return apiError(c, 404, 'NOT_FOUND', '問題が見つかりません。');
    }
    if (question.type !== 'table') {
      return apiError(c, 400, 'VALIDATION', 'テーブル型以外の問題にセルは設定できません。');
    }

    const seenPos = new Set<string>();
    for (const cell of payload) {
      const key = `${cell.rowIndex}:${cell.colIndex}`;
      if (seenPos.has(key)) {
        return apiError(c, 400, 'VALIDATION', 'セルの位置が重複しています。');
      }
      seenPos.add(key);
      if (cell.cellType === 'blank' && cell.blankOrder === undefined) {
        return apiError(c, 400, 'VALIDATION', '空欄セルには空欄番号が必要です。');
      }
      if (cell.imageId && !(await imageBelongsToTeam(c.env.DB, cell.imageId, teamId))) {
        return apiError(c, 400, 'VALIDATION', '指定された画像が見つかりません。');
      }
    }

    const blankStmts = [];
    let blankIdByOrder: Map<number, string>;
    let blankCount: number;

    if (blanksPayload !== undefined) {
      const orders = blanksPayload.map((b) => b.blankOrder);
      if (new Set(orders).size !== orders.length) {
        return apiError(c, 400, 'VALIDATION', '空欄の番号が重複しています。');
      }
      for (const b of blanksPayload) {
        if (b.hintImageId && !(await imageBelongsToTeam(c.env.DB, b.hintImageId, teamId))) {
          return apiError(c, 400, 'VALIDATION', 'ヒント画像が見つかりません。');
        }
      }

      const { results: existingRows } = await c.env.DB.prepare(
        'SELECT id, blank_order FROM blanks WHERE question_id = ?',
      )
        .bind(questionId)
        .all<{ id: string; blank_order: number }>();
      const existingByOrder = new Map(existingRows.map((r) => [r.blank_order, r.id]));

      blankIdByOrder = new Map();
      for (const b of blanksPayload) {
        const existingId = existingByOrder.get(b.blankOrder);
        if (existingId !== undefined) {
          blankStmts.push(
            c.env.DB.prepare(
              'UPDATE blanks SET accepted_answers = ?, hint = ?, hint_image_id = ? WHERE id = ?',
            ).bind(
              JSON.stringify(b.acceptedAnswers),
              b.hint ?? null,
              b.hintImageId ?? null,
              existingId,
            ),
          );
          blankIdByOrder.set(b.blankOrder, existingId);
          existingByOrder.delete(b.blankOrder);
        } else {
          const id = newId();
          blankStmts.push(
            c.env.DB.prepare(
              `INSERT INTO blanks (id, question_id, blank_order, accepted_answers, hint, hint_image_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
            ).bind(
              id,
              questionId,
              b.blankOrder,
              JSON.stringify(b.acceptedAnswers),
              b.hint ?? null,
              b.hintImageId ?? null,
            ),
          );
          blankIdByOrder.set(b.blankOrder, id);
        }
      }
      for (const staleId of existingByOrder.values()) {
        blankStmts.push(c.env.DB.prepare('DELETE FROM blanks WHERE id = ?').bind(staleId));
      }
      blankCount = blanksPayload.length;
    } else {
      const { results: blankRows } = await c.env.DB.prepare(
        'SELECT id, blank_order FROM blanks WHERE question_id = ?',
      )
        .bind(questionId)
        .all<{ id: string; blank_order: number }>();
      blankIdByOrder = new Map(blankRows.map((r) => [r.blank_order, r.id]));
      blankCount = blankRows.length;
    }

    const blankCells = payload.filter((cell) => cell.cellType === 'blank');
    if (blankCells.length !== blankCount) {
      return apiError(c, 400, 'VALIDATION', '表の空欄セル数と空欄設定の数が一致しません。');
    }
    for (const cell of blankCells) {
      if (!blankIdByOrder.has(cell.blankOrder as number)) {
        return apiError(c, 400, 'VALIDATION', 'セルが参照する空欄が見つかりません。');
      }
    }

    const stmts = [
      ...blankStmts,
      c.env.DB.prepare('DELETE FROM table_cells WHERE question_id = ?').bind(questionId),
    ];
    for (const cell of payload) {
      const blankId =
        cell.cellType === 'blank' ? (blankIdByOrder.get(cell.blankOrder as number) ?? null) : null;
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO table_cells (id, question_id, row_index, col_index, cell_type, content, image_id, blank_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          newId(),
          questionId,
          cell.rowIndex,
          cell.colIndex,
          cell.cellType,
          cell.content ?? null,
          cell.imageId ?? null,
          blankId,
        ),
      );
    }
    await c.env.DB.batch(stmts);
    await c.env.DB.prepare('UPDATE quiz_sets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(question.quiz_set_id)
      .run();

    const { results: updated } = await c.env.DB.prepare(
      `SELECT tc.row_index, tc.col_index, tc.cell_type, tc.content, tc.image_id, b.blank_order
       FROM table_cells tc LEFT JOIN blanks b ON b.id = tc.blank_id
       WHERE tc.question_id = ? ORDER BY tc.row_index, tc.col_index`,
    )
      .bind(questionId)
      .all<{
        row_index: number;
        col_index: number;
        cell_type: 'text' | 'header' | 'blank' | 'image';
        content: string | null;
        image_id: string | null;
        blank_order: number | null;
      }>();
    return c.json(updated.map(toCellDetail));
  },
);

export default questions;
