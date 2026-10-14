import type { Team } from '@memorix/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QueryState } from '../../components/QueryState';
import { StudioNav } from '../../components/studio/StudioNav';
import { useMyTeamRole, useTeam } from '../../hooks/useStudio';
import { api, errorMessage } from '../../lib/api';

// /studio/:teamId/settings: チーム設定（名前・説明・削除。個人チームは削除不可表示）§12 ルート表。
export function StudioSettings() {
  const { teamId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const role = useMyTeamRole(teamId);
  const isOwner = role === 'owner';
  const { data: team, isLoading, isError, refetch } = useTeam(teamId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!team) return;
    setName(team.name);
    setDescription(team.description ?? '');
  }, [team]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch<Team>(`/teams/${teamId}`, {
        name: name.trim(),
        description: description.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', teamId] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/teams/${teamId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/studio');
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    saveMutation.mutate();
  }

  if (isLoading || isError || !team) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError || !team}
        errorLabel="チームが見つかりませんでした。"
        onRetry={refetch}
        className="p-8"
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <StudioNav teamId={teamId} />
      <h1 className="mb-4 text-lg font-semibold text-gray-900">チーム設定</h1>

      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <div>
          <label htmlFor="team-name" className="mb-1 block text-xs font-medium text-gray-500">
            チーム名
          </label>
          <input
            id="team-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
            maxLength={120}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-100"
          />
        </div>
        <div>
          <label htmlFor="team-desc" className="mb-1 block text-xs font-medium text-gray-500">
            説明
          </label>
          <textarea
            id="team-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!isOwner}
            rows={3}
            maxLength={2000}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-100"
          />
        </div>
        {isOwner && (
          <button
            type="submit"
            disabled={saveMutation.isPending || !name.trim()}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            保存
          </button>
        )}
        {saveMutation.isError && (
          <p className="text-xs text-red-600">{errorMessage(saveMutation.error)}</p>
        )}
        {saveMutation.isSuccess && <p className="text-xs text-green-600">保存しました。</p>}
      </form>

      <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
        <h2 className="mb-2 text-sm font-semibold text-red-700">削除</h2>
        {team.isPersonal ? (
          <p className="text-sm text-gray-500">個人チーム（マイスペース）は削除できません。</p>
        ) : isOwner ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`チーム「${team.name}」を削除しますか？元に戻せません。`)) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-100"
          >
            このチームを削除
          </button>
        ) : (
          <p className="text-sm text-gray-500">削除はオーナーのみ操作できます。</p>
        )}
        {deleteMutation.isError && (
          <p className="mt-2 text-xs text-red-600">{errorMessage(deleteMutation.error)}</p>
        )}
      </div>
    </div>
  );
}
