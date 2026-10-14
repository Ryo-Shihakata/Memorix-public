import type { Folder, QuizSetSummary } from '@memorix/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QueryState } from '../../components/QueryState';
import { StudioNav } from '../../components/studio/StudioNav';
import { useTeam } from '../../hooks/useStudio';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { buildQuery, type PageResult } from '../../lib/pageResult';

function useFolders(teamId: string) {
  return useQuery({
    queryKey: ['folders', teamId],
    queryFn: () =>
      api.get<PageResult<Folder>>(`/teams/${teamId}/folders${buildQuery({ per_page: 100 })}`),
  });
}

function CreateFolderForm({ teamId }: { teamId: string }) {
  const [name, setName] = useState('');
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.post<Folder>(`/teams/${teamId}/folders`, { name: name.trim() }),
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['folders', teamId] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-1.5">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="新しいフォルダ名"
        maxLength={120}
        className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={mutation.isPending || !name.trim()}
        className="shrink-0 rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        追加
      </button>
    </form>
  );
}

function FolderSidebar({
  teamId,
  activeFolderId,
  onSelect,
}: {
  teamId: string;
  activeFolderId: string | null;
  onSelect: (folderId: string | null) => void;
}) {
  const { data } = useFolders(teamId);
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const renameMutation = useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      api.patch(`/teams/${teamId}/folders/${folderId}`, { name }),
    onSuccess: () => {
      setRenaming(null);
      queryClient.invalidateQueries({ queryKey: ['folders', teamId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (folderId: string) => api.delete(`/teams/${teamId}/folders/${folderId}`),
    onSuccess: (_data, folderId) => {
      if (activeFolderId === folderId) onSelect(null);
      queryClient.invalidateQueries({ queryKey: ['folders', teamId] });
      queryClient.invalidateQueries({ queryKey: ['studio-quizzes', teamId] });
    },
  });

  const folders = data?.items ?? [];

  return (
    <aside className="w-full shrink-0 space-y-3 sm:w-48">
      <h2 className="text-sm font-semibold text-gray-700">フォルダ</h2>
      <nav className="space-y-1">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`block w-full rounded px-2 py-1.5 text-left text-sm ${
            activeFolderId === null
              ? 'bg-indigo-50 font-medium text-indigo-700'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          すべて
        </button>
        {folders.map((f) =>
          renaming === f.id ? (
            <form
              key={f.id}
              onSubmit={(e) => {
                e.preventDefault();
                if (renameValue.trim()) {
                  renameMutation.mutate({ folderId: f.id, name: renameValue.trim() });
                }
              }}
              className="flex gap-1"
            >
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => setRenaming(null)}
                className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 text-sm"
              />
            </form>
          ) : (
            <div key={f.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(f.id)}
                onDoubleClick={() => {
                  setRenaming(f.id);
                  setRenameValue(f.name);
                }}
                className={`block w-full flex-1 truncate rounded px-2 py-1.5 text-left text-sm ${
                  activeFolderId === f.id
                    ? 'bg-indigo-50 font-medium text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {f.name}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`フォルダ「${f.name}」を削除しますか？`)) {
                    deleteMutation.mutate(f.id);
                  }
                }}
                aria-label={`${f.name}を削除`}
                className="shrink-0 rounded px-1.5 text-xs text-gray-500 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ),
        )}
      </nav>
      <CreateFolderForm teamId={teamId} />
      <p className="text-xs text-gray-500">フォルダ名をダブルクリックでリネームできます。</p>
    </aside>
  );
}

function QuizListBody({
  teamId,
  folderId,
  q,
}: {
  teamId: string;
  folderId: string | null;
  q: string;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['studio-quizzes', teamId, folderId, q],
    queryFn: () =>
      api.get<PageResult<QuizSetSummary>>(
        `/teams/${teamId}/quiz-sets${buildQuery({ folder_id: folderId ?? undefined, q: q || undefined, per_page: 50 })}`,
      ),
  });

  if (isLoading || isError || !data)
    return <QueryState isLoading={isLoading} isError={isError || !data} onRetry={refetch} />;
  if (data.items.length === 0)
    return <p className="py-8 text-center text-sm text-gray-500">クイズがまだありません。</p>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {data.items.map((quiz) => (
        <Link
          key={quiz.id}
          to={`/studio/${teamId}/quizzes/${quiz.id}`}
          className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-white p-3 hover:border-indigo-300 hover:shadow"
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
          </div>
          <h3 className="line-clamp-2 font-semibold text-gray-900">{quiz.title}</h3>
          <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
            <span>問題数 {quiz.questionCount}</span>
            <span>プレイ {quiz.playCount}</span>
            <span>{formatDate(quiz.updatedAt)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function StudioQuizList() {
  const { teamId = '' } = useParams();
  const { data: team } = useTeam(teamId);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [q, setQ] = useState('');

  return (
    <div className="mx-auto max-w-4xl p-4">
      <StudioNav teamId={teamId} />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          {team ? (team.isPersonal ? 'マイスペース' : team.name) : ''}
        </h1>
        <Link
          to={`/studio/${teamId}/quizzes/new`}
          className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + 新規クイズ
        </Link>
      </div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="クイズを検索"
        className="mb-4 w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
      />
      <div className="flex flex-col gap-6 sm:flex-row">
        <FolderSidebar teamId={teamId} activeFolderId={folderId} onSelect={setFolderId} />
        <div className="min-w-0 flex-1">
          <QuizListBody teamId={teamId} folderId={folderId} q={q} />
        </div>
      </div>
    </div>
  );
}
