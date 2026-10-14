import type { PlayPayload, QuestionDetail } from '@memorix/shared';

// §12.2 共通: プレビューは受験画面コンポーネント(PlayQuestionView)を再利用する。
// Studio 側の QuestionDetail(正解込み)を PlayPayload の質問形状(正解を含まない)へ
// 変換するだけで、コンポーネントを変更せずに使い回せる。
export function toPreviewQuestion(question: QuestionDetail): PlayPayload['questions'][number] {
  return {
    id: question.id,
    type: question.type,
    title: question.title,
    textContent: question.textContent,
    image: question.imageId
      ? {
          url: `/img/${question.imageId}`,
          position: question.imagePosition,
          caption: question.imageCaption,
        }
      : null,
    cells: question.cells
      ? question.cells.map((cell) => ({
          rowIndex: cell.rowIndex,
          colIndex: cell.colIndex,
          cellType: cell.cellType,
          content: cell.content,
          imageUrl: cell.imageId ? `/img/${cell.imageId}` : null,
          blankId:
            cell.cellType === 'blank'
              ? (question.blanks.find((b) => b.blankOrder === cell.blankOrder)?.id ?? null)
              : null,
        }))
      : null,
    blanks: question.blanks.map((b) => ({
      id: b.id,
      blankOrder: b.blankOrder,
      hint: b.hint,
      hintImageUrl: b.hintImageId ? `/img/${b.hintImageId}` : null,
    })),
  };
}
