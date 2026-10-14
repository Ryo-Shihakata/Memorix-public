import type { Team } from '@memorix/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QueryState } from '../../components/QueryState';
import { useMe } from '../../hooks/useMe';
import { api, errorMessage } from '../../lib/api';

// /studio: チーム切替。個人チームは「マイスペース」表示（§12 ルート表）。
function CreateTeamForm() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      api.post<Team>('/teams', { name: name.trim(), description: description.trim() || undefined }),
    onSuccess: (team) => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(`/studio/${team.id}`);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-2 rounded-lg border border-dashed border-gray-300 p-4"
    >
      <h2 className="text-sm font-semibold text-gray-700">新しいチームを作成</h2>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="チーム名"
        maxLength={120}
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="説明（任意）"
        maxLength={2000}
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={mutation.isPending || !name.trim()}
        className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        作成
      </button>
      {mutation.isError && <p className="text-xs text-red-600">{errorMessage(mutation.error)}</p>}
    </form>
  );
}

export function StudioTeams() {
  const { data, isLoading, isError, refetch } = useMe();

  if (isLoading || isError || !data) {
    return <QueryState isLoading={isLoading} isError={isError || !data} onRetry={refetch} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-lg font-semibold text-gray-900">Studio</h1>
      <div className="space-y-2">
        {data.teams.map((team) => (
          <Link
            key={team.id}
            to={`/studio/${team.id}`}
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 hover:border-indigo-300 hover:shadow"
          >
            <span className="font-medium text-gray-900">
              {team.isPersonal ? 'マイスペース' : team.name}
            </span>
            <span className="text-xs text-gray-500">{team.role}</span>
          </Link>
        ))}
      </div>
      <CreateTeamForm />
    </div>
  );
}
