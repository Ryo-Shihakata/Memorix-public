import type {
  BlankDetail,
  PlayPayload,
  QuestionDetail,
  QuizSetDetail,
  QuizSetFull,
  QuizSetSummary,
  Subject,
  TableCellDetail,
} from '@memorix/shared';
import type { SessionUser } from '../env';

// quiz_sets + team + subject を1発で引くための共通 SELECT 断片。
// question_count はサマリ表示（§4.3 QuizSetSummary）用のサブクエリ。
export const QUIZ_SET_COLUMNS = `
  qs.id, qs.team_id, qs.folder_id, qs.title, qs.description, qs.visibility, qs.share_token,
  qs.shuffle_questions, qs.time_limit_secs, qs.normalize_kana, qs.play_count,
  qs.suspended_at, qs.suspended_reason, qs.published_at, qs.created_at, qs.updated_at,
  qs.subject_id, s.slug AS subject_slug, s.name AS subject_name, s.icon AS subject_icon,
  s.color AS subject_color, s.display_order AS subject_display_order, s.is_active AS subject_is_active,
  t.name AS team_name,
  (SELECT COUNT(*) FROM questions q WHERE q.quiz_set_id = qs.id) AS question_count
`;

export const QUIZ_SET_FROM = `FROM quiz_sets qs
  JOIN teams t ON t.id = qs.team_id
  LEFT JOIN subjects s ON s.id = qs.subject_id`;

export interface QuizSetRow {
  id: string;
  team_id: string;
  folder_id: string | null;
  title: string;
  description: string | null;
  visibility: 'public' | 'unlisted' | 'private';
  share_token: string | null;
  shuffle_questions: number;
  time_limit_secs: number | null;
  normalize_kana: number;
  play_count: number;
  suspended_at: string | null;
  suspended_reason: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  subject_id: string | null;
  subject_slug: string | null;
  subject_name: string | null;
  subject_icon: string | null;
  subject_color: string | null;
  subject_display_order: number | null;
  subject_is_active: number | null;
  team_name: string;
  question_count: number;
}

export async function fetchQuizSetRow(db: D1Database, id: string): Promise<QuizSetRow | null> {
  return db
    .prepare(`SELECT ${QUIZ_SET_COLUMNS} ${QUIZ_SET_FROM} WHERE qs.id = ?`)
    .bind(id)
    .first<QuizSetRow>();
}

export async function fetchQuizSetRowByShareToken(
  db: D1Database,
  token: string,
): Promise<QuizSetRow | null> {
  return db
    .prepare(`SELECT ${QUIZ_SET_COLUMNS} ${QUIZ_SET_FROM} WHERE qs.share_token = ?`)
    .bind(token)
    .first<QuizSetRow>();
}

function rowToSubject(row: QuizSetRow): Subject | null {
  if (!row.subject_id) return null;
  return {
    id: row.subject_id,
    slug: row.subject_slug ?? '',
    name: row.subject_name ?? '',
    icon: row.subject_icon,
    color: row.subject_color,
    displayOrder: row.subject_display_order ?? 0,
    isActive: row.subject_is_active === 1,
  };
}

export function toQuizSetSummary(row: QuizSetRow): QuizSetSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    subject: rowToSubject(row),
    teamName: row.team_name,
    playCount: row.play_count,
    questionCount: row.question_count,
    updatedAt: row.updated_at,
  };
}

export function toQuizSetDetail(row: QuizSetRow, appOrigin: string): QuizSetDetail {
  return {
    ...toQuizSetSummary(row),
    teamId: row.team_id,
    folderId: row.folder_id,
    visibility: row.visibility,
    shuffleQuestions: row.shuffle_questions === 1,
    normalizeKana: row.normalize_kana === 1,
    timeLimitSecs: row.time_limit_secs,
    shareUrl: row.share_token ? `${appOrigin}/share/${row.share_token}` : null,
  };
}

interface QuestionRow {
  id: string;
  quiz_set_id: string;
  type: 'text' | 'table';
  title: string | null;
  display_order: number;
  text_content: string | null;
  image_id: string | null;
  image_position: 'above' | 'below';
  image_caption: string | null;
}

interface BlankRow {
  id: string;
  question_id: string;
  blank_order: number;
  accepted_answers: string;
  hint: string | null;
  hint_image_id: string | null;
}

// question_id はクイズ全体取得時のグルーピングにのみ使う。questions.ts の
// PUT .../cells レスポンスは question_id を選択しないため、toCellDetail は
// CellDetailRow（question_id なし）を受け取れるようにしておく。
export interface CellDetailRow {
  row_index: number;
  col_index: number;
  cell_type: 'text' | 'header' | 'blank' | 'image';
  content: string | null;
  image_id: string | null;
  blank_order: number | null;
}

interface CellRow extends CellDetailRow {
  question_id: string;
}

export function toBlankDetail(row: BlankRow): BlankDetail {
  return {
    id: row.id,
    blankOrder: row.blank_order,
    acceptedAnswers: JSON.parse(row.accepted_answers) as string[],
    hint: row.hint,
    hintImageId: row.hint_image_id,
  };
}

export function toCellDetail(row: CellDetailRow): TableCellDetail {
  return {
    rowIndex: row.row_index,
    colIndex: row.col_index,
    cellType: row.cell_type,
    content: row.content,
    imageId: row.image_id,
    blankOrder: row.blank_order,
  };
}

// 1問分のフル構造（正解込み）を組み立てる。questions.ts の POST/PATCH レスポンスで使用。
export async function loadQuestionDetail(
  db: D1Database,
  questionId: string,
): Promise<QuestionDetail | null> {
  const q = await db
    .prepare(
      `SELECT id, quiz_set_id, type, title, display_order, text_content, image_id, image_position, image_caption
       FROM questions WHERE id = ?`,
    )
    .bind(questionId)
    .first<QuestionRow>();
  if (!q) return null;

  const { results: blankRows } = await db
    .prepare(
      'SELECT id, question_id, blank_order, accepted_answers, hint, hint_image_id FROM blanks WHERE question_id = ? ORDER BY blank_order',
    )
    .bind(questionId)
    .all<BlankRow>();

  let cells: TableCellDetail[] | null = null;
  if (q.type === 'table') {
    const { results: cellRows } = await db
      .prepare(
        `SELECT tc.row_index, tc.col_index, tc.cell_type, tc.content, tc.image_id, b.blank_order
         FROM table_cells tc LEFT JOIN blanks b ON b.id = tc.blank_id
         WHERE tc.question_id = ? ORDER BY tc.row_index, tc.col_index`,
      )
      .bind(questionId)
      .all<CellRow>();
    cells = cellRows.map(toCellDetail);
  }

  return {
    id: q.id,
    type: q.type,
    title: q.title,
    displayOrder: q.display_order,
    textContent: q.text_content,
    imageId: q.image_id,
    imagePosition: q.image_position,
    imageCaption: q.image_caption,
    blanks: blankRows.map(toBlankDetail),
    cells,
  };
}

// クイズ全体のフル構造（Studio GET .../quiz-sets/:id、複製元の読み込み用）
export async function loadQuizSetFull(
  db: D1Database,
  row: QuizSetRow,
  appOrigin: string,
): Promise<QuizSetFull> {
  const detail = toQuizSetDetail(row, appOrigin);

  const { results: qRows } = await db
    .prepare(
      `SELECT id, quiz_set_id, type, title, display_order, text_content, image_id, image_position, image_caption
       FROM questions WHERE quiz_set_id = ? ORDER BY display_order, id`,
    )
    .bind(row.id)
    .all<QuestionRow>();

  const { results: blankRows } = await db
    .prepare(
      `SELECT b.id, b.question_id, b.blank_order, b.accepted_answers, b.hint, b.hint_image_id
       FROM blanks b JOIN questions q ON q.id = b.question_id
       WHERE q.quiz_set_id = ? ORDER BY b.question_id, b.blank_order`,
    )
    .bind(row.id)
    .all<BlankRow>();

  const { results: cellRows } = await db
    .prepare(
      `SELECT tc.question_id, tc.row_index, tc.col_index, tc.cell_type, tc.content, tc.image_id, b.blank_order
       FROM table_cells tc JOIN questions q ON q.id = tc.question_id
       LEFT JOIN blanks b ON b.id = tc.blank_id
       WHERE q.quiz_set_id = ? ORDER BY tc.question_id, tc.row_index, tc.col_index`,
    )
    .bind(row.id)
    .all<CellRow>();

  const blanksByQuestion = new Map<string, BlankDetail[]>();
  for (const b of blankRows) {
    const list = blanksByQuestion.get(b.question_id) ?? [];
    list.push(toBlankDetail(b));
    blanksByQuestion.set(b.question_id, list);
  }
  const cellsByQuestion = new Map<string, TableCellDetail[]>();
  for (const cellRow of cellRows) {
    const list = cellsByQuestion.get(cellRow.question_id) ?? [];
    list.push(toCellDetail(cellRow));
    cellsByQuestion.set(cellRow.question_id, list);
  }

  const questions: QuestionDetail[] = qRows.map((q) => ({
    id: q.id,
    type: q.type,
    title: q.title,
    displayOrder: q.display_order,
    textContent: q.text_content,
    imageId: q.image_id,
    imagePosition: q.image_position,
    imageCaption: q.image_caption,
    blanks: blanksByQuestion.get(q.id) ?? [],
    cells: q.type === 'table' ? (cellsByQuestion.get(q.id) ?? []) : null,
  }));

  return { ...detail, questions };
}

export async function imageBelongsToTeam(
  db: D1Database,
  imageId: string,
  teamId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM images WHERE id = ? AND team_id = ?')
    .bind(imageId, teamId)
    .first();
  return row !== null;
}

// text 型問題の本文から [b:N] マーカーの集合を取り出す（§7.6.1）
export function extractMarkerOrders(textContent: string): Set<number> {
  const set = new Set<number>();
  for (const m of textContent.matchAll(/\[b:(\d+)\]/g)) {
    const value = m[1];
    if (value !== undefined) set.add(Number(value));
  }
  return set;
}

export function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

async function isTeamMemberOrAdmin(
  db: D1Database,
  teamId: string,
  user: SessionUser | null,
): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const member = await db
    .prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?')
    .bind(teamId, user.id)
    .first();
  return member !== null;
}

// §7.2 公開閲覧の認可判定: suspended は所有チームメンバー+admin のみ、
// private は所属チームメンバーのみ。それ以外(public/unlisted かつ非suspend)は誰でも。
// 非公開時は 404（存在の有無を隠す）。
export async function checkPublicQuizAccess(
  db: D1Database,
  row: QuizSetRow,
  user: SessionUser | null,
): Promise<'ok' | 'not_found'> {
  if (row.suspended_at !== null) {
    return (await isTeamMemberOrAdmin(db, row.team_id, user)) ? 'ok' : 'not_found';
  }
  if (row.visibility === 'private') {
    return (await isTeamMemberOrAdmin(db, row.team_id, user)) ? 'ok' : 'not_found';
  }
  return 'ok';
}

// §7 一覧の q 検索: LIKE の % _ をエスケープ
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function imgUrl(imageId: string | null): string | null {
  return imageId ? `/img/${imageId}` : null;
}

interface PlayQuestionRow {
  id: string;
  type: 'text' | 'table';
  title: string | null;
  text_content: string | null;
  image_id: string | null;
  image_position: 'above' | 'below';
  image_caption: string | null;
}

interface PlayBlankRow {
  id: string;
  question_id: string;
  blank_order: number;
  hint: string | null;
  hint_image_id: string | null;
}

interface PlayCellRow {
  question_id: string;
  row_index: number;
  col_index: number;
  cell_type: 'text' | 'header' | 'blank' | 'image';
  content: string | null;
  image_id: string | null;
  blank_id: string | null;
}

// §8.1 PlayPayload 組み立て。accepted_answers は一切 SELECT しない（正解非漏洩）。
// questionOrder は quiz_sessions.question_order に保存した出題順（シャッフル後）。
export async function loadPlayPayload(
  db: D1Database,
  sessionId: string,
  row: QuizSetRow,
  questionOrder: string[],
): Promise<PlayPayload> {
  const { results: qRows } = await db
    .prepare(
      `SELECT id, type, title, text_content, image_id, image_position, image_caption
       FROM questions WHERE quiz_set_id = ?`,
    )
    .bind(row.id)
    .all<PlayQuestionRow>();

  const { results: blankRows } = await db
    .prepare(
      `SELECT b.id, b.question_id, b.blank_order, b.hint, b.hint_image_id
       FROM blanks b JOIN questions q ON q.id = b.question_id
       WHERE q.quiz_set_id = ? ORDER BY b.question_id, b.blank_order`,
    )
    .bind(row.id)
    .all<PlayBlankRow>();

  const { results: cellRows } = await db
    .prepare(
      `SELECT tc.question_id, tc.row_index, tc.col_index, tc.cell_type, tc.content,
              tc.image_id, tc.blank_id
       FROM table_cells tc JOIN questions q ON q.id = tc.question_id
       WHERE q.quiz_set_id = ? ORDER BY tc.question_id, tc.row_index, tc.col_index`,
    )
    .bind(row.id)
    .all<PlayCellRow>();

  const qById = new Map(qRows.map((q) => [q.id, q]));
  const blanksByQuestion = new Map<string, PlayBlankRow[]>();
  for (const b of blankRows) {
    const list = blanksByQuestion.get(b.question_id) ?? [];
    list.push(b);
    blanksByQuestion.set(b.question_id, list);
  }
  const cellsByQuestion = new Map<string, PlayCellRow[]>();
  for (const cr of cellRows) {
    const list = cellsByQuestion.get(cr.question_id) ?? [];
    list.push(cr);
    cellsByQuestion.set(cr.question_id, list);
  }

  const questions: PlayPayload['questions'] = [];
  for (const questionId of questionOrder) {
    const q = qById.get(questionId);
    if (!q) continue; // 保存済み question_order と questions が食い違うことは無い想定
    questions.push({
      id: q.id,
      type: q.type,
      title: q.title,
      textContent: q.text_content,
      image: q.image_id
        ? {
            url: imgUrl(q.image_id) as string,
            position: q.image_position,
            caption: q.image_caption,
          }
        : null,
      cells:
        q.type === 'table'
          ? (cellsByQuestion.get(q.id) ?? []).map((c) => ({
              rowIndex: c.row_index,
              colIndex: c.col_index,
              cellType: c.cell_type,
              content: c.content,
              imageUrl: imgUrl(c.image_id),
              blankId: c.blank_id,
            }))
          : null,
      blanks: (blanksByQuestion.get(q.id) ?? []).map((b) => ({
        id: b.id,
        blankOrder: b.blank_order,
        hint: b.hint,
        hintImageUrl: imgUrl(b.hint_image_id),
      })),
    });
  }

  return {
    sessionId,
    quizSet: {
      id: row.id,
      title: row.title,
      description: row.description,
      teamName: row.team_name,
      normalizeKana: row.normalize_kana === 1,
      timeLimitSecs: row.time_limit_secs,
    },
    questions,
  };
}
