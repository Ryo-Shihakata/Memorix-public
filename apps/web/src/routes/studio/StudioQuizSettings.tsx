import type { Folder, QuizSetFull, QuizVisibility } from '@memorix/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QueryState } from '../../components/QueryState';
import { StudioNav } from '../../components/studio/StudioNav';
import { useSubjects } from '../../hooks/useDiscover';
import { api, errorMessage } from '../../lib/api';
import { buildQuery, type PageResult } from '../../lib/pageResult';

// /studio/:teamId/quizzes/new と /quizzes/:id を共通化する（§12 ルート表）。
// 新規作成はタイトルのみで即POSTし、以降は既存クイズの編集画面と同じUIへ遷移する。

function useFolders(teamId: string) {
  return useQuery({
    queryKey: ['folders', teamId],
    queryFn: () =>
      api.get<PageResult<Folder>>(`/teams/${teamId}/folders${buildQuery({ per_page: 100 })}`),
  });
}

function NewQuizForm({ teamId }: { teamId: string }) {
  const [title, setTitle] = useState('');
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: () => api.post<QuizSetFull>(`/teams/${teamId}/quiz-sets`, { title: title.trim() }),
    onSuccess: (quiz) => navigate(`/studio/${teamId}/quizzes/${quiz.id}`, { replace: true }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-md space-y-3 p-4">
      <h1 className="text-lg font-semibold text-gray-900">新規クイズ</h1>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="クイズタイトル"
        maxLength={120}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={mutation.isPending || !title.trim()}
        className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        作成して続ける
      </button>
      {mutation.isError && <p className="text-xs text-red-600">{errorMessage(mutation.error)}</p>}
    </form>
  );
}

function EditQuizForm({ teamId, quizId }: { teamId: string; quizId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const {
    data: quiz,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['studio-quiz', quizId],
    queryFn: () => api.get<QuizSetFull>(`/teams/${teamId}/quiz-sets/${quizId}`),
  });
  const { data: folders } = useFolders(teamId);
  const { data: subjects } = useSubjects();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [folderId, setFolderId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [normalizeKana, setNormalizeKana] = useState(false);
  const [visibilityPrompt, setVisibilityPrompt] = useState(false);

  useEffect(() => {
    if (!quiz) return;
    setTitle(quiz.title);
    setDescription(quiz.description ?? '');
    setFolderId(quiz.folderId ?? '');
    setSubjectId(quiz.subject?.id ?? '');
    setShuffle(quiz.shuffleQuestions);
    setNormalizeKana(quiz.normalizeKana);
  }, [quiz]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['studio-quiz', quizId] });
    queryClient.invalidateQueries({ queryKey: ['studio-quizzes', teamId] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch<QuizSetFull>(`/teams/${teamId}/quiz-sets/${quizId}`, {
        title: title.trim(),
        description: description.trim() || null,
        folderId: folderId || null,
        subjectId: subjectId || null,
        shuffleQuestions: shuffle,
        normalizeKana,
      }),
    onSuccess: invalidate,
  });

  const visibilityMutation = useMutation({
    mutationFn: (visibility: QuizVisibility) =>
      api.patch<QuizSetFull>(`/teams/${teamId}/quiz-sets/${quizId}/visibility`, { visibility }),
    onSuccess: invalidate,
  });

  const shareTokenMutation = useMutation({
    mutationFn: () =>
      api.post<{ shareUrl: string }>(`/teams/${teamId}/quiz-sets/${quizId}/share-token`),
    onSuccess: invalidate,
  });
  const revokeShareMutation = useMutation({
    mutationFn: () => api.delete(`/teams/${teamId}/quiz-sets/${quizId}/share-token`),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/teams/${teamId}/quiz-sets/${quizId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studio-quizzes', teamId] });
      navigate(`/studio/${teamId}`);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: () => api.post<QuizSetFull>(`/teams/${teamId}/quiz-sets/${quizId}/duplicate`),
    onSuccess: (copy) => {
      queryClient.invalidateQueries({ queryKey: ['studio-quizzes', teamId] });
      navigate(`/studio/${teamId}/quizzes/${copy.id}`);
    },
  });

  if (isLoading || isError || !quiz) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError || !quiz}
        errorLabel="クイズが見つかりませんでした。"
        onRetry={refetch}
        className="p-8"
      />
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    saveMutation.mutate();
  }

  function onChangeVisibility(next: QuizVisibility) {
    if (next === 'public' && !subjectId) {
      setVisibilityPrompt(true);
      return;
    }
    setVisibilityPrompt(false);
    visibilityMutation.mutate(next);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/studio/${teamId}/quizzes/${quizId}/questions`}
          className="rounded-full bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          問題を編集
        </Link>
        <Link
          to={`/studio/${teamId}/quizzes/${quizId}/import`}
          className="rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:border-indigo-400"
        >
          CSVインポート
        </Link>
        <Link
          to={`/studio/${teamId}/quizzes/${quizId}/stats`}
          className="rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:border-indigo-400"
        >
          統計
        </Link>
        <a
          href={`/api/teams/${teamId}/quiz-sets/${quizId}/export`}
          className="rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:border-indigo-400"
        >
          CSVエクスポート
        </a>
        <button
          type="button"
          onClick={() => duplicateMutation.mutate()}
          disabled={duplicateMutation.isPending}
          className="rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:border-indigo-400"
        >
          複製
        </button>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <h1 className="text-lg font-semibold text-gray-900">クイズ設定</h1>
        <div>
          <label htmlFor="quiz-title" className="mb-1 block text-xs font-medium text-gray-500">
            タイトル
          </label>
          <input
            id="quiz-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="quiz-desc" className="mb-1 block text-xs font-medium text-gray-500">
            説明
          </label>
          <textarea
            id="quiz-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="quiz-folder" className="mb-1 block text-xs font-medium text-gray-500">
              フォルダ
            </label>
            <select
              id="quiz-folder"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">未分類</option>
              {(folders?.items ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="quiz-subject" className="mb-1 block text-xs font-medium text-gray-500">
              科目
            </label>
            <select
              id="quiz-subject"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">未選択</option>
              {(subjects ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={shuffle}
              onChange={(e) => setShuffle(e.target.checked)}
            />
            出題順をシャッフル
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={normalizeKana}
              onChange={(e) => setNormalizeKana(e.target.checked)}
            />
            かな同一視（ひらがな/カタカナ）
          </label>
        </div>
        <button
          type="submit"
          disabled={saveMutation.isPending || !title.trim()}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          保存
        </button>
        {saveMutation.isError && (
          <p className="text-xs text-red-600">{errorMessage(saveMutation.error)}</p>
        )}
        {saveMutation.isSuccess && <p className="text-xs text-green-600">保存しました。</p>}
      </form>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">公開設定</h2>
        <div className="flex gap-2">
          {(['private', 'unlisted', 'public'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChangeVisibility(v)}
              disabled={visibilityMutation.isPending}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                quiz.visibility === v
                  ? 'bg-indigo-600 text-white'
                  : 'border border-gray-300 text-gray-600 hover:border-indigo-400'
              }`}
            >
              {v === 'private' ? '非公開' : v === 'unlisted' ? '限定公開' : '公開'}
            </button>
          ))}
        </div>
        {visibilityPrompt && (
          <p className="text-xs text-amber-600">
            公開するには先に「科目」を選択して保存してください。
          </p>
        )}
        {visibilityMutation.isError && (
          <p className="text-xs text-red-600">{errorMessage(visibilityMutation.error)}</p>
        )}

        {quiz.visibility === 'unlisted' && (
          <div className="space-y-1">
            {quiz.shareUrl ? (
              <div className="flex items-center gap-2 text-sm">
                <input
                  readOnly
                  value={quiz.shareUrl}
                  className="min-w-0 flex-1 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => revokeShareMutation.mutate()}
                  className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:border-red-300 hover:text-red-600"
                >
                  失効
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => shareTokenMutation.mutate()}
                disabled={shareTokenMutation.isPending}
                className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:border-indigo-400"
              >
                共有URLを発行
              </button>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <h2 className="mb-2 text-sm font-semibold text-red-700">削除</h2>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`クイズ「${quiz.title}」を削除しますか？元に戻せません。`)) {
              deleteMutation.mutate();
            }
          }}
          disabled={deleteMutation.isPending}
          className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-100"
        >
          このクイズを削除
        </button>
      </div>
    </div>
  );
}

export function StudioQuizSettings() {
  const { teamId = '', quizId } = useParams();
  return (
    <div className="mx-auto max-w-2xl p-4">
      <StudioNav teamId={teamId} />
      {quizId ? <EditQuizForm teamId={teamId} quizId={quizId} /> : <NewQuizForm teamId={teamId} />}
    </div>
  );
}
