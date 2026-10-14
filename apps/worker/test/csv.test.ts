import { env } from 'cloudflare:test';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { addMember, errorCode, jsonInit, request, seedTeam, seedUser } from './helpers';

interface QuizSetJson {
  id: string;
}

async function createQuiz(
  teamId: string,
  cookie: string,
  title = 'テストクイズ',
): Promise<QuizSetJson> {
  const res = await request(`/api/teams/${teamId}/quiz-sets`, jsonInit('POST', { title }, cookie));
  expect(res.status).toBe(201);
  return (await res.json()) as QuizSetJson;
}

function csvFile(filename: string, content: string): File {
  return new File([content], filename, { type: 'text/csv' });
}

function importForm(files: { textCsv?: string; tableCsv?: string; blanksCsv?: string }): FormData {
  const form = new FormData();
  if (files.textCsv !== undefined)
    form.set('text_questions', csvFile('text_questions.csv', files.textCsv));
  if (files.tableCsv !== undefined)
    form.set('table_questions', csvFile('table_questions.csv', files.tableCsv));
  if (files.blanksCsv !== undefined) form.set('blanks', csvFile('blanks.csv', files.blanksCsv));
  return form;
}

async function preview(
  teamId: string,
  quizId: string,
  cookie: string,
  files: Parameters<typeof importForm>[0],
): Promise<Response> {
  return request(`/api/teams/${teamId}/quiz-sets/${quizId}/import/preview`, {
    method: 'POST',
    headers: { cookie },
    body: importForm(files),
  });
}

async function confirm(
  teamId: string,
  quizId: string,
  cookie: string,
  files: Parameters<typeof importForm>[0],
): Promise<Response> {
  return request(`/api/teams/${teamId}/quiz-sets/${quizId}/import/confirm`, {
    method: 'POST',
    headers: { cookie },
    body: importForm(files),
  });
}

const TEXT_CSV = [
  'question_id,display_order,question_title,text_content,image_url',
  'q1,0,首都,日本の首都は[b:1]です。,',
].join('\n');

const TABLE_CSV = [
  'question_id,display_order,question_title,image_url,row,col,cell_type,content,is_blank',
  'q2,1,県庁,,0,0,header,県,',
  'q2,1,県庁,,0,1,header,県庁所在地,',
  'q2,1,県庁,,1,0,text,東京都,',
  'q2,1,県庁,,1,1,blank,,1',
].join('\n');

const BLANKS_CSV = [
  'question_id,blank_order,accepted_answers,hint',
  'q1,1,東京|とうきょう|Tokyo,日本の首都',
  'q2,1,新宿,都庁がある場所',
].join('\n');

describe('POST .../import/preview', () => {
  it('正常3ファイルは問題数・空欄数が正しく、警告ゼロ', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const res = await preview(teamId, quiz.id, editor.cookie, {
      textCsv: TEXT_CSV,
      tableCsv: TABLE_CSV,
      blanksCsv: BLANKS_CSV,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      questionCount: number;
      blankCount: number;
      warnings: string[];
    };
    expect(body.questionCount).toBe(2);
    expect(body.blankCount).toBe(2);
    expect(body.warnings).toEqual([]);

    // preview は DB 書き込みなし
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE quiz_set_id = ?')
      .bind(quiz.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('[b:N] マーカー不整合(過不足)で警告', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const badTextCsv = [
      'question_id,display_order,question_title,text_content,image_url',
      'q1,0,首都,日本の首都は[b:1]と[b:2]です。,',
    ].join('\n');

    const res = await preview(teamId, quiz.id, editor.cookie, {
      textCsv: badTextCsv,
      blanksCsv: BLANKS_CSV,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warnings: string[] };
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings.some((w) => w.includes('blanks.csv'))).toBe(true);
  });

  it('blanks.csv に無い空欄(表)で警告', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const res = await preview(teamId, quiz.id, editor.cookie, {
      tableCsv: TABLE_CSV,
      blanksCsv: 'question_id,blank_order,accepted_answers,hint\n', // blanks.csv が空
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warnings: string[] };
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it('/img/{id} 形式でない image_url はスキップ警告', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const csvWithBadImage = [
      'question_id,display_order,question_title,text_content,image_url',
      'q1,0,首都,日本の首都は[b:1]です。,https://example.com/foo.png',
    ].join('\n');

    const res = await preview(teamId, quiz.id, editor.cookie, {
      textCsv: csvWithBadImage,
      blanksCsv: 'question_id,blank_order,accepted_answers,hint\nq1,1,東京,',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warnings: string[] };
    expect(body.warnings.some((w) => w.includes('image_url'))).toBe(true);
  });

  it('同一チーム外の画像はスキップ警告', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    const otherTeamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const otherImageId = 'a'.repeat(32);
    await env.DB.prepare(
      "INSERT INTO images (id, team_id, r2_key, filename, mime_type, file_size) VALUES (?, ?, 'k', 'f', 'image/png', 1)",
    )
      .bind(otherImageId, otherTeamId)
      .run();

    const csvWithForeignImage = [
      'question_id,display_order,question_title,text_content,image_url',
      `q1,0,首都,日本の首都は[b:1]です。,/img/${otherImageId}`,
    ].join('\n');

    const res = await preview(teamId, quiz.id, editor.cookie, {
      textCsv: csvWithForeignImage,
      blanksCsv: 'question_id,blank_order,accepted_answers,hint\nq1,1,東京,',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warnings: string[] };
    expect(body.warnings.some((w) => w.includes('見つからない'))).toBe(true);
  });

  it('viewer は403', async () => {
    const viewer = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, viewer.id, 'viewer');
    const owner = await seedUser();
    await addMember(teamId, owner.id, 'owner');
    const quiz = await createQuiz(teamId, owner.cookie);

    const res = await preview(teamId, quiz.id, viewer.cookie, {
      textCsv: TEXT_CSV,
      blanksCsv: BLANKS_CSV,
    });
    expect(res.status).toBe(403);
  });
});

describe('POST .../import/confirm', () => {
  it('新規インポートは created を返し、再送で updated を返す（import_key維持・質問IDは変わる）', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const first = await confirm(teamId, quiz.id, editor.cookie, {
      textCsv: TEXT_CSV,
      tableCsv: TABLE_CSV,
      blanksCsv: BLANKS_CSV,
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { created: number; updated: number };
    expect(firstBody).toEqual({ created: 2, updated: 0 });

    const { results: firstRows } = await env.DB.prepare(
      'SELECT id, import_key FROM questions WHERE quiz_set_id = ? ORDER BY import_key',
    )
      .bind(quiz.id)
      .all<{ id: string; import_key: string }>();
    expect(firstRows).toHaveLength(2);
    const idByKeyBefore = new Map(firstRows.map((r) => [r.import_key, r.id]));

    const second = await confirm(teamId, quiz.id, editor.cookie, {
      textCsv: TEXT_CSV,
      tableCsv: TABLE_CSV,
      blanksCsv: BLANKS_CSV,
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { created: number; updated: number };
    expect(secondBody).toEqual({ created: 0, updated: 2 });

    const { results: secondRows } = await env.DB.prepare(
      'SELECT id, import_key FROM questions WHERE quiz_set_id = ? ORDER BY import_key',
    )
      .bind(quiz.id)
      .all<{ id: string; import_key: string }>();
    expect(secondRows).toHaveLength(2);
    for (const row of secondRows) {
      const prevId = idByKeyBefore.get(row.import_key);
      expect(prevId).toBeTruthy();
      expect(row.id).not.toBe(prevId); // 質問IDは変わる
    }
  });

  it('整合性違反(text マーカー過不足)は400 VALIDATIONでDB無変更', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await createQuiz(teamId, editor.cookie);

    const badTextCsv = [
      'question_id,display_order,question_title,text_content,image_url',
      'q1,0,首都,日本の首都は[b:1]と[b:2]です。,',
    ].join('\n');

    const res = await confirm(teamId, quiz.id, editor.cookie, {
      textCsv: badTextCsv,
      blanksCsv: BLANKS_CSV,
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE quiz_set_id = ?')
      .bind(quiz.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('viewer は403', async () => {
    const viewer = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, viewer.id, 'viewer');
    const owner = await seedUser();
    await addMember(teamId, owner.id, 'owner');
    const quiz = await createQuiz(teamId, owner.cookie);

    const res = await confirm(teamId, quiz.id, viewer.cookie, {
      textCsv: TEXT_CSV,
      blanksCsv: BLANKS_CSV,
    });
    expect(res.status).toBe(403);
  });
});

describe('GET .../export', () => {
  async function buildFullQuiz(teamId: string, cookie: string): Promise<QuizSetJson> {
    const quiz = await createQuiz(teamId, cookie, 'エクスポート元');

    const textRes = await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/questions`,
      jsonInit(
        'POST',
        {
          type: 'text',
          title: '計算問題',
          textContent: '答えは[b:1]です。',
          blanks: [{ blankOrder: 1, acceptedAnswers: ['=SUM(A1)', '10'] }],
        },
        cookie,
      ),
    );
    expect(textRes.status).toBe(201);

    const tableRes = await request(
      `/api/teams/${teamId}/quiz-sets/${quiz.id}/questions`,
      jsonInit(
        'POST',
        {
          type: 'table',
          title: '県庁',
          blanks: [{ blankOrder: 1, acceptedAnswers: ['新宿'] }],
          cells: [
            { rowIndex: 0, colIndex: 0, cellType: 'header', content: '県' },
            { rowIndex: 0, colIndex: 1, cellType: 'header', content: '県庁所在地' },
            { rowIndex: 1, colIndex: 0, cellType: 'text', content: '東京都' },
            { rowIndex: 1, colIndex: 1, cellType: 'blank', blankOrder: 1 },
          ],
        },
        cookie,
      ),
    );
    expect(tableRes.status).toBe(201);

    return quiz;
  }

  it("zip を解凍すると§10形式のCSVが得られ、CSVインジェクション対策で先頭に'が付く", async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const quiz = await buildFullQuiz(teamId, editor.cookie);

    const res = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/export`, {
      headers: { cookie: editor.cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');

    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf);
    expect(Object.keys(files).sort()).toEqual(
      ['blanks.csv', 'table_questions.csv', 'text_questions.csv'].sort(),
    );

    const decoder = new TextDecoder();
    const textCsv = decoder.decode(files['text_questions.csv']);
    const tableCsv = decoder.decode(files['table_questions.csv']);
    const blanksCsv = decoder.decode(files['blanks.csv']);

    expect(textCsv.split('\n')[0]).toBe(
      'question_id,display_order,question_title,text_content,image_url',
    );
    expect(textCsv).toContain('答えは[b:1]です。');
    expect(tableCsv.split('\n')[0]).toBe(
      'question_id,display_order,question_title,image_url,row,col,cell_type,content,is_blank',
    );
    expect(tableCsv).toContain('東京都');
    // =SUM(A1) を正解に持つ blank は '=SUM(A1) でエクスポートされる
    expect(blanksCsv).toContain("'=SUM(A1)");
    expect(blanksCsv).not.toContain(',=SUM(A1)');
  });

  it('viewer は403', async () => {
    const viewer = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, viewer.id, 'viewer');
    const owner = await seedUser();
    await addMember(teamId, owner.id, 'owner');
    const quiz = await buildFullQuiz(teamId, owner.cookie);

    const res = await request(`/api/teams/${teamId}/quiz-sets/${quiz.id}/export`, {
      headers: { cookie: viewer.cookie },
    });
    expect(res.status).toBe(403);
  });

  it('往復: export → 別クイズへ import(confirm) で同構造が再現される', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    const srcQuiz = await buildFullQuiz(teamId, editor.cookie);

    const exportRes = await request(`/api/teams/${teamId}/quiz-sets/${srcQuiz.id}/export`, {
      headers: { cookie: editor.cookie },
    });
    expect(exportRes.status).toBe(200);
    const buf = new Uint8Array(await exportRes.arrayBuffer());
    const files = unzipSync(buf);
    const decoder = new TextDecoder();

    const destQuiz = await createQuiz(teamId, editor.cookie, 'インポート先');
    const confirmRes = await confirm(teamId, destQuiz.id, editor.cookie, {
      textCsv: decoder.decode(files['text_questions.csv']),
      tableCsv: decoder.decode(files['table_questions.csv']),
      blanksCsv: decoder.decode(files['blanks.csv']),
    });
    expect(confirmRes.status).toBe(200);
    const confirmBody = (await confirmRes.json()) as { created: number; updated: number };
    expect(confirmBody).toEqual({ created: 2, updated: 0 });

    const destFull = await request(`/api/teams/${teamId}/quiz-sets/${destQuiz.id}`, {
      headers: { cookie: editor.cookie },
    });
    expect(destFull.status).toBe(200);
    const destBody = (await destFull.json()) as {
      questions: Array<{
        type: string;
        textContent: string | null;
        blanks: Array<{ acceptedAnswers: string[] }>;
        cells: Array<{ content: string | null }> | null;
      }>;
    };
    expect(destBody.questions).toHaveLength(2);
    const textQ = destBody.questions.find((q) => q.type === 'text');
    expect(textQ?.textContent).toBe('答えは[b:1]です。');
    // CSVインジェクション対策の ' はエクスポートされたCSVの文字列そのものに付与されるため、
    // その CSV をそのまま再インポートすると accepted_answers にも ' が残る(単方向のガード)
    expect(textQ?.blanks[0]?.acceptedAnswers).toContain("'=SUM(A1)");
    const tableQ = destBody.questions.find((q) => q.type === 'table');
    expect(tableQ?.cells?.some((c) => c.content === '東京都')).toBe(true);
  });
});
