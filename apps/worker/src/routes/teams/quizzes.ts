import { LIMITS } from '@memorix/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { apiError } from '../../lib/errors';
import { newId } from '../../lib/id';
import { getPagination, pageResult } from '../../lib/pagination';
import {
  escapeLike,
  extractMarkerOrders,
  fetchQuizSetRow,
  imageBelongsToTeam,
  loadQuestionDetail,
  loadQuizSetFull,
  QUIZ_SET_COLUMNS,
  QUIZ_SET_FROM,
  type QuizSetRow,
  setsEqual,
  toQuizSetDetail,
  toQuizSetSummary,
} from '../../lib/quizAccess';
import {
  createQuestionSchema,
  createQuizSetSchema,
  patchQuizSetSchema,
  reorderQuestionsSchema,
  visibilitySchema,
} from '../../lib/quizSchemas';
import { zv } from '../../lib/validate';
import { requireTeamRole } from '../../middleware/session';

// crypto.randomUUID() を2連結し '-' 除去（§3。招待トークンと同じ方式）
function newShareToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '');
}

const quizzes = new Hono<AppEnv>();

// GET .../quiz-sets?folder_id=&q=: viewer 以上（§7.6）
quizzes.get('/', requireTeamRole('viewer'), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const p = getPagination(c);
  const folderId = c.req.query('folder_id');
  const q = c.req.query('q');

  const conditions = ['qs.team_id = ?'];
  const binds: (string | number)[] = [teamId];
  if (folderId) {
    conditions.push('qs.folder_id = ?');
    binds.push(folderId);
  }
  if (q) {
    conditions.push("(qs.title LIKE ? ESCAPE '\\' OR qs.description LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(q)}%`;
    binds.push(like, like);
  }
  const where = conditions.join(' AND ');

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${QUIZ_SET_FROM} WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT ${QUIZ_SET_COLUMNS} ${QUIZ_SET_FROM} WHERE ${where}
     ORDER BY qs.updated_at DESC, qs.id LIMIT ? OFFSET ?`,
  )
    .bind(...binds, p.perPage, p.offset)
    .all<QuizSetRow>();

  return c.json(pageResult(results.map(toQuizSetSummary), total?.n ?? 0, p));
});

// POST .../quiz-sets: editor 以上。QUIZ_SETS_PER_TEAM=500 上限
quizzes.post('/', requireTeamRole('editor'), zv('json', createQuizSetSchema), async (c) => {
  const { title, description, folderId, subjectId } = c.req.valid('json');
  const teamId = c.req.param('teamId') ?? '';

  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM quiz_sets WHERE team_id = ?')
    .bind(teamId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= LIMITS.QUIZ_SETS_PER_TEAM) {
    return apiError(c, 403, 'QUOTA_EXCEEDED', `クイズは${LIMITS.QUIZ_SETS_PER_TEAM}個までです。`);
  }

  if (folderId) {
    const folder = await c.env.DB.prepare('SELECT id FROM folders WHERE id = ? AND team_id = ?')
      .bind(folderId, teamId)
      .first();
    if (!folder) return apiError(c, 400, 'VALIDATION', 'フォルダが見つかりません。');
  }
  if (subjectId) {
    const subject = await c.env.DB.prepare('SELECT id FROM subjects WHERE id = ?')
      .bind(subjectId)
      .first();
    if (!subject) return apiError(c, 400, 'VALIDATION', '科目が見つかりません。');
  }

  const user = c.get('user');
  const quizSetId = newId();
  await c.env.DB.prepare(
    `INSERT INTO quiz_sets (id, team_id, folder_id, subject_id, title, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      quizSetId,
      teamId,
      folderId ?? null,
      subjectId ?? null,
      title,
      description ?? null,
      user?.id ?? null,
    )
    .run();

  const row = await fetchQuizSetRow(c.env.DB, quizSetId);
  if (!row) throw new Error('quiz set insert failed');
  return c.json(toQuizSetDetail(row, c.env.APP_ORIGIN), 201);
});

// GET .../quiz-sets/:id: viewer も可。正解込みフル構造（§7.6）
quizzes.get('/:quizSetId', requireTeamRole('viewer'), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const quizSetId = c.req.param('quizSetId');
  const row = await fetchQuizSetRow(c.env.DB, quizSetId);
  if (!row || row.team_id !== teamId) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  const full = await loadQuizSetFull(c.env.DB, row, c.env.APP_ORIGIN);
  return c.json(full);
});

// PATCH .../quiz-sets/:id: editor 以上
quizzes.patch(
  '/:quizSetId',
  requireTeamRole('editor'),
  zv('json', patchQuizSetSchema),
  async (c) => {
    const body = c.req.valid('json');
    const teamId = c.req.param('teamId') ?? '';
    const quizSetId = c.req.param('quizSetId');

    const existing = await c.env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ? AND team_id = ?')
      .bind(quizSetId, teamId)
      .first();
    if (!existing) {
      return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
    }

    if (body.folderId) {
      const folder = await c.env.DB.prepare('SELECT id FROM folders WHERE id = ? AND team_id = ?')
        .bind(body.folderId, teamId)
        .first();
      if (!folder) return apiError(c, 400, 'VALIDATION', 'フォルダが見つかりません。');
    }
    if (body.subjectId) {
      const subject = await c.env.DB.prepare('SELECT id FROM subjects WHERE id = ?')
        .bind(body.subjectId)
        .first();
      if (!subject) return apiError(c, 400, 'VALIDATION', '科目が見つかりません。');
    }

    const sets: string[] = [];
    const binds: (string | number | null)[] = [];
    if (body.title !== undefined) {
      sets.push('title = ?');
      binds.push(body.title);
    }
    if (body.description !== undefined) {
      sets.push('description = ?');
      binds.push(body.description);
    }
    if (body.folderId !== undefined) {
      sets.push('folder_id = ?');
      binds.push(body.folderId);
    }
    if (body.subjectId !== undefined) {
      sets.push('subject_id = ?');
      binds.push(body.subjectId);
    }
    if (body.shuffleQuestions !== undefined) {
      sets.push('shuffle_questions = ?');
      binds.push(body.shuffleQuestions ? 1 : 0);
    }
    if (body.normalizeKana !== undefined) {
      sets.push('normalize_kana = ?');
      binds.push(body.normalizeKana ? 1 : 0);
    }
    if (body.timeLimitSecs !== undefined) {
      sets.push('time_limit_secs = ?');
      binds.push(body.timeLimitSecs);
    }
    if (sets.length > 0) {
      await c.env.DB.prepare(
        `UPDATE quiz_sets SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
        .bind(...binds, quizSetId)
        .run();
    }

    const row = await fetchQuizSetRow(c.env.DB, quizSetId);
    if (!row) throw new Error('unreachable');
    return c.json(toQuizSetDetail(row, c.env.APP_ORIGIN));
  },
);

// DELETE .../quiz-sets/:id: editor 以上。子は FK ON DELETE CASCADE
quizzes.delete('/:quizSetId', requireTeamRole('editor'), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const quizSetId = c.req.param('quizSetId');
  const existing = await c.env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ? AND team_id = ?')
    .bind(quizSetId, teamId)
    .first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  await c.env.DB.prepare('DELETE FROM quiz_sets WHERE id = ?').bind(quizSetId).run();
  return c.body(null, 204);
});

// POST .../quiz-sets/:id/duplicate: editor 以上。visibility='private' で新規作成、
// 画像は参照共有(image_id をそのままコピー)、share_token はコピーしない
quizzes.post('/:quizSetId/duplicate', requireTeamRole('editor'), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const quizSetId = c.req.param('quizSetId');
  const srcRow = await fetchQuizSetRow(c.env.DB, quizSetId);
  if (!srcRow || srcRow.team_id !== teamId) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  const full = await loadQuizSetFull(c.env.DB, srcRow, c.env.APP_ORIGIN);
  const user = c.get('user');
  const newQuizId = newId();

  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO quiz_sets (id, team_id, folder_id, subject_id, title, description,
        shuffle_questions, normalize_kana, time_limit_secs, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newQuizId,
      teamId,
      srcRow.folder_id,
      srcRow.subject_id,
      `${srcRow.title} のコピー`,
      srcRow.description,
      srcRow.shuffle_questions,
      srcRow.normalize_kana,
      srcRow.time_limit_secs,
      user?.id ?? null,
    ),
  ];

  for (const question of full.questions) {
    const newQuestionId = newId();
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO questions (id, quiz_set_id, type, title, display_order, text_content,
          image_id, image_position, image_caption)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newQuestionId,
        newQuizId,
        question.type,
        question.title,
        question.displayOrder,
        question.textContent,
        question.imageId,
        question.imagePosition,
        question.imageCaption,
      ),
    );

    const blankIdByOrder = new Map<number, string>();
    for (const b of question.blanks) {
      const newBlankId = newId();
      blankIdByOrder.set(b.blankOrder, newBlankId);
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO blanks (id, question_id, blank_order, accepted_answers, hint, hint_image_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          newBlankId,
          newQuestionId,
          b.blankOrder,
          JSON.stringify(b.acceptedAnswers),
          b.hint,
          b.hintImageId,
        ),
      );
    }

    if (question.cells) {
      for (const cell of question.cells) {
        const blankId =
          cell.cellType === 'blank' && cell.blankOrder !== null
            ? (blankIdByOrder.get(cell.blankOrder) ?? null)
            : null;
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO table_cells (id, question_id, row_index, col_index, cell_type, content, image_id, blank_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            newId(),
            newQuestionId,
            cell.rowIndex,
            cell.colIndex,
            cell.cellType,
            cell.content,
            cell.imageId,
            blankId,
          ),
        );
      }
    }
  }

  await c.env.DB.batch(stmts);
  const row = await fetchQuizSetRow(c.env.DB, newQuizId);
  if (!row) throw new Error('duplicate insert failed');
  const fullNew = await loadQuizSetFull(c.env.DB, row, c.env.APP_ORIGIN);
  return c.json(fullNew, 201);
});

// PATCH .../quiz-sets/:id/visibility: editor 以上。
// public 化は subjectId 設定済み+質問1問以上が条件、違反は 400。
// 初回 public/unlisted 化で published_at を設定(既設定なら更新しない)
quizzes.patch(
  '/:quizSetId/visibility',
  requireTeamRole('editor'),
  zv('json', visibilitySchema),
  async (c) => {
    const { visibility } = c.req.valid('json');
    const teamId = c.req.param('teamId') ?? '';
    const quizSetId = c.req.param('quizSetId');

    const row = await c.env.DB.prepare(
      `SELECT subject_id, published_at,
         (SELECT COUNT(*) FROM questions WHERE quiz_set_id = quiz_sets.id) AS question_count
       FROM quiz_sets WHERE id = ? AND team_id = ?`,
    )
      .bind(quizSetId, teamId)
      .first<{ subject_id: string | null; published_at: string | null; question_count: number }>();
    if (!row) {
      return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
    }

    if (visibility === 'public') {
      if (!row.subject_id) {
        return apiError(c, 400, 'VALIDATION', '公開するには科目を設定してください。');
      }
      if (row.question_count < 1) {
        return apiError(c, 400, 'VALIDATION', '公開するには問題を1問以上作成してください。');
      }
    }

    const setsPublished =
      (visibility === 'public' || visibility === 'unlisted') && row.published_at === null;
    await c.env.DB.prepare(
      `UPDATE quiz_sets SET visibility = ?, updated_at = CURRENT_TIMESTAMP${
        setsPublished ? ', published_at = CURRENT_TIMESTAMP' : ''
      } WHERE id = ?`,
    )
      .bind(visibility, quizSetId)
      .run();

    const updated = await fetchQuizSetRow(c.env.DB, quizSetId);
    if (!updated) throw new Error('unreachable');
    return c.json(toQuizSetDetail(updated, c.env.APP_ORIGIN));
  },
);

// POST .../quiz-sets/:id/share-token: editor 以上。再生成=旧トークン上書き失効
quizzes.post('/:quizSetId/share-token', requireTeamRole('editor'), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const quizSetId = c.req.param('quizSetId');
  const existing = await c.env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ? AND team_id = ?')
    .bind(quizSetId, teamId)
    .first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  const token = newShareToken();
  await c.env.DB.prepare(
    'UPDATE quiz_sets SET share_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  )
    .bind(token, quizSetId)
    .run();
  return c.json({ shareUrl: `${c.env.APP_ORIGIN}/share/${token}` });
});

// DELETE .../quiz-sets/:id/share-token: editor 以上。無効化
quizzes.delete('/:quizSetId/share-token', requireTeamRole('editor'), async (c) => {
  const teamId = c.req.param('teamId') ?? '';
  const quizSetId = c.req.param('quizSetId');
  const existing = await c.env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ? AND team_id = ?')
    .bind(quizSetId, teamId)
    .first();
  if (!existing) {
    return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
  }
  await c.env.DB.prepare(
    'UPDATE quiz_sets SET share_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  )
    .bind(quizSetId)
    .run();
  return c.body(null, 204);
});

// POST .../quiz-sets/:id/questions: editor 以上。§7.6.1 の入力+整合性検査
quizzes.post(
  '/:quizSetId/questions',
  requireTeamRole('editor'),
  zv('json', createQuestionSchema),
  async (c) => {
    const body = c.req.valid('json');
    const teamId = c.req.param('teamId') ?? '';
    const quizSetId = c.req.param('quizSetId');

    const quiz = await c.env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ? AND team_id = ?')
      .bind(quizSetId, teamId)
      .first();
    if (!quiz) {
      return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
    }

    const count = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM questions WHERE quiz_set_id = ?',
    )
      .bind(quizSetId)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= LIMITS.QUESTIONS_PER_QUIZ) {
      return apiError(c, 403, 'QUOTA_EXCEEDED', `問題は${LIMITS.QUESTIONS_PER_QUIZ}問までです。`);
    }

    // ---- §7.6.1 整合性検査 -------------------------------------------
    const orders = body.blanks.map((b) => b.blankOrder);
    if (new Set(orders).size !== orders.length) {
      return apiError(c, 400, 'VALIDATION', '空欄の番号が重複しています。');
    }
    const blankOrderSet = new Set(orders);

    if (body.type === 'text') {
      if (!body.textContent) {
        return apiError(c, 400, 'VALIDATION', 'テキスト型には本文が必要です。');
      }
      const markerSet = extractMarkerOrders(body.textContent);
      if (!setsEqual(markerSet, blankOrderSet)) {
        return apiError(c, 400, 'VALIDATION', '本文の空欄マーカーと空欄設定が一致しません。');
      }
    } else {
      if (!body.cells || body.cells.length === 0) {
        return apiError(c, 400, 'VALIDATION', 'テーブル型にはセルの設定が必要です。');
      }
      const seenPos = new Set<string>();
      const blankCellOrders: number[] = [];
      for (const cell of body.cells) {
        const key = `${cell.rowIndex}:${cell.colIndex}`;
        if (seenPos.has(key)) {
          return apiError(c, 400, 'VALIDATION', 'セルの位置が重複しています。');
        }
        seenPos.add(key);
        if (cell.cellType === 'blank') {
          if (cell.blankOrder === undefined) {
            return apiError(c, 400, 'VALIDATION', '空欄セルには空欄番号が必要です。');
          }
          blankCellOrders.push(cell.blankOrder);
        }
      }
      if (blankCellOrders.length !== blankOrderSet.size) {
        return apiError(c, 400, 'VALIDATION', '表の空欄セル数と空欄設定の数が一致しません。');
      }
      for (const order of blankCellOrders) {
        if (!blankOrderSet.has(order)) {
          return apiError(c, 400, 'VALIDATION', 'セルが参照する空欄が見つかりません。');
        }
      }
    }

    const imageIds = new Set<string>();
    if (body.imageId) imageIds.add(body.imageId);
    for (const b of body.blanks) {
      if (b.hintImageId) imageIds.add(b.hintImageId);
    }
    if (body.cells) {
      for (const cell of body.cells) {
        if (cell.imageId) imageIds.add(cell.imageId);
      }
    }
    for (const imageId of imageIds) {
      if (!(await imageBelongsToTeam(c.env.DB, imageId, teamId))) {
        return apiError(c, 400, 'VALIDATION', '指定された画像が見つかりません。');
      }
    }

    // ---- INSERT ---------------------------------------------------
    const questionId = newId();
    const displayOrderRow = await c.env.DB.prepare(
      'SELECT COALESCE(MAX(display_order) + 1, 0) AS n FROM questions WHERE quiz_set_id = ?',
    )
      .bind(quizSetId)
      .first<{ n: number }>();
    const displayOrder = displayOrderRow?.n ?? 0;

    const stmts = [
      c.env.DB.prepare(
        `INSERT INTO questions (id, quiz_set_id, type, title, display_order, text_content, image_id, image_position, image_caption)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        questionId,
        quizSetId,
        body.type,
        body.title ?? null,
        displayOrder,
        body.type === 'text' ? (body.textContent ?? null) : null,
        body.imageId ?? null,
        body.imagePosition ?? 'above',
        body.imageCaption ?? null,
      ),
    ];

    const blankIdByOrder = new Map<number, string>();
    for (const b of body.blanks) {
      const blankId = newId();
      blankIdByOrder.set(b.blankOrder, blankId);
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO blanks (id, question_id, blank_order, accepted_answers, hint, hint_image_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          blankId,
          questionId,
          b.blankOrder,
          JSON.stringify(b.acceptedAnswers),
          b.hint ?? null,
          b.hintImageId ?? null,
        ),
      );
    }

    if (body.type === 'table' && body.cells) {
      for (const cell of body.cells) {
        const blankId =
          cell.cellType === 'blank'
            ? (blankIdByOrder.get(cell.blankOrder as number) ?? null)
            : null;
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
    }

    await c.env.DB.batch(stmts);
    await c.env.DB.prepare('UPDATE quiz_sets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(quizSetId)
      .run();

    const detail = await loadQuestionDetail(c.env.DB, questionId);
    if (!detail) throw new Error('question insert failed');
    return c.json(detail, 201);
  },
);

// PATCH .../quiz-sets/:id/questions/reorder: editor 以上。{orderedIds}
quizzes.patch(
  '/:quizSetId/questions/reorder',
  requireTeamRole('editor'),
  zv('json', reorderQuestionsSchema),
  async (c) => {
    const { orderedIds } = c.req.valid('json');
    const teamId = c.req.param('teamId') ?? '';
    const quizSetId = c.req.param('quizSetId');

    const quiz = await c.env.DB.prepare('SELECT id FROM quiz_sets WHERE id = ? AND team_id = ?')
      .bind(quizSetId, teamId)
      .first();
    if (!quiz) {
      return apiError(c, 404, 'NOT_FOUND', 'クイズが見つかりません。');
    }

    const { results } = await c.env.DB.prepare('SELECT id FROM questions WHERE quiz_set_id = ?')
      .bind(quizSetId)
      .all<{ id: string }>();
    const currentIds = new Set(results.map((r) => r.id));
    const newIdsSet = new Set(orderedIds);
    const matches =
      currentIds.size === newIdsSet.size && [...currentIds].every((id) => newIdsSet.has(id));
    if (!matches) {
      return apiError(c, 400, 'VALIDATION', '問題の一覧と一致しません。');
    }

    const stmts = orderedIds.map((id, index) =>
      c.env.DB.prepare('UPDATE questions SET display_order = ? WHERE id = ?').bind(index, id),
    );
    await c.env.DB.batch(stmts);
    return c.body(null, 204);
  },
);

export default quizzes;
