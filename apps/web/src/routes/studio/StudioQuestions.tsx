import type { QuizSetFull } from '@memorix/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QueryState } from '../../components/QueryState';
import { QuestionEditorPanel } from '../../components/studio/QuestionEditorPanel';
import { StudioNav } from '../../components/studio/StudioNav';
import { api, errorMessage } from '../../lib/api';

// /studio/:teamId/quizzes/:id/questions: 問題一覧(並び替え)+エディタ（§12 ルート表、§12.2）。
export function StudioQuestions() {
  const { teamId = '', quizId = '' } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<
    { mode: 'new'; type: 'text' | 'table' } | { mode: 'edit'; questionId: string } | null
  >(null);

  const {
    data: quiz,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['studio-quiz', quizId],
    queryFn: () => api.get<QuizSetFull>(`/teams/${teamId}/quiz-sets/${quizId}`),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['studio-quiz', quizId] });
    queryClient.invalidateQueries({ queryKey: ['studio-quizzes', teamId] });
  }

  const deleteMutation = useMutation({
    mutationFn: (questionId: string) => api.delete(`/teams/${teamId}/questions/${questionId}`),
    onSuccess: invalidate,
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) =>
      api.patch(`/teams/${teamId}/quiz-sets/${quizId}/questions/reorder`, { orderedIds }),
    onSuccess: invalidate,
  });

  function move(index: number, dir: -1 | 1) {
    if (!quiz) return;
    const ids = [...quiz.questions]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((q) => q.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    const idAt = ids[index];
    const idAtTarget = ids[target];
    if (idAt === undefined || idAtTarget === undefined) return;
    [ids[index], ids[target]] = [idAtTarget, idAt];
    reorderMutation.mutate(ids);
  }

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

  const sortedQuestions = [...quiz.questions].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <StudioNav teamId={teamId} />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">{quiz.title} の問題</h1>
        <Link
          to={`/studio/${teamId}/quizzes/${quizId}`}
          className="text-xs text-gray-500 hover:text-indigo-600"
        >
          クイズ設定に戻る
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setEditing({ mode: 'new', type: 'text' })}
          className="rounded-full bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + テキスト問題
        </button>
        <button
          type="button"
          onClick={() => setEditing({ mode: 'new', type: 'table' })}
          className="rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:border-indigo-400"
        >
          + 表問題
        </button>
      </div>

      <div className="space-y-3">
        {sortedQuestions.map((q, index) =>
          editing?.mode === 'edit' && editing.questionId === q.id ? (
            <QuestionEditorPanel
              key={q.id}
              teamId={teamId}
              quizSetId={quizId}
              existing={q}
              newType={q.type}
              onSaved={() => {
                setEditing(null);
                invalidate();
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div
              key={q.id}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="上へ"
                  className="text-xs text-gray-500 hover:text-indigo-600 disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === sortedQuestions.length - 1}
                  aria-label="下へ"
                  className="text-xs text-gray-500 hover:text-indigo-600 disabled:opacity-30"
                >
                  ▼
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-500">
                  問題{index + 1}・{q.type === 'text' ? 'テキスト型' : '表型'}
                </p>
                <p className="truncate font-medium text-gray-900">
                  {q.title || (q.textContent ?? '(無題)')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditing({ mode: 'edit', questionId: q.id })}
                className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-indigo-400"
              >
                編集
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('この問題を削除しますか？')) {
                    deleteMutation.mutate(q.id);
                  }
                }}
                className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:border-red-300 hover:text-red-600"
              >
                削除
              </button>
            </div>
          ),
        )}
        {sortedQuestions.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">問題がまだありません。</p>
        )}
      </div>

      {editing?.mode === 'new' && (
        <div className="mt-4">
          <QuestionEditorPanel
            teamId={teamId}
            quizSetId={quizId}
            existing={null}
            newType={editing.type}
            onSaved={() => {
              setEditing(null);
              invalidate();
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
      {reorderMutation.isError && (
        <p className="mt-2 text-xs text-red-600">{errorMessage(reorderMutation.error)}</p>
      )}
    </div>
  );
}
