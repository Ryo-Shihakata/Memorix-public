import { useSearchParams } from 'react-router-dom';
import { QueryState } from '../components/QueryState';
import { QuizGrid } from '../components/QuizGrid';
import { useDiscover } from '../hooks/useDiscover';

export function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const { data, isLoading, isError, refetch } = useDiscover({ q, sort: 'new' });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-lg font-semibold text-gray-900">「{q}」の検索結果</h1>
      <QueryState
        isLoading={isLoading}
        isError={isError}
        errorLabel="検索に失敗しました。"
        onRetry={refetch}
      />
      {data && (
        <QuizGrid quizzes={data.items} emptyMessage="一致するクイズが見つかりませんでした。" />
      )}
    </div>
  );
}
