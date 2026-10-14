import type { QuestionDetail } from '@memorix/shared';
import { useState } from 'react';
import { toPreviewQuestion } from '../../lib/previewAdapter';
import { PlayQuestionView } from '../PlayQuestionView';

// §12.2 共通: 受験画面コンポーネントを再利用したプレビュー（採点なし・入力はローカルのみ）。
export function QuestionPreview({ question }: { question: QuestionDetail }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const previewQuestion = toPreviewQuestion(question);

  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50 p-3">
      <p className="mb-2 text-xs font-semibold text-gray-500">プレビュー（採点はされません）</p>
      <PlayQuestionView
        question={previewQuestion}
        index={0}
        answers={answers}
        onFocusBlank={() => undefined}
        onChangeBlank={(blankId, value) => setAnswers((prev) => ({ ...prev, [blankId]: value }))}
      />
    </div>
  );
}
