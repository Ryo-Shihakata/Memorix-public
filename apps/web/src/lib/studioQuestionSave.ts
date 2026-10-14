import type { CellType, ImagePosition, QuestionDetail, QuizSetFull } from '@memorix/shared';
import { api } from './api';

// §7.6.1 の Question 入力スキーマ相当（フロント編集中の中間表現）。
export interface EditableBlank {
  blankOrder: number;
  acceptedAnswers: string[];
  hint: string;
  hintImageId: string | null;
}

export interface EditableCell {
  rowIndex: number;
  colIndex: number;
  cellType: CellType;
  content: string;
  imageId: string | null;
  blankOrder: number | null;
}

export interface EditableQuestion {
  type: 'text' | 'table';
  title: string;
  textContent: string;
  imageId: string | null;
  imagePosition: ImagePosition;
  imageCaption: string;
  blanks: EditableBlank[];
  cells: EditableCell[];
}

export function detailToEditable(q: QuestionDetail): EditableQuestion {
  return {
    type: q.type,
    title: q.title ?? '',
    textContent: q.textContent ?? '',
    imageId: q.imageId,
    imagePosition: q.imagePosition,
    imageCaption: q.imageCaption ?? '',
    blanks: q.blanks.map((b) => ({
      blankOrder: b.blankOrder,
      acceptedAnswers: b.acceptedAnswers,
      hint: b.hint ?? '',
      hintImageId: b.hintImageId,
    })),
    cells: (q.cells ?? []).map((c) => ({
      rowIndex: c.rowIndex,
      colIndex: c.colIndex,
      cellType: c.cellType,
      content: c.content ?? '',
      imageId: c.imageId,
      blankOrder: c.blankOrder,
    })),
  };
}

export function emptyEditable(type: 'text' | 'table'): EditableQuestion {
  const initialCells: EditableCell[] =
    type === 'table'
      ? Array.from({ length: 3 }, (_, r) =>
          Array.from({ length: 3 }, (_, c) => ({
            rowIndex: r,
            colIndex: c,
            cellType: 'text' as const,
            content: '',
            imageId: null,
            blankOrder: null,
          })),
        ).flat()
      : [];
  return {
    type,
    title: '',
    textContent: '',
    imageId: null,
    imagePosition: 'above',
    imageCaption: '',
    blanks: [],
    cells: initialCells,
  };
}

function buildCreateBody(q: EditableQuestion) {
  return {
    type: q.type,
    title: q.title.trim() || undefined,
    textContent: q.type === 'text' ? q.textContent : undefined,
    imageId: q.imageId ?? undefined,
    imagePosition: q.imageId ? q.imagePosition : undefined,
    imageCaption: q.imageId ? q.imageCaption.trim() || undefined : undefined,
    blanks: q.blanks.map((b) => ({
      blankOrder: b.blankOrder,
      acceptedAnswers: b.acceptedAnswers,
      hint: b.hint.trim() || undefined,
      hintImageId: b.hintImageId ?? undefined,
    })),
    cells:
      q.type === 'table'
        ? q.cells.map((c) => ({
            rowIndex: c.rowIndex,
            colIndex: c.colIndex,
            cellType: c.cellType,
            content: c.cellType === 'blank' ? undefined : c.content || undefined,
            imageId: c.cellType === 'image' ? (c.imageId ?? undefined) : undefined,
            blankOrder: c.cellType === 'blank' ? (c.blankOrder ?? undefined) : undefined,
          }))
        : undefined,
  };
}

function buildBlanksBody(blanks: EditableBlank[]) {
  return blanks.map((b) => ({
    blankOrder: b.blankOrder,
    acceptedAnswers: b.acceptedAnswers,
    hint: b.hint.trim() || undefined,
    hintImageId: b.hintImageId ?? undefined,
  }));
}

function buildCellsBody(cells: EditableCell[]) {
  return cells.map((c) => ({
    rowIndex: c.rowIndex,
    colIndex: c.colIndex,
    cellType: c.cellType,
    content: c.cellType === 'blank' ? undefined : c.content || undefined,
    imageId: c.cellType === 'image' ? (c.imageId ?? undefined) : undefined,
    blankOrder: c.cellType === 'blank' ? (c.blankOrder ?? undefined) : undefined,
  }));
}

// v1.1改訂(2026-07-20): PUT .../questions/:id/blanks は textContent 同梱可、
// PUT .../questions/:id/cells は blanks 同梱可（同一 D1 batch での原子的更新、
// apps/worker/src/routes/teams/questions.ts）。空欄集合(blankOrder)の追加・削除を
// 伴う編集も1リクエストで表現できるようになったため、以前使っていた
// DELETE→POST(質問の再作成)による回避策は不要になった。これにより、空欄集合が
// 変化する編集でも質問に紐づく受験回答統計(user_answers)が失われなくなった。
export async function saveQuestion(
  teamId: string,
  quizSetId: string,
  existing: QuestionDetail | null,
  next: EditableQuestion,
): Promise<{ question: QuestionDetail; recreated: boolean }> {
  if (!existing) {
    const created = await api.post<QuestionDetail>(
      `/teams/${teamId}/quiz-sets/${quizSetId}/questions`,
      buildCreateBody(next),
    );
    return { question: created, recreated: false };
  }

  await api.patch<QuestionDetail>(`/teams/${teamId}/questions/${existing.id}`, {
    title: next.title.trim() || null,
    imageId: next.imageId,
    imagePosition: next.imageId ? next.imagePosition : undefined,
    imageCaption: next.imageId ? next.imageCaption.trim() || null : null,
  });

  if (next.type === 'table') {
    await api.put(`/teams/${teamId}/questions/${existing.id}/cells`, {
      cells: buildCellsBody(next.cells),
      blanks: buildBlanksBody(next.blanks),
    });
  } else {
    await api.put(`/teams/${teamId}/questions/${existing.id}/blanks`, {
      textContent: next.textContent,
      blanks: buildBlanksBody(next.blanks),
    });
  }

  const full = await api.get<QuizSetFull>(`/teams/${teamId}/quiz-sets/${quizSetId}`);
  const question = full.questions.find((q) => q.id === existing.id);
  if (!question) throw new Error('保存直後の問題が見つかりません。');
  return { question, recreated: false };
}
