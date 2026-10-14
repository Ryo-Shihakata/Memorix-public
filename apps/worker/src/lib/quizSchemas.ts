import { LIMITS } from '@memorix/shared';
import { z } from 'zod';

// §7.6.1 Question 入力スキーマの部品。questions.ts (PUT blanks/cells) と
// quizzes.ts (POST questions) の両方から使う。

export const blankInputSchema = z.object({
  blankOrder: z.number().int().min(1),
  acceptedAnswers: z
    .array(z.string().trim().min(1).max(LIMITS.ANSWER_MAX_LEN))
    .min(1)
    .max(LIMITS.ANSWERS_PER_BLANK),
  // ヒント文字列長は仕様書に明記が無いため、判断として ANSWER_MAX_LEN の2倍程度の 500 を採用
  hint: z.string().max(500).optional(),
  hintImageId: z.string().length(32).optional(),
});

export const cellInputSchema = z.object({
  rowIndex: z
    .number()
    .int()
    .min(0)
    .max(LIMITS.TABLE_MAX_ROWS - 1),
  colIndex: z
    .number()
    .int()
    .min(0)
    .max(LIMITS.TABLE_MAX_COLS - 1),
  cellType: z.enum(['text', 'header', 'blank', 'image']),
  // セル内容の長さも仕様書に明記が無いため、判断として ANSWER_MAX_LEN を流用
  content: z.string().max(LIMITS.ANSWER_MAX_LEN).optional(),
  imageId: z.string().length(32).optional(),
  blankOrder: z.number().int().min(1).optional(),
});

export const questionBlanksArraySchema = z.array(blankInputSchema).max(LIMITS.BLANKS_PER_QUESTION);
export const questionCellsArraySchema = z
  .array(cellInputSchema)
  .max(LIMITS.TABLE_MAX_ROWS * LIMITS.TABLE_MAX_COLS);

// PUT .../questions/:id/blanks の body（v1.1改訂）: 素の配列（従来どおり、保存済み
// text_content と検証）、または {blanks, textContent?}（textContent 同梱時はそれと
// 検証し、同一 batch で本文も更新する。原子的更新のため、空欄集合の変更を1リクエストで
// 表現できる）。
export const putBlanksBodySchema = z.union([
  questionBlanksArraySchema,
  z.object({
    blanks: questionBlanksArraySchema,
    textContent: z.string().max(LIMITS.TEXT_CONTENT_MAX_LEN).optional(),
  }),
]);

// PUT .../questions/:id/cells の body（v1.1改訂）: 素の配列（従来どおり、後方互換）、
// または {cells, blanks?}（blanks 同梱時はそれと検証し、cells と同一 batch で
// blanks も全置換する）。
export const putCellsBodySchema = z.union([
  questionCellsArraySchema,
  z.object({
    cells: questionCellsArraySchema,
    blanks: questionBlanksArraySchema.optional(),
  }),
]);

export const createQuestionSchema = z.object({
  type: z.enum(['text', 'table']),
  title: z.string().max(LIMITS.TITLE_MAX_LEN).optional(),
  textContent: z.string().max(LIMITS.TEXT_CONTENT_MAX_LEN).optional(),
  imageId: z.string().length(32).optional(),
  imagePosition: z.enum(['above', 'below']).optional(),
  imageCaption: z.string().max(LIMITS.TITLE_MAX_LEN).optional(),
  blanks: questionBlanksArraySchema,
  cells: questionCellsArraySchema.optional(),
});

export const patchQuestionSchema = z.object({
  title: z.string().max(LIMITS.TITLE_MAX_LEN).nullable().optional(),
  textContent: z.string().max(LIMITS.TEXT_CONTENT_MAX_LEN).optional(),
  imageId: z.string().length(32).nullable().optional(),
  imagePosition: z.enum(['above', 'below']).optional(),
  imageCaption: z.string().max(LIMITS.TITLE_MAX_LEN).nullable().optional(),
});

export const createQuizSetSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.TITLE_MAX_LEN),
  description: z.string().max(LIMITS.DESCRIPTION_MAX_LEN).optional(),
  folderId: z.string().length(32).optional(),
  subjectId: z.string().length(32).optional(),
});

export const patchQuizSetSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.TITLE_MAX_LEN).optional(),
  description: z.string().max(LIMITS.DESCRIPTION_MAX_LEN).nullable().optional(),
  folderId: z.string().length(32).nullable().optional(),
  subjectId: z.string().length(32).nullable().optional(),
  shuffleQuestions: z.boolean().optional(),
  normalizeKana: z.boolean().optional(),
  timeLimitSecs: z.number().int().min(1).nullable().optional(),
});

export const visibilitySchema = z.object({
  visibility: z.enum(['public', 'unlisted', 'private']),
});

export const reorderQuestionsSchema = z.object({
  orderedIds: z.array(z.string().length(32)).min(1),
});
