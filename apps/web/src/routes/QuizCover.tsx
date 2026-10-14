import type { QuizSetSummary } from '@memorix/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { QueryState } from '../components/QueryState';
import { QuizCoverContent } from '../components/QuizCoverContent';
import { useCreateSession } from '../hooks/useCreateSession';
import { api } from '../lib/api';

export function QuizCover() {
  const { id = '' } = useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['quiz-set', id],
    queryFn: () => api.get<QuizSetSummary>(`/quiz-sets/${id}`),
  });
  const startSession = useCreateSession();

  if (isLoading || isError || !data) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError || !data}
        errorLabel="クイズが見つかりませんでした。"
        onRetry={refetch}
        className="p-4"
      />
    );
  }

  return (
    <QuizCoverContent
      quiz={data}
      onStart={() => startSession.mutate({ quizSetId: id })}
      starting={startSession.isPending}
      startError={startSession.error}
    />
  );
}
