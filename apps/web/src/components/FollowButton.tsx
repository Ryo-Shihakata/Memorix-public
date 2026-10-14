import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../hooks/useMe';
import { api, isUnauthorized } from '../lib/api';

// クイズと同様、現在フォロー中かを返す軽量APIが無いため楽観的表示のみ。
export function FollowButton({ teamId }: { teamId: string }) {
  const { data: me, error: meError } = useMe();
  const [following, setFollowing] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      following ? api.delete(`/teams/${teamId}/follow`) : api.put(`/teams/${teamId}/follow`, {}),
    onSuccess: () => setFollowing((v) => !v),
  });

  if (!me || isUnauthorized(meError)) {
    return (
      <Link
        to="/login"
        className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        フォロー
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
        following
          ? 'border border-indigo-500 bg-indigo-50 text-indigo-700'
          : 'bg-indigo-600 text-white hover:bg-indigo-700'
      }`}
    >
      {following ? 'フォロー中' : 'フォローする'}
    </button>
  );
}
