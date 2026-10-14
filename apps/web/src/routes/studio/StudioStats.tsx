import type { QuizStats } from '@memorix/shared';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QueryState } from '../../components/QueryState';
import { StudioNav } from '../../components/studio/StudioNav';
import { api } from '../../lib/api';

// §12.3: グラフはRecharts。統計ページのみ動的importする。
const StatsCharts = lazy(() => import('../../components/studio/StatsCharts'));

// /studio/:teamId/quizzes/:id/stats（§7.6, §12.3）。
export function StudioStats() {
  const { teamId = '', quizId = '' } = useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['studio-quiz-stats', quizId],
    queryFn: () => api.get<QuizStats>(`/teams/${teamId}/quiz-sets/${quizId}/stats`),
  });

  return (
    <div className="mx-auto max-w-3xl p-4">
      <StudioNav teamId={teamId} />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">統計</h1>
        <Link
          to={`/studio/${teamId}/quizzes/${quizId}`}
          className="text-xs text-gray-500 hover:text-indigo-600"
        >
          クイズ設定に戻る
        </Link>
      </div>

      <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} className="p-8" />

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <p className="text-2xl font-bold text-indigo-600">{data.plays}</p>
              <p className="text-xs text-gray-500">プレイ回数</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <p className="text-2xl font-bold text-indigo-600">
                {Math.round(data.completionRate * 100)}%
              </p>
              <p className="text-xs text-gray-500">完了率</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <p className="text-2xl font-bold text-indigo-600">{data.avgScorePercent}%</p>
              <p className="text-xs text-gray-500">平均スコア</p>
            </div>
          </div>

          <Suspense
            fallback={<p className="text-center text-xs text-gray-500">グラフを読み込み中…</p>}
          >
            <StatsCharts stats={data} />
          </Suspense>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-700">空欄ごとの正答率</h2>
            <div className="space-y-2">
              {data.blankStats.map((b) => (
                <div
                  key={`${b.questionTitle ?? ''}-${b.blankOrder}`}
                  className="rounded border border-gray-200 bg-white p-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700">
                      {b.questionTitle ?? '(無題)'}・空欄{b.blankOrder}
                    </span>
                    <span className="font-medium text-indigo-600">
                      {Math.round(b.correctRate * 100)}%（{b.attempts}回）
                    </span>
                  </div>
                  {b.topWrongAnswers.length > 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      よくある誤答:{' '}
                      {b.topWrongAnswers.map((w) => `${w.answer}(${w.count})`).join('、')}
                    </p>
                  )}
                </div>
              ))}
              {data.blankStats.length === 0 && (
                <p className="text-xs text-gray-500">データがまだありません。</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
