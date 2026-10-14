import type { QuestionDetail } from '@memorix/shared';
import { useState } from 'react';
import { errorMessage } from '../../lib/api';
import {
  detailToEditable,
  type EditableQuestion,
  emptyEditable,
  saveQuestion,
} from '../../lib/studioQuestionSave';
import { QuestionPreview } from './QuestionPreview';
import { TableQuestionEditor } from './TableQuestionEditor';
import { TextQuestionEditor } from './TextQuestionEditor';

export function QuestionEditorPanel({
  teamId,
  quizSetId,
  existing,
  newType,
  onSaved,
  onCancel,
}: {
  teamId: string;
  quizSetId: string;
  existing: QuestionDetail | null;
  newType: 'text' | 'table';
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState<EditableQuestion>(() =>
    existing ? detailToEditable(existing) : emptyEditable(newType),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const hasEmptyAnswers = question.blanks.some((b) => b.acceptedAnswers.length === 0);

  async function onSave() {
    setError(null);
    if (question.type === 'text' && !question.textContent.trim()) {
      setError('本文を入力してください。');
      return;
    }
    if (hasEmptyAnswers) {
      setError('すべての空欄に正解候補を1つ以上入力してください。');
      return;
    }
    setSaving(true);
    try {
      await saveQuestion(teamId, quizSetId, existing, question);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-white p-4">
      <div>
        <label htmlFor="question-title" className="mb-1 block text-xs font-medium text-gray-500">
          問題タイトル（任意）
        </label>
        <input
          id="question-title"
          type="text"
          value={question.title}
          onChange={(e) => setQuestion({ ...question, title: e.target.value })}
          maxLength={120}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {question.type === 'text' ? (
        <TextQuestionEditor teamId={teamId} question={question} onChange={setQuestion} />
      ) : (
        <TableQuestionEditor teamId={teamId} question={question} onChange={setQuestion} />
      )}

      {existing && (
        <div>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-indigo-400"
          >
            {showPreview ? 'プレビューを閉じる' : 'プレビュー'}
          </button>
          {showPreview && (
            <div className="mt-2">
              <QuestionPreview question={existing} />
              <p className="mt-1 text-xs text-amber-600">
                ※
                プレビューは直前に保存した内容を表示します。編集中の内容を見るには一度保存してください。
              </p>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:border-gray-400"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
