import { Component, type ErrorInfo, type ReactNode } from 'react';

// アプリ全体を包む ErrorBoundary。レンダリング中の予期しない例外を捕捉し、
// 真っ白な画面のままにせず再読み込みを促す（依頼: ErrorBoundary(アプリ全体)）。
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    console.error('Unhandled error in app:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-lg font-semibold text-gray-900">予期しないエラーが発生しました。</p>
          <p className="text-sm text-gray-500">お手数ですが、ページを再読み込みしてください。</p>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/';
            }}
            className="rounded-full bg-indigo-600 px-6 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            トップへ戻って再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
