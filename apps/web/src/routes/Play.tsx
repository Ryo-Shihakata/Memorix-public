import { Link, useParams } from 'react-router-dom';
import { PlayQuestionView } from '../components/PlayQuestionView';
import { usePlaySession } from '../hooks/usePlaySession';

export function Play() {
  const { sessionId = '' } = useParams();
  const {
    cache,
    answers,
    onFocusBlank,
    onChangeBlank,
    filledCount,
    totalCount,
    submitStatus,
    submitError,
    submit,
    retrySubmit,
  } = usePlaySession(sessionId);

  if (!cache) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-4 text-center">
        <p className="text-sm text-gray-600">
          このセッションの情報が見つかりませんでした。表紙からやり直してください。
        </p>
        <Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">
          トップへ戻る
        </Link>
      </div>
    );
  }

  function handleSubmitClick() {
    if (filledCount < totalCount) {
      const ok = window.confirm(
        `未入力の空欄が${totalCount - filledCount}個あります。このまま採点しますか？`,
      );
      if (!ok) return;
    }
    submit();
  }

  const { quizSet, questions } = cache.payload;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-gray-900">{quizSet.title}</h1>
        <p className="text-xs text-gray-500">{quizSet.teamName}</p>
      </div>

      <div className="space-y-4">
        {questions.map((q, i) => (
          <PlayQuestionView
            key={q.id}
            question={q}
            index={i}
            answers={answers}
            onFocusBlank={onFocusBlank}
            onChangeBlank={onChangeBlank}
          />
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <span className="text-sm text-gray-600">
            {filledCount}/{totalCount} 入力済み
          </span>
          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={submitStatus === 'submitting'}
            className="rounded-full bg-indigo-600 px-6 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitStatus === 'submitting' ? '採点中…' : '採点する'}
          </button>
        </div>
        {submitStatus === 'error' && (
          <div className="mx-auto mt-2 flex max-w-2xl items-center justify-between gap-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{submitError ?? '提出に失敗しました。自動的に再試行しています…'}</span>
            <button
              type="button"
              onClick={retrySubmit}
              className="shrink-0 rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
            >
              再送信
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
