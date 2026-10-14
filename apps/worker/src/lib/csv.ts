import { LIMITS } from '@memorix/shared';
import { extractMarkerOrders, setsEqual } from './quizAccess';

// §10 CSV 仕様。DB非依存の純粋なパース/検証/シリアライズをここに集約し、
// テスト容易性を確保する（image_url のチーム所有チェックのみ DB が要るため
// routes/teams/csv.ts 側で行う）。

export type CellType = 'text' | 'header' | 'blank' | 'image';

export interface ParsedBlank {
  blankOrder: number;
  acceptedAnswers: string[];
  hint: string | null;
}

export interface ParsedCell {
  rowIndex: number;
  colIndex: number;
  cellType: CellType;
  content: string | null;
  blankOrder: number | null;
}

export interface ParsedQuestion {
  importKey: string;
  type: 'text' | 'table';
  displayOrder: number;
  title: string | null;
  textContent: string | null;
  imageUrl: string | null;
  cells: ParsedCell[] | null;
  blanks: ParsedBlank[];
}

export interface CsvIssue {
  message: string;
  blocking: boolean;
}

export interface ParseCsvResult {
  questions: ParsedQuestion[];
  issues: CsvIssue[];
}

export class CsvSyntaxError extends Error {}

// /img/{32桁16進} 形式かどうか（§10: それ以外の URL は警告してスキップ）
const IMG_URL_RE = /^\/img\/([0-9a-f]{32})$/;

export function isImgUrlFormat(url: string): string | null {
  const m = IMG_URL_RE.exec(url);
  return m ? (m[1] ?? null) : null;
}

interface CsvRecord {
  [key: string]: string;
}

// RFC4180 準拠の自作パーサ。csv-parse は内部で Buffer.from() を呼ぶため
// nodejs_compat 未設定の本番 wrangler.jsonc では動作しない懸念があり
// （§10: 「動かなければ軽量な代替(自作パーサ可)を採用」の指示に従う）、
// Buffer 等 Node 専用 API に依存しない実装をここで用意する。
// クォート("...")・エスケープ("")・カンマ/改行を含むフィールド・CRLF/LF 混在に対応。
function parseCsvGrid(text: string): string[][] {
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // UTF-8 BOM 除去

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = s.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // 空行（全フィールドが空文字）はスキップ（csv-parse の skip_empty_lines 相当）
  return rows.filter((r) => r.some((cell) => cell !== ''));
}

function parseRecords(csvText: string, label: string): CsvRecord[] {
  let grid: string[][];
  try {
    grid = parseCsvGrid(csvText);
  } catch {
    throw new CsvSyntaxError(`${label} の形式が正しくありません。`);
  }
  if (grid.length === 0) return [];
  const header = grid[0] as string[];
  const headerNames = header.map((h) => h.trim());
  return grid.slice(1).map((row) => {
    const record: CsvRecord = {};
    headerNames.forEach((name, idx) => {
      record[name] = (row[idx] ?? '').trim();
    });
    return record;
  });
}

function parseIntStrict(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  if (!/^-?\d+$/.test(value.trim())) return null;
  return Number.parseInt(value.trim(), 10);
}

// ---- text_questions.csv -----------------------------------------------
function parseTextQuestions(
  csvText: string | undefined,
  issues: CsvIssue[],
  seenImportKeys: Set<string>,
): Map<string, ParsedQuestion> {
  const byKey = new Map<string, ParsedQuestion>();
  if (!csvText) return byKey;
  const records = parseRecords(csvText, 'text_questions.csv');

  records.forEach((row, index) => {
    const rowLabel = `text_questions.csv 行${index + 2}`;
    const importKey = row.question_id?.trim();
    if (!importKey) {
      issues.push({ message: `${rowLabel}: question_id が空です。`, blocking: true });
      return;
    }
    if (seenImportKeys.has(importKey)) {
      issues.push({
        message: `${rowLabel}: question_id「${importKey}」が重複しています。`,
        blocking: true,
      });
      return;
    }
    const displayOrder = parseIntStrict(row.display_order);
    if (displayOrder === null) {
      issues.push({ message: `${rowLabel}: display_order が不正です。`, blocking: true });
    }
    const textContent = row.text_content ?? '';
    if (textContent.length > LIMITS.TEXT_CONTENT_MAX_LEN) {
      issues.push({ message: `${rowLabel}: text_content が長すぎます。`, blocking: true });
    }

    seenImportKeys.add(importKey);
    byKey.set(importKey, {
      importKey,
      type: 'text',
      displayOrder: displayOrder ?? 0,
      title: row.question_title?.trim() ? row.question_title.trim() : null,
      textContent,
      imageUrl: row.image_url?.trim() ? row.image_url.trim() : null,
      cells: null,
      blanks: [],
    });
  });

  return byKey;
}

// ---- table_questions.csv -----------------------------------------------
const CELL_TYPES: CellType[] = ['text', 'header', 'blank', 'image'];

function parseTableQuestions(
  csvText: string | undefined,
  issues: CsvIssue[],
  seenImportKeys: Set<string>,
): Map<string, ParsedQuestion> {
  const byKey = new Map<string, ParsedQuestion>();
  if (!csvText) return byKey;
  const records = parseRecords(csvText, 'table_questions.csv');

  const seenPosByKey = new Map<string, Set<string>>();

  records.forEach((row, index) => {
    const rowLabel = `table_questions.csv 行${index + 2}`;
    const importKey = row.question_id?.trim();
    if (!importKey) {
      issues.push({ message: `${rowLabel}: question_id が空です。`, blocking: true });
      return;
    }
    if (seenImportKeys.has(importKey) && !byKey.has(importKey)) {
      issues.push({
        message: `${rowLabel}: question_id「${importKey}」が text_questions.csv と重複しています。`,
        blocking: true,
      });
      return;
    }

    let question = byKey.get(importKey);
    if (!question) {
      const displayOrder = parseIntStrict(row.display_order);
      if (displayOrder === null) {
        issues.push({ message: `${rowLabel}: display_order が不正です。`, blocking: true });
      }
      seenImportKeys.add(importKey);
      question = {
        importKey,
        type: 'table',
        displayOrder: displayOrder ?? 0,
        title: row.question_title?.trim() ? row.question_title.trim() : null,
        textContent: null,
        imageUrl: row.image_url?.trim() ? row.image_url.trim() : null,
        cells: [],
        blanks: [],
      };
      byKey.set(importKey, question);
      seenPosByKey.set(importKey, new Set());
    }

    const rowIndex = parseIntStrict(row.row);
    const colIndex = parseIntStrict(row.col);
    if (
      rowIndex === null ||
      colIndex === null ||
      rowIndex < 0 ||
      colIndex < 0 ||
      rowIndex >= LIMITS.TABLE_MAX_ROWS ||
      colIndex >= LIMITS.TABLE_MAX_COLS
    ) {
      issues.push({ message: `${rowLabel}: row/col が不正です。`, blocking: true });
      return;
    }
    const cellType = row.cell_type?.trim() as CellType | undefined;
    if (!cellType || !CELL_TYPES.includes(cellType)) {
      issues.push({ message: `${rowLabel}: cell_type が不正です。`, blocking: true });
      return;
    }
    const posKey = `${rowIndex}:${colIndex}`;
    const seenPos = seenPosByKey.get(importKey);
    if (seenPos?.has(posKey)) {
      issues.push({
        message: `${rowLabel}: セル位置(${posKey})が重複しています。`,
        blocking: true,
      });
      return;
    }
    seenPos?.add(posKey);

    let blankOrder: number | null = null;
    if (cellType === 'blank') {
      blankOrder = parseIntStrict(row.is_blank);
      if (blankOrder === null || blankOrder < 1) {
        issues.push({
          message: `${rowLabel}: is_blank(空欄番号)が不正です。`,
          blocking: true,
        });
        return;
      }
    }

    question.cells?.push({
      rowIndex,
      colIndex,
      cellType,
      content: row.content?.trim() ? row.content : null,
      blankOrder,
    });
  });

  return byKey;
}

// ---- blanks.csv -----------------------------------------------
function parseBlanks(csvText: string | undefined, issues: CsvIssue[]): Map<string, ParsedBlank[]> {
  const byKey = new Map<string, ParsedBlank[]>();
  if (!csvText) return byKey;
  const records = parseRecords(csvText, 'blanks.csv');

  const seenOrderByKey = new Map<string, Set<number>>();

  records.forEach((row, index) => {
    const rowLabel = `blanks.csv 行${index + 2}`;
    const importKey = row.question_id?.trim();
    if (!importKey) {
      issues.push({ message: `${rowLabel}: question_id が空です。`, blocking: true });
      return;
    }
    const blankOrder = parseIntStrict(row.blank_order);
    if (blankOrder === null || blankOrder < 1) {
      issues.push({ message: `${rowLabel}: blank_order が不正です。`, blocking: true });
      return;
    }
    const seenOrders = seenOrderByKey.get(importKey) ?? new Set<number>();
    if (seenOrders.has(blankOrder)) {
      issues.push({
        message: `${rowLabel}: question_id「${importKey}」の空欄番号${blankOrder}が重複しています。`,
        blocking: true,
      });
      return;
    }
    seenOrders.add(blankOrder);
    seenOrderByKey.set(importKey, seenOrders);

    const rawAnswers = (row.accepted_answers ?? '')
      .split('|')
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    const answers = rawAnswers.filter((a) => a.length <= LIMITS.ANSWER_MAX_LEN);
    if (answers.length !== rawAnswers.length) {
      issues.push({
        message: `${rowLabel}: 正解の文字数上限(${LIMITS.ANSWER_MAX_LEN})を超える値を除外しました。`,
        blocking: true,
      });
    }
    if (answers.length === 0) {
      issues.push({ message: `${rowLabel}: accepted_answers が空です。`, blocking: true });
      return;
    }
    if (answers.length > LIMITS.ANSWERS_PER_BLANK) {
      issues.push({
        message: `${rowLabel}: 正解候補が上限(${LIMITS.ANSWERS_PER_BLANK})を超えています。`,
        blocking: true,
      });
      return;
    }

    const list = byKey.get(importKey) ?? [];
    list.push({
      blankOrder,
      acceptedAnswers: answers,
      hint: row.hint?.trim() ? row.hint : null,
    });
    byKey.set(importKey, list);
  });

  return byKey;
}

// text: setsEqual、table: quizzes.ts の POST .../questions と同じ「件数一致 +
// 各セルの空欄番号がblanks側に存在する」判定を再現する（§7.6.1 と同一検査）。
function checkBlankIntegrity(question: ParsedQuestion, issues: CsvIssue[]): void {
  const definedOrders = new Set(question.blanks.map((b) => b.blankOrder));

  if (question.type === 'text') {
    const markerSet = extractMarkerOrders(question.textContent ?? '');
    if (!setsEqual(markerSet, definedOrders)) {
      for (const order of markerSet) {
        if (!definedOrders.has(order)) {
          issues.push({
            message: `question_id「${question.importKey}」: 空欄[${order}]がblanks.csvに定義されていません。`,
            blocking: true,
          });
        }
      }
      for (const order of definedOrders) {
        if (!markerSet.has(order)) {
          issues.push({
            message: `question_id「${question.importKey}」: blanks.csvの空欄[${order}]は本文の[b:N]マーカーで使用されていません。`,
            blocking: true,
          });
        }
      }
    }
  } else {
    const blankCellOrders = (question.cells ?? [])
      .filter((c) => c.cellType === 'blank')
      .map((c) => c.blankOrder as number);
    const mismatch =
      blankCellOrders.length !== definedOrders.size ||
      blankCellOrders.some((order) => !definedOrders.has(order));
    if (mismatch) {
      const cellOrderSet = new Set(blankCellOrders);
      for (const order of cellOrderSet) {
        if (!definedOrders.has(order)) {
          issues.push({
            message: `question_id「${question.importKey}」: 空欄[${order}]がblanks.csvに定義されていません。`,
            blocking: true,
          });
        }
      }
      for (const order of definedOrders) {
        if (!cellOrderSet.has(order)) {
          issues.push({
            message: `question_id「${question.importKey}」: blanks.csvの空欄[${order}]は表のセルで使用されていません。`,
            blocking: true,
          });
        }
      }
      if (blankCellOrders.length !== cellOrderSet.size) {
        issues.push({
          message: `question_id「${question.importKey}」: 表の空欄セルの数と空欄設定の数が一致しません。`,
          blocking: true,
        });
      }
    }
  }
}

export interface CsvFiles {
  textCsv?: string;
  tableCsv?: string;
  blanksCsv?: string;
}

// 3ファイルをパースし、§7.6.1 と同じ整合性検査を行う。image_url のチーム所有
// チェックは DB が要るためここでは行わない（呼び出し側で追加の警告を積む）。
export function parseCsvFiles(files: CsvFiles): ParseCsvResult {
  const issues: CsvIssue[] = [];
  const seenImportKeys = new Set<string>();

  const textQuestions = parseTextQuestions(files.textCsv, issues, seenImportKeys);
  const tableQuestions = parseTableQuestions(files.tableCsv, issues, seenImportKeys);

  const blanksByKey = parseBlanks(files.blanksCsv, issues);

  const questions = [...textQuestions.values(), ...tableQuestions.values()];

  for (const [key, blanks] of blanksByKey) {
    const question = textQuestions.get(key) ?? tableQuestions.get(key);
    if (!question) {
      issues.push({
        message: `blanks.csv: question_id「${key}」に対応する問題が見つかりません(スキップしました)。`,
        blocking: false,
      });
      continue;
    }
    question.blanks = blanks;
  }

  for (const question of questions) {
    checkBlankIntegrity(question, issues);
  }

  return { questions, issues };
}

// ---- エクスポート -----------------------------------------------

// §10: セル先頭が = + - @ の場合 ' を前置（CSVインジェクション対策）
export function csvInjectionGuard(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeCsvCell(raw: string): string {
  const guarded = csvInjectionGuard(raw);
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function stringifyCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers, ...rows].map((cells) =>
    cells.map((cell) => escapeCsvCell(String(cell))).join(','),
  );
  return `${lines.join('\n')}\n`;
}
