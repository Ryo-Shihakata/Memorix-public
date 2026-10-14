import type { QuizSetSummary } from '@memorix/shared';
import { QuizCard } from './QuizCard';

export function QuizGrid({
  quizzes,
  emptyMessage = '該当するクイズが見つかりませんでした。',
}: {
  quizzes: QuizSetSummary[];
  emptyMessage?: string;
}) {
  if (quizzes.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">{emptyMessage}</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {quizzes.map((q) => (
        <QuizCard key={q.id} quiz={q} />
      ))}
    </div>
  );
}
