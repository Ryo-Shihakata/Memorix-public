import type { QuizSetSummary } from '@memorix/shared';
import { useState } from 'react';
import { errorMessage } from '../lib/api';
import { BookmarkButton } from './BookmarkButton';
import { ReportModal } from './ReportModal';

export function QuizCoverContent({
  quiz,
  onStart,
  starting,
  startError,
}: {
  quiz: QuizSetSummary;
  onStart: () => void;
  starting: boolean;
  startError: unknown;
}) {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        {quiz.subject && (
          <span
            className="inline-block rounded px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: quiz.subject.color ?? '#6366f1' }}
          >
            {quiz.subject.name}
          </span>
        )}
        <h1 className="text-xl font-bold text-gray-900">{quiz.title}</h1>
        <p className="text-sm text-gray-500">{quiz.teamName}</p>
        {quiz.description && <p className="text-sm text-gray-700">{quiz.description}</p>}
        <p className="text-xs text-gray-500">
          問題数 {quiz.questionCount} ・ プレイ数 {quiz.playCount}
        </p>

        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          className="mt-2 w-full rounded-full bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {starting ? '準備中…' : 'はじめる'}
        </button>
        {startError !== undefined && startError !== null && (
          <p className="text-sm text-red-600">{errorMessage(startError)}</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <BookmarkButton quizSetId={quiz.id} />
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-500 hover:border-red-300 hover:text-red-600"
          >
            通報する
          </button>
        </div>
      </div>

      {reportOpen && <ReportModal quizSetId={quiz.id} onClose={() => setReportOpen(false)} />}
    </div>
  );
}
