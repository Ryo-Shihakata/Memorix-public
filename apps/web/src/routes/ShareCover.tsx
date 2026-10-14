import type { QuizSetSummary } from '@memorix/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { QueryState } from '../components/QueryState';
import { QuizCoverContent } from '../components/QuizCoverContent';
import { useCreateSession } from '../hooks/useCreateSession';
import { api } from '../lib/api';

export function ShareCover() {
  const { token = '' } = useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['share', token],
    queryFn: () => api.get<QuizSetSummary>(`/share/${token}`),
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
      onStart={() => startSession.mutate({ shareToken: token })}
      starting={startSession.isPending}
      startError={startSession.error}
    />
  );
}
