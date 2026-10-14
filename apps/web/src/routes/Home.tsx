import type { QuizSetSummary } from '@memorix/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QueryState } from '../components/QueryState';
import { QuizGrid } from '../components/QuizGrid';
import { SubjectTabs } from '../components/SubjectTabs';
import { useDiscover } from '../hooks/useDiscover';
import { useMe } from '../hooks/useMe';
import { api, isUnauthorized } from '../lib/api';
import type { PageResult } from '../lib/pageResult';

function SortToggle({
  sort,
  onChange,
}: {
  sort: 'new' | 'popular';
  onChange: (s: 'new' | 'popular') => void;
}) {
  return (
    <div className="flex gap-1 rounded-full border border-gray-200 bg-white p-0.5 text-sm">
      <button
        type="button"
        onClick={() => onChange('new')}
        className={`rounded-full px-3 py-1 ${sort === 'new' ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}
      >
        新着
      </button>
      <button
        type="button"
        onClick={() => onChange('popular')}
        className={`rounded-full px-3 py-1 ${sort === 'popular' ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}
      >
        人気
      </button>
    </div>
  );
}

function FollowedFeedSection() {
  const { data, error } = useQuery({
    queryKey: ['feed'],
    queryFn: () => api.get<PageResult<QuizSetSummary>>('/me/feed'),
  });
  if (isUnauthorized(error) || !data || data.items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">フォロー中チームの新着</h2>
      <QuizGrid quizzes={data.items} />
    </section>
  );
}

function MyTeamsSection() {
  const { data: me } = useMe();
  if (!me || me.teams.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">マイチーム</h2>
      <div className="flex flex-wrap gap-2">
        {me.teams.map((t) => (
          <Link
            key={t.id}
            to={`/teams/${t.id}`}
            className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-indigo-300"
          >
            {t.isPersonal ? 'マイスペース' : t.name}
          </Link>
        ))}
        <Link
          to="/bookmarks"
          className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-indigo-300"
        >
          ブックマーク一覧
        </Link>
      </div>
    </section>
  );
}

export function Home() {
  const [sort, setSort] = useState<'new' | 'popular'>('new');
  const { data: me, error: meError } = useMe();
  const loggedIn = !!me && !isUnauthorized(meError);
  const { data, isLoading, isError, refetch } = useDiscover({ sort });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-indigo-600">Memorix</h1>
        <p className="text-sm text-gray-500">穴埋めクイズをつくる・とく・シェアする</p>
      </div>

      {loggedIn && (
        <div className="space-y-6 rounded-lg bg-indigo-50/60 p-4">
          <MyTeamsSection />
          <FollowedFeedSection />
        </div>
      )}

      <SubjectTabs />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">みんなのクイズ</h2>
        <SortToggle sort={sort} onChange={setSort} />
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        errorLabel="クイズの取得に失敗しました。"
        onRetry={refetch}
      />
      {data && <QuizGrid quizzes={data.items} />}
    </div>
  );
}
