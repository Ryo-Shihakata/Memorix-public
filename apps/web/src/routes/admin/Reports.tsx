import type { Report, ReportReason, ReportStatus } from '@memorix/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QueryState } from '../../components/QueryState';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { buildQuery, type PageResult } from '../../lib/pageResult';
import { AdminLayout } from './AdminLayout';

const QUERY_KEY = 'admin-reports';

const REASON_LABEL: Record<ReportReason, string> = {
  inappropriate: '不適切な内容',
  copyright: '著作権侵害',
  spam: 'スパム',
  other: 'その他',
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  open: '未対応',
  actioned: '対応済み',
  dismissed: '却下',
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'open', label: '未対応' },
  { value: 'actioned', label: '対応済み' },
  { value: 'dismissed', label: '却下' },
  { value: '', label: 'すべて' },
];

// 通報対象クイズへのモデレーション操作。suspend の状態は API レスポンス（Report.quizSuspendedAt）
// を正とし、操作成功時に一覧クエリを invalidate して反映する。
function QuizModerationControls({
  quizSetId,
  quizTitle,
  suspended,
}: {
  quizSetId: string;
  quizTitle: string;
  suspended: boolean;
}) {
  const queryClient = useQueryClient();
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');

  const suspendMutation = useMutation({
    mutationFn: () => api.post(`/admin/quiz-sets/${quizSetId}/suspend`, { reason: reason.trim() }),
    onSuccess: () => {
      setReasonOpen(false);
      setReason('');
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
  const unsuspendMutation = useMutation({
    mutationFn: () => api.delete(`/admin/quiz-sets/${quizSetId}/suspend`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/admin/quiz-sets/${quizSetId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  if (deleteMutation.isSuccess) {
    return <p className="text-xs text-gray-500">このクイズは完全に削除されました。</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/quiz/${quizSetId}`}
          className="text-sm font-medium text-indigo-600 hover:underline"
        >
          {quizTitle}
        </Link>
        {suspended && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            停止中
          </span>
        )}
        {suspended ? (
          <button
            type="button"
            onClick={() => unsuspendMutation.mutate()}
            disabled={unsuspendMutation.isPending}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:border-indigo-300"
          >
            停止解除
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setReasonOpen((v) => !v)}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-red-600 hover:border-red-300"
          >
            停止する
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(`「${quizTitle}」を完全に削除しますか？この操作は取り消せません。`)
            ) {
              deleteMutation.mutate();
            }
          }}
          disabled={deleteMutation.isPending}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-red-300 hover:text-red-600"
        >
          完全削除
        </button>
      </div>

      {reasonOpen && !suspended && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) suspendMutation.mutate();
          }}
          className="flex items-center gap-1.5"
        >
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="停止理由"
            aria-label={`${quizTitle}の停止理由`}
            maxLength={1000}
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={suspendMutation.isPending || !reason.trim()}
            className="shrink-0 rounded bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            停止を確定
          </button>
        </form>
      )}

      {(suspendMutation.isError || unsuspendMutation.isError || deleteMutation.isError) && (
        <p className="text-xs text-red-600">
          {errorMessage(suspendMutation.error ?? unsuspendMutation.error ?? deleteMutation.error)}
        </p>
      )}
    </div>
  );
}

function ReportRow({ report }: { report: Report }) {
  const queryClient = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: (status: 'actioned' | 'dismissed') =>
      api.patch<Report>(`/admin/reports/${report.id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{formatDateTime(report.createdAt)}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
          {STATUS_LABEL[report.status]}
        </span>
      </div>
      <QuizModerationControls
        quizSetId={report.quizSetId}
        quizTitle={report.quizTitle}
        suspended={report.quizSuspendedAt !== null}
      />
      <p className="text-xs text-gray-500">{report.teamName}</p>
      <p className="text-sm text-gray-700">
        理由: {REASON_LABEL[report.reason]}
        {report.detail && <span className="text-gray-500"> — {report.detail}</span>}
      </p>
      {report.status === 'open' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => statusMutation.mutate('actioned')}
            disabled={statusMutation.isPending}
            className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            対応済みにする
          </button>
          <button
            type="button"
            onClick={() => statusMutation.mutate('dismissed')}
            disabled={statusMutation.isPending}
            className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:border-gray-400"
          >
            却下する
          </button>
        </div>
      )}
      {statusMutation.isError && (
        <p className="text-xs text-red-600">{errorMessage(statusMutation.error)}</p>
      )}
    </div>
  );
}

function ReportsContent() {
  const [status, setStatus] = useState('open');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [QUERY_KEY, status],
    queryFn: () =>
      api.get<PageResult<Report>>(`/admin/reports${buildQuery({ status: status || undefined })}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">通報キュー</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="ステータスで絞り込み"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} />
      {data && data.items.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-500">該当する通報はありません。</p>
      )}
      {data && data.items.length > 0 && (
        <div className="space-y-2">
          {data.items.map((r) => (
            <ReportRow key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Reports() {
  return (
    <AdminLayout>
      <ReportsContent />
    </AdminLayout>
  );
}
