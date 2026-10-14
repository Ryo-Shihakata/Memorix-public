import type { AdminStatsOverview } from '@memorix/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { QueryState } from '../../components/QueryState';
import { api } from '../../lib/api';
import { AdminLayout } from './AdminLayout';

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function DashboardContent() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-stats-overview'],
    queryFn: () => api.get<AdminStatsOverview>('/admin/stats/overview'),
  });

  if (isLoading || isError || !data) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError || !data}
        errorLabel="統計の取得に失敗しました。"
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">ダッシュボード</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="DAU（7日）" value={String(data.dau7)} />
        <StatCard label="DAU（30日）" value={String(data.dau30)} />
        <StatCard label="総プレイ数" value={String(data.totalPlays)} />
        <StatCard label="ゲスト比率" value={pct(data.guestRatio)} />
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">デバイス比率</h2>
        <p className="text-sm text-gray-600">
          PC {pct(data.deviceRatio.pc)} ・ モバイル {pct(data.deviceRatio.mobile)} ・ タブレット{' '}
          {pct(data.deviceRatio.tablet)}
        </p>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">人気クイズ TOP10</h2>
        {data.topQuizzes.length === 0 ? (
          <p className="text-sm text-gray-500">データがありません。</p>
        ) : (
          <ol className="space-y-1.5">
            {data.topQuizzes.map((q, i) => (
              <li
                key={q.id}
                className="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <Link
                  to={`/quiz/${q.id}`}
                  className="min-w-0 flex-1 truncate text-gray-900 hover:text-indigo-600"
                >
                  {i + 1}. {q.title}
                </Link>
                <span className="shrink-0 text-xs text-gray-500">{q.playCount}回</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  return (
    <AdminLayout>
      <DashboardContent />
    </AdminLayout>
  );
}
