import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newId } from '../src/lib/id';
import { addMember, errorCode, jsonInit, request, seedTeam, seedUser } from './helpers';

interface QuizSetJson {
  id: string;
}

async function createQuiz(teamId: string, cookie: string): Promise<QuizSetJson> {
  const res = await request(
    `/api/teams/${teamId}/quiz-sets`,
    jsonInit('POST', { title: 'テストクイズ' }, cookie),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as QuizSetJson;
}

async function postQuestion(
  teamId: string,
  quizId: string,
  cookie: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return request(
    `/api/teams/${teamId}/quiz-sets/${quizId}/questions`,
    jsonInit('POST', body, cookie),
  );
}

// ---- §7.6.1 整合性検査 -----------------------------------------------------

describe('POST .../questions: §7.6.1 整合性検査', () => {
  it('text型: マーカー過剰は400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const res = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'text',
      textContent: '[b:1]と[b:2]',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['a'] }],
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
  });

  it('text型: マーカー不足は400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const res = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'text',
      textContent: '[b:1]のみ',
      blanks: [
        { blankOrder: 1, acceptedAnswers: ['a'] },
        { blankOrder: 2, acceptedAnswers: ['b'] },
      ],
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
  });

  it('blanks の blankOrder 重複は400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const res = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'text',
      textContent: '[b:1]',
      blanks: [
        { blankOrder: 1, acceptedAnswers: ['a'] },
        { blankOrder: 1, acceptedAnswers: ['b'] },
      ],
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
  });

  it('table型: blank セル数と空欄数の不一致は400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const res = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'table',
      blanks: [
        { blankOrder: 1, acceptedAnswers: ['a'] },
        { blankOrder: 2, acceptedAnswers: ['b'] },
      ],
      cells: [
        { rowIndex: 0, colIndex: 0, cellType: 'header', content: '国' },
        { rowIndex: 1, colIndex: 0, cellType: 'blank', blankOrder: 1 },
      ],
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
  });

  it('table型: セルが参照する blankOrder が blanks に存在しない場合は400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const res = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'table',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['a'] }],
      cells: [{ rowIndex: 0, colIndex: 0, cellType: 'blank', blankOrder: 99 }],
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
  });

  it('table型: 正しい構成は201で作成され、正解込みで返る', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const res = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'table',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['東京'] }],
      cells: [
        { rowIndex: 0, colIndex: 0, cellType: 'header', content: '首都' },
        { rowIndex: 1, colIndex: 0, cellType: 'blank', blankOrder: 1 },
      ],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      cells: Array<{ cellType: string; blankOrder: number | null }>;
      blanks: Array<{ acceptedAnswers: string[] }>;
    };
    expect(body.blanks[0]?.acceptedAnswers).toEqual(['東京']);
    const blankCell = body.cells.find((c) => c.cellType === 'blank');
    expect(blankCell?.blankOrder).toBe(1);
  });

  it('QUESTIONS_PER_QUIZ(200)超過は403 QUOTA_EXCEEDED', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const stmts = [];
    for (let i = 0; i < 200; i++) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO questions (id, quiz_set_id, type, display_order) VALUES (?, ?, ?, ?)',
        ).bind(newId(), quiz.id, 'text', i),
      );
    }
    await env.DB.batch(stmts);

    const res = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'text',
      textContent: '[b:1]',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['a'] }],
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('QUOTA_EXCEEDED');
  });
});

// ---- PATCH/DELETE questions, reorder --------------------------------------

describe('PATCH/DELETE .../questions/:id, reorder', () => {
  it('PATCH は viewer 403、editor は本文更新可(マーカー整合性を再検査)', async () => {
    const editor = await seedUser();
    const viewer = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    await addMember(teamId, viewer.id, 'viewer');
    const quiz = await createQuiz(teamId, editor.cookie);
    const created = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'text',
      textContent: '[b:1]',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['a'] }],
    });
    const question = (await created.json()) as { id: string };

    const ng = await request(
      `/api/teams/${teamId}/questions/${question.id}`,
      jsonInit('PATCH', { title: 'x' }, viewer.cookie),
    );
    expect(ng.status).toBe(403);

    const ok = await request(
      `/api/teams/${teamId}/questions/${question.id}`,
      jsonInit('PATCH', { textContent: '新しい[b:1]本文' }, editor.cookie),
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { textContent: string }).textContent).toBe('新しい[b:1]本文');

    const badMarker = await request(
      `/api/teams/${teamId}/questions/${question.id}`,
      jsonInit('PATCH', { textContent: 'マーカーなし' }, editor.cookie),
    );
    expect(badMarker.status).toBe(400);
  });

  it('DELETE で問題と子(blanks)が削除される', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const created = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'text',
      textContent: '[b:1]',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['a'] }],
    });
    const question = (await created.json()) as { id: string };

    const del = await request(`/api/teams/${teamId}/questions/${question.id}`, {
      method: 'DELETE',
      headers: { cookie: editor.cookie },
    });
    expect(del.status).toBe(204);
    expect(
      await env.DB.prepare('SELECT id FROM blanks WHERE question_id = ?').bind(question.id).first(),
    ).toBeNull();
  });

  it('reorder: 現在の問題一覧と一致しない orderedIds は400、一致すれば displayOrder が更新される', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const q1 = (await (
      await postQuestion(teamId, quiz.id, editor.cookie, {
        type: 'text',
        textContent: '[b:1]',
        blanks: [{ blankOrder: 1, acceptedAnswers: ['a'] }],
      })
    ).json()) as { id: string };
    const q2 = (await (
      await postQuestion(teamId, quiz.id, editor.cookie, {
        type: 'text',
        textContent: '[b:1]',
        blanks: [{ blankOrder: 1, acceptedAnswers: ['b'] }],
      })
    ).json()) as { id: string };

    const bad = await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/questions/reorder`,
      jsonInit('PATCH', { orderedIds: [q1.id] }, editor.cookie),
    );
    expect(bad.status).toBe(400);

    const ok = await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/questions/reorder`,
      jsonInit('PATCH', { orderedIds: [q2.id, q1.id] }, editor.cookie),
    );
    expect(ok.status).toBe(204);

    const order = await env.DB.prepare(
      'SELECT id, display_order FROM questions WHERE quiz_set_id = ? ORDER BY display_order',
    )
      .bind(quiz.id)
      .all<{ id: string; display_order: number }>();
    expect(order.results.map((r) => r.id)).toEqual([q2.id, q1.id]);
  });
});

// ---- PUT blanks/cells 全置換 -----------------------------------------------

describe('PUT .../questions/:id/blanks, .../cells', () => {
  it('text型: 空欄内容の更新は本文マーカーと一致していれば成功', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const created = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'text',
      textContent: '[b:1]と[b:2]',
      blanks: [
        { blankOrder: 1, acceptedAnswers: ['a'] },
        { blankOrder: 2, acceptedAnswers: ['b'] },
      ],
    });
    const question = (await created.json()) as { id: string };

    const res = await request(
      `/api/teams/${teamId}/questions/${question.id}/blanks`,
      jsonInit(
        'PUT',
        [
          { blankOrder: 1, acceptedAnswers: ['あ', 'A'] },
          { blankOrder: 2, acceptedAnswers: ['い'] },
        ],
        editor.cookie,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ blankOrder: number; acceptedAnswers: string[] }>;
    expect(body.find((b) => b.blankOrder === 1)?.acceptedAnswers).toEqual(['あ', 'A']);

    // マーカーと一致しない置換は400
    const bad = await request(
      `/api/teams/${teamId}/questions/${question.id}/blanks`,
      jsonInit('PUT', [{ blankOrder: 1, acceptedAnswers: ['x'] }], editor.cookie),
    );
    expect(bad.status).toBe(400);
  });

  it('table型: blank_id を維持したまま置換され、cells 側との対応が壊れない', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const created = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'table',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['東京'] }],
      cells: [{ rowIndex: 0, colIndex: 0, cellType: 'blank', blankOrder: 1 }],
    });
    const question = (await created.json()) as {
      id: string;
      blanks: Array<{ id: string }>;
    };
    const originalBlankId = question.blanks[0]?.id;

    const res = await request(
      `/api/teams/${teamId}/questions/${question.id}/blanks`,
      jsonInit('PUT', [{ blankOrder: 1, acceptedAnswers: ['とうきょう'] }], editor.cookie),
    );
    expect(res.status).toBe(200);
    const updatedBlank = (await res.json()) as Array<{ id: string; acceptedAnswers: string[] }>;
    expect(updatedBlank[0]?.id).toBe(originalBlankId);
    expect(updatedBlank[0]?.acceptedAnswers).toEqual(['とうきょう']);

    const cellRow = await env.DB.prepare(
      "SELECT blank_id FROM table_cells WHERE question_id = ? AND cell_type = 'blank'",
    )
      .bind(question.id)
      .first<{ blank_id: string }>();
    expect(cellRow?.blank_id).toBe(originalBlankId);
  });

  it('cells 全置換: 空欄セル数と blanks 数が不一致なら400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const created = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'table',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['東京'] }],
      cells: [{ rowIndex: 0, colIndex: 0, cellType: 'blank', blankOrder: 1 }],
    });
    const question = (await created.json()) as { id: string };

    const res = await request(
      `/api/teams/${teamId}/questions/${question.id}/cells`,
      jsonInit(
        'PUT',
        [{ rowIndex: 0, colIndex: 0, cellType: 'text', content: '穴埋めなし' }],
        editor.cookie,
      ),
    );
    expect(res.status).toBe(400);
  });

  it('cells 全置換: 正しい構成なら200で blankId が解決される', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const created = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'table',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['東京'] }],
      cells: [{ rowIndex: 0, colIndex: 0, cellType: 'blank', blankOrder: 1 }],
    });
    const question = (await created.json()) as { id: string };

    const res = await request(
      `/api/teams/${teamId}/questions/${question.id}/cells`,
      jsonInit(
        'PUT',
        [
          { rowIndex: 0, colIndex: 0, cellType: 'header', content: '首都' },
          { rowIndex: 1, colIndex: 0, cellType: 'blank', blankOrder: 1 },
        ],
        editor.cookie,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      rowIndex: number;
      cellType: string;
      blankOrder: number | null;
    }>;
    const blankCell = body.find((c) => c.cellType === 'blank');
    expect(blankCell?.blankOrder).toBe(1);
  });

  // ---- v1.1改訂: textContent/blanks 同梱による原子的更新 ------------------

  it('text型: textContent同梱で空欄集合の変更(追加/削除/番号変更)が1リクエストで成功し、維持された空欄のidは変わらない', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const created = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'text',
      textContent: '[b:1]と[b:2]',
      blanks: [
        { blankOrder: 1, acceptedAnswers: ['a'] },
        { blankOrder: 2, acceptedAnswers: ['b'] },
      ],
    });
    const question = (await created.json()) as {
      id: string;
      blanks: Array<{ id: string; blankOrder: number }>;
    };
    const keptBlankId = question.blanks.find((b) => b.blankOrder === 1)?.id;

    // blankOrder=2 を削除し、blankOrder=3 を新規追加。blankOrder=1 は維持。
    const res = await request(
      `/api/teams/${teamId}/questions/${question.id}/blanks`,
      jsonInit(
        'PUT',
        {
          textContent: '[b:1]と[b:3]',
          blanks: [
            { blankOrder: 1, acceptedAnswers: ['a'] },
            { blankOrder: 3, acceptedAnswers: ['c'] },
          ],
        },
        editor.cookie,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; blankOrder: number }>;
    expect(body.map((b) => b.blankOrder).sort()).toEqual([1, 3]);
    expect(body.find((b) => b.blankOrder === 1)?.id).toBe(keptBlankId);

    const updatedQuestion = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}`, {
      headers: { cookie: editor.cookie },
    });
    const full = (await updatedQuestion.json()) as {
      questions: Array<{ id: string; textContent: string | null }>;
    };
    expect(full.questions.find((q) => q.id === question.id)?.textContent).toBe('[b:1]と[b:3]');
  });

  it('text型: 同梱textContentとblanksのマーカー不整合は400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const created = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'text',
      textContent: '[b:1]',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['a'] }],
    });
    const question = (await created.json()) as { id: string };

    const res = await request(
      `/api/teams/${teamId}/questions/${question.id}/blanks`,
      jsonInit(
        'PUT',
        {
          textContent: '[b:1]と[b:2]',
          blanks: [{ blankOrder: 1, acceptedAnswers: ['a'] }],
        },
        editor.cookie,
      ),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
  });

  it('table型: blanksにtextContentを同梱すると400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const created = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'table',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['東京'] }],
      cells: [{ rowIndex: 0, colIndex: 0, cellType: 'blank', blankOrder: 1 }],
    });
    const question = (await created.json()) as { id: string };

    const res = await request(
      `/api/teams/${teamId}/questions/${question.id}/blanks`,
      jsonInit(
        'PUT',
        {
          textContent: 'これは無効',
          blanks: [{ blankOrder: 1, acceptedAnswers: ['東京'] }],
        },
        editor.cookie,
      ),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
  });

  it('table型: cellsにblanks同梱で空欄セル増減が1リクエストで成功する', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const created = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'table',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['東京'] }],
      cells: [{ rowIndex: 0, colIndex: 0, cellType: 'blank', blankOrder: 1 }],
    });
    const question = (await created.json()) as {
      id: string;
      blanks: Array<{ id: string; blankOrder: number }>;
    };
    const keptBlankId = question.blanks[0]?.id;

    // blankOrder=1 は維持し、blankOrder=2 を新規セルとして追加。
    const res = await request(
      `/api/teams/${teamId}/questions/${question.id}/cells`,
      jsonInit(
        'PUT',
        {
          cells: [
            { rowIndex: 0, colIndex: 0, cellType: 'blank', blankOrder: 1 },
            { rowIndex: 0, colIndex: 1, cellType: 'blank', blankOrder: 2 },
          ],
          blanks: [
            { blankOrder: 1, acceptedAnswers: ['東京'] },
            { blankOrder: 2, acceptedAnswers: ['大阪'] },
          ],
        },
        editor.cookie,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      colIndex: number;
      cellType: string;
      blankOrder: number | null;
    }>;
    expect(
      body
        .filter((c) => c.cellType === 'blank')
        .map((c) => c.blankOrder)
        .sort(),
    ).toEqual([1, 2]);

    const blankRows = await env.DB.prepare(
      'SELECT id, blank_order FROM blanks WHERE question_id = ? ORDER BY blank_order',
    )
      .bind(question.id)
      .all<{ id: string; blank_order: number }>();
    expect(blankRows.results).toHaveLength(2);
    expect(blankRows.results.find((r) => r.blank_order === 1)?.id).toBe(keptBlankId);
  });

  it('table型: cellsにblanks同梱で不整合(空欄セル数と一致しない)なら400', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);
    const created = await postQuestion(teamId, quiz.id, editor.cookie, {
      type: 'table',
      blanks: [{ blankOrder: 1, acceptedAnswers: ['東京'] }],
      cells: [{ rowIndex: 0, colIndex: 0, cellType: 'blank', blankOrder: 1 }],
    });
    const question = (await created.json()) as { id: string };

    const res = await request(
      `/api/teams/${teamId}/questions/${question.id}/cells`,
      jsonInit(
        'PUT',
        {
          cells: [{ rowIndex: 0, colIndex: 0, cellType: 'text', content: '穴埋めなし' }],
          blanks: [{ blankOrder: 1, acceptedAnswers: ['東京'] }],
        },
        editor.cookie,
      ),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
  });
});
