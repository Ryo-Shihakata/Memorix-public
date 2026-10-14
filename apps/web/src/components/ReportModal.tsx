import type { ReportReason } from '@memorix/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';
import { api, errorMessage } from '../lib/api';

const REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'inappropriate', label: '不適切な内容' },
  { value: 'copyright', label: '著作権侵害' },
  { value: 'spam', label: 'スパム' },
  { value: 'other', label: 'その他' },
];

// a11y: Escで閉じる・フォーカストラップ（依頼: モーダル(通報)のEsc閉じ・フォーカストラップ）。
export function ReportModal({ quizSetId, onClose }: { quizSetId: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>('inappropriate');
  const [detail, setDetail] = useState('');
  const containerRef = useModalA11y<HTMLDivElement>(onClose);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/quiz-sets/${quizSetId}/reports`, { reason, detail: detail.trim() || undefined }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
        tabIndex={-1}
        className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg focus:outline-none"
      >
        <h2 id="report-modal-title" className="mb-3 text-lg font-semibold">
          このクイズを通報する
        </h2>
        {mutation.isSuccess ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              通報を受け付けました。ご協力ありがとうございます。
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded bg-gray-100 py-2 text-sm font-medium hover:bg-gray-200"
            >
              閉じる
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            className="space-y-3"
          >
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-gray-700">理由</legend>
              {REASONS.map((r) => (
                <label key={r.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </fieldset>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">詳細（任意）</span>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                maxLength={1000}
                rows={3}
                className="w-full rounded border border-gray-300 p-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </label>
            {mutation.isError && (
              <p className="text-sm text-red-600">{errorMessage(mutation.error)}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded bg-gray-100 py-2 text-sm font-medium hover:bg-gray-200"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="flex-1 rounded bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {mutation.isPending ? '送信中…' : '通報する'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
