import { errorMessage } from '../lib/api';

// TanStack Query のローディング/エラー表示を統一するコンポーネント（依頼: エラー・ローディングUX）。
// 各ページの早期returnで `<QueryState isLoading={...} isError={...} error={...} onRetry={refetch} />`
// のように使い、data が揃った場合のみ null を返して呼び出し側で本体を描画する想定。
export function QueryState({
  isLoading,
  isError,
  error,
  onRetry,
  loadingLabel = '読み込み中…',
  errorLabel,
  className = 'py-8',
}: {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  loadingLabel?: string;
  errorLabel?: string;
  className?: string;
}) {
  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center justify-center gap-2 text-sm text-gray-500 ${className}`}
      >
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600"
        />
        <span>{loadingLabel}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className={`flex flex-col items-center justify-center gap-2 text-center text-sm text-red-600 ${className}`}
      >
        <p>{errorLabel ?? errorMessage(error)}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-red-300 px-4 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            再試行
          </button>
        )}
      </div>
    );
  }

  return null;
}
