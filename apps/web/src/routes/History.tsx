import type { MeSessionSummary, MeStats } from '@memorix/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QueryState } from '../components/QueryState';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { buildQuery, type PageResult } from '../lib/pageResult';

// スコア推移は Recharts 等の新規依存を追加せずに、既存スタックのみで簡易バーチャートとして描画する
// （§12.3 は統計ページでの Recharts 利用を想定しているが、このチャンクの変更範囲では
//   新規依存の追加を避ける判断とした。件数・傾向が視覚的に分かれば十分と判断）。
function ScoreTrend({ recentScores }: { recentScores: MeStats['recentScores'] }) {
  if (recentScores.length === 0) {
    return <p className="text-sm text-gray-500">まだ提出済みのセッションがありません。</p>;
  }
  // 古い→新しいの順で左から並べる
  const ordered = [...recentScores].reverse();
  return (
    <div className="flex h-32 items-end gap-1 overflow-x-auto">
      {ordered.map((s, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: 同一クイズの複数回受験があり得るため安定キーが無い
          key={i}
          title={`${s.quizTitle}: ${s.percent}%`}
          className="flex w-4 shrink-0 flex-col items-center justify-end"
        >
          <div
            className="w-full rounded-t bg-indigo-500"
            style={{ height: `${Math.max(s.percent, 2)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function WeakBlanksList({ weakBlanks }: { weakBlanks: MeStats['weakBlanks'] }) {
  if (weakBlanks.length === 0) {
    return <p className="text-sm text-gray-500">苦手な空欄はまだ検出されていません。</p>;
  }
  return (
    <ul className="space-y-1.5">
      {weakBlanks.map((b, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: blankId が MeStats に含まれないため安定キーが無い
          key={i}
          className="flex items-center justify-between text-sm"
        >
          <span className="truncate text-gray-700">
            {b.questionTitle ?? '（無題の問題）'} ・ 空欄{b.blankOrder}
          </span>
          <span className="shrink-0 font-medium text-red-600">
            正答率 {Math.round(b.correctRate * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatsSummary() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['me-stats'],
    queryFn: () => api.get<MeStats>('/me/stats'),
  });

  if (isLoading || isError || !data) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError || !data}
        errorLabel="統計の取得に失敗しました。"
        onRetry={refetch}
        className="py-4"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-indigo-600">{data.totalSessions}</p>
          <p className="text-xs text-gray-500">総受験数</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-indigo-600">{data.avgScore}%</p>
          <p className="text-xs text-gray-500">平均スコア</p>
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">スコア推移（直近20件）</h2>
        <ScoreTrend recentScores={data.recentScores} />
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">苦手な空欄</h2>
        <WeakBlanksList weakBlanks={data.weakBlanks} />
      </div>
    </div>
  );
}

function SessionRow({ session }: { session: MeSessionSummary }) {
  return (
    <Link
      to={`/quiz/${session.quizSetId}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 hover:border-indigo-300"
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-gray-900">{session.quizTitle}</p>
        <p className="truncate text-xs text-gray-500">
          {session.teamName} ・ {formatDateTime(session.startedAt)}
        </p>
      </div>
      {session.score ? (
        <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-sm font-semibold text-indigo-700">
          {session.score.percent}%
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
          未提出
        </span>
      )}
    </Link>
  );
}

function SessionList() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['me-sessions', page],
    queryFn: () => api.get<PageResult<MeSessionSummary>>(`/me/sessions${buildQuery({ page })}`),
  });

  if (isLoading || isError || !data) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError || !data}
        errorLabel="履歴の取得に失敗しました。"
        onRetry={refetch}
        className="py-4"
      />
    );
  }
  if (data.items.length === 0) {
    return <p className="py-4 text-center text-sm text-gray-500">受験履歴はまだありません。</p>;
  }

  const hasMore = data.page * data.perPage < data.total;

  return (
    <div className="space-y-2">
      {data.items.map((s) => (
        <SessionRow key={s.id} session={s} />
      ))}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 disabled:opacity-40"
        >
          前へ
        </button>
        <span className="text-xs text-gray-500">
          {data.page} / {Math.max(1, Math.ceil(data.total / data.perPage))}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasMore}
          className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 disabled:opacity-40"
        >
          次へ
        </button>
      </div>
    </div>
  );
}

export function History() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-lg font-semibold text-gray-900">受験履歴</h1>
      <StatsSummary />
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">履歴一覧</h2>
        <SessionList />
      </div>
    </div>
  );
}
