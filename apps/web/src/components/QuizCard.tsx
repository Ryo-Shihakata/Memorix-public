import type { QuizSetSummary } from '@memorix/shared';
import { Link } from 'react-router-dom';
import { formatDate } from '../lib/format';

export function QuizCard({ quiz }: { quiz: QuizSetSummary }) {
  return (
    <Link
      to={`/quiz/${quiz.id}`}
      className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition hover:border-indigo-300 hover:shadow"
    >
      <div className="flex items-center gap-1.5">
        {quiz.subject && (
          <span
            className="rounded px-1.5 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: quiz.subject.color ?? '#6366f1' }}
          >
            {quiz.subject.name}
          </span>
        )}
        <span className="truncate text-xs text-gray-500">{quiz.teamName}</span>
      </div>
      <h3 className="line-clamp-2 font-semibold text-gray-900">{quiz.title}</h3>
      {quiz.description && <p className="line-clamp-2 text-sm text-gray-500">{quiz.description}</p>}
      <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
        <span>問題数 {quiz.questionCount}</span>
        <span>プレイ {quiz.playCount}</span>
        <span>{formatDate(quiz.updatedAt)}</span>
      </div>
    </Link>
  );
}
