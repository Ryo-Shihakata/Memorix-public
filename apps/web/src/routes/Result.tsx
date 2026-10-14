import type { SubmitResult } from '@memorix/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QueryState } from '../components/QueryState';
import { useCreateSession } from '../hooks/useCreateSession';
import { api } from '../lib/api';
import { loadPlayCache } from '../lib/playCache';

interface ResultResponse extends SubmitResult {
  quizSet: { id: string; title: string; description: string | null; teamName: string };
}

interface DisplayQuestion {
  id: string;
  title: string | null;
  blanks: SubmitResult['results'];
}

export function Result() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['result', sessionId],
    queryFn: () => api.get<ResultResponse>(`/sessions/${sessionId}/result`),
  });
  const startSession = useCreateSession();

  if (isLoading || isError || !data) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError || !data}
        errorLabel="結果が見つかりませんでした。"
        onRetry={refetch}
        className="p-4"
      />
    );
  }

  const cache = loadPlayCache(sessionId);
  const resultByBlankId = new Map(data.results.map((r) => [r.blankId, r]));

  // 同一ブラウザで受験した直後であれば、キャッシュした問題構造を使って
  // 問題ごとにグルーピングして表示する。キャッシュが無い場合はフラット表示にフォールバックする。
  const displayQuestions: DisplayQuestion[] = cache
    ? cache.payload.questions.map((q) => ({
        id: q.id,
        title: q.title,
        blanks: q.blanks
          .map((b) => resultByBlankId.get(b.id))
          .filter((r): r is SubmitResult['results'][number] => r !== undefined),
      }))
    : [{ id: 'flat', title: null, blanks: data.results }];

  function handleRetry() {
    if (cache?.source.quizSetId || cache?.source.shareToken) {
      startSession.mutate(cache.source);
    } else if (data) {
      navigate(`/quiz/${data.quizSet.id}`);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-bold text-gray-900">{data.quizSet.title}</h1>
        <p className="text-xs text-gray-500">{data.quizSet.teamName}</p>
      </div>

      <div className="rounded-lg bg-indigo-600 p-6 text-center text-white">
        <p className="text-4xl font-extrabold">{data.score.percent}%</p>
        <p className="mt-1 text-sm">
          {data.score.correct} / {data.score.total} 問正解
        </p>
      </div>

      <div className="space-y-3">
        {displayQuestions.map((q, qi) => (
          <section key={q.id} className="rounded-lg border border-gray-200 bg-white p-4">
            {q.title !== null && (
              <h2 className="mb-2 text-sm font-semibold text-gray-500">
                問題 {qi + 1}　{q.title}
              </h2>
            )}
            <ul className="space-y-2">
              {q.blanks.map((b) => (
                <li key={b.blankId} className="flex items-start gap-2 text-sm">
                  <span aria-hidden className={b.isCorrect ? 'text-green-600' : 'text-red-600'}>
                    {b.isCorrect ? '✅' : '❌'}
                  </span>
                  <div>
                    <p className={b.isCorrect ? 'text-gray-900' : 'text-red-700'}>
                      あなたの回答: {b.userAnswer || '（未入力）'}
                    </p>
                    {!b.isCorrect && <p className="text-gray-500">模範解答: {b.correctAnswer}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="flex flex-col gap-2 pb-6">
        <button
          type="button"
          onClick={handleRetry}
          disabled={startSession.isPending}
          className="w-full rounded-full bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          もう一度
        </button>
        <Link
          to="/"
          className="w-full rounded-full border border-gray-300 py-2.5 text-center text-sm font-medium text-gray-600 hover:border-indigo-400"
        >
          トップへ戻る
        </Link>
      </div>
    </div>
  );
}
