import type { BookmarkFolder, QuizSetSummary } from '@memorix/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { QueryState } from '../components/QueryState';
import { api, errorMessage } from '../lib/api';
import { loadKnownFolders, removeKnownFolder, upsertKnownFolder } from '../lib/bookmarkFolders';
import { formatDate } from '../lib/format';
import { buildQuery, type PageResult } from '../lib/pageResult';

// NOTE(既知のAPIギャップ): lib/bookmarkFolders.ts の説明のとおり、フォルダ一覧を返す GET が無いため
// このブラウザで作成済みのフォルダのみをサイドバーに表示する（apps/worker は変更範囲外）。
// 「移動」は D&D ではなく、各カードのフォルダ選択メニューで PUT /quiz-sets/:id/bookmark を再送する形にした
// （既存ブックマークへの再 PUT は folder_id を上書きする仕様: apps/worker/src/routes/social.ts:171）。

function CreateFolderForm({ onCreated }: { onCreated: (folder: BookmarkFolder) => void }) {
  const [name, setName] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.post<BookmarkFolder>('/me/bookmark-folders', { name: name.trim() }),
    onSuccess: (folder) => {
      onCreated(folder);
      setName('');
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
      {mutation.isError && <p className="text-xs text-red-600">{errorMessage(mutation.error)}</p>}
    </form>
  );
}

function FolderSidebar({
  folders,
  activeFolderId,
  onSelect,
  onCreated,
  onDeleted,
}: {
  folders: BookmarkFolder[];
  activeFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  onCreated: (folder: BookmarkFolder) => void;
  onDeleted: (folderId: string) => void;
}) {
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (folderId: string) => api.delete(`/me/bookmark-folders/${folderId}`),
    onSuccess: (_data, folderId) => {
      onDeleted(folderId);
      if (activeFolderId === folderId) onSelect(null);
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });

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
        {folders.map((f) => (
          <div key={f.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSelect(f.id)}
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
                if (
                  window.confirm(
                    `フォルダ「${f.name}」を削除しますか？（中のブックマークは「すべて」に残ります）`,
                  )
                ) {
                  deleteMutation.mutate(f.id);
                }
              }}
              aria-label={`${f.name}を削除`}
              className="shrink-0 rounded px-1.5 text-xs text-gray-500 hover:text-red-600"
            >
              ×
            </button>
          </div>
        ))}
      </nav>
      <CreateFolderForm onCreated={onCreated} />
    </aside>
  );
}

function MoveFolderMenu({
  quizSetId,
  folders,
  onMoved,
}: {
  quizSetId: string;
  folders: BookmarkFolder[];
  onMoved: () => void;
}) {
  const mutation = useMutation({
    mutationFn: (folderId: string | null) =>
      api.put(`/quiz-sets/${quizSetId}/bookmark`, { folderId }),
    onSuccess: onMoved,
  });

  return (
    <select
      value=""
      onChange={(e) => {
        const value = e.target.value;
        mutation.mutate(value === '__none__' ? null : value);
      }}
      disabled={mutation.isPending}
      className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-600"
      aria-label="フォルダに移動"
    >
      <option value="" disabled>
        フォルダへ移動…
      </option>
      <option value="__none__">未分類にする</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

function BookmarkList({
  folderId,
  folders,
}: {
  folderId: string | null;
  folders: BookmarkFolder[];
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['bookmarks', folderId],
    queryFn: () =>
      api.get<PageResult<QuizSetSummary>>(
        `/me/bookmarks${buildQuery({ folder_id: folderId ?? undefined })}`,
      ),
  });

  const removeMutation = useMutation({
    mutationFn: (quizSetId: string) => api.delete(`/quiz-sets/${quizSetId}/bookmark`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookmarks'] }),
  });

  if (isLoading || isError || !data) {
    return <QueryState isLoading={isLoading} isError={isError || !data} onRetry={refetch} />;
  }
  if (data.items.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">ブックマークはまだありません。</p>;
  }

  return (
    <div className="space-y-3">
      {data.items.map((quiz) => (
        <div
          key={quiz.id}
          className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
        >
          <Link to={`/quiz/${quiz.id}`} className="min-w-0 flex-1">
            <p className="truncate font-semibold text-gray-900">{quiz.title}</p>
            <p className="truncate text-xs text-gray-500">
              {quiz.teamName} ・ {formatDate(quiz.updatedAt)}
            </p>
          </Link>
          <MoveFolderMenu
            quizSetId={quiz.id}
            folders={folders}
            onMoved={() => queryClient.invalidateQueries({ queryKey: ['bookmarks'] })}
          />
          <button
            type="button"
            onClick={() => removeMutation.mutate(quiz.id)}
            disabled={removeMutation.isPending}
            className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:border-red-300 hover:text-red-600"
          >
            解除
          </button>
        </div>
      ))}
    </div>
  );
}

export function Bookmarks() {
  const [folders, setFolders] = useState<BookmarkFolder[]>(() => loadKnownFolders());
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:flex-row">
      <FolderSidebar
        folders={folders}
        activeFolderId={activeFolderId}
        onSelect={setActiveFolderId}
        onCreated={(folder) => setFolders(upsertKnownFolder(folder))}
        onDeleted={(folderId) => setFolders(removeKnownFolder(folderId))}
      />
      <div className="min-w-0 flex-1 space-y-3">
        <h1 className="text-lg font-semibold text-gray-900">ブックマーク</h1>
        <BookmarkList folderId={activeFolderId} folders={folders} />
      </div>
    </div>
  );
}
