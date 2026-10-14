import type { TeamProfile as TeamProfileData } from '@memorix/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { FollowButton } from '../components/FollowButton';
import { QueryState } from '../components/QueryState';
import { QuizGrid } from '../components/QuizGrid';
import { api } from '../lib/api';

export function TeamProfile() {
  const { id = '' } = useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['team-profile', id],
    queryFn: () => api.get<TeamProfileData>(`/teams/${id}/profile`),
  });

  if (isLoading || isError || !data) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError || !data}
        errorLabel="チームが見つかりませんでした。"
        onRetry={refetch}
        className="p-4"
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{data.team.name}</h1>
          {data.team.description && (
            <p className="mt-1 text-sm text-gray-600">{data.team.description}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">フォロワー {data.followerCount}人</p>
        </div>
        <FollowButton teamId={data.team.id} />
      </div>
      <h2 className="text-sm font-semibold text-gray-700">公開クイズ</h2>
      <QuizGrid quizzes={data.publicQuizzes} emptyMessage="公開中のクイズはまだありません。" />
    </div>
  );
}
