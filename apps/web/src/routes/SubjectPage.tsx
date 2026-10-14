import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { QueryState } from '../components/QueryState';
import { QuizGrid } from '../components/QuizGrid';
import { SubjectTabs } from '../components/SubjectTabs';
import { useDiscover, useSubjects } from '../hooks/useDiscover';

export function SubjectPage() {
  const { slug = '' } = useParams();
  const [sort, setSort] = useState<'new' | 'popular'>('new');
  const { data: subjects } = useSubjects();
  const subject = subjects?.find((s) => s.slug === slug);
  const { data, isLoading, isError, refetch } = useDiscover({ subject: slug, sort });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <SubjectTabs activeSlug={slug} />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          {subject ? `${subject.icon ?? ''} ${subject.name}` : slug}
        </h1>
        <div className="flex gap-1 rounded-full border border-gray-200 bg-white p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setSort('new')}
            className={`rounded-full px-3 py-1 ${sort === 'new' ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}
          >
            新着
          </button>
          <button
            type="button"
            onClick={() => setSort('popular')}
            className={`rounded-full px-3 py-1 ${sort === 'popular' ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}
          >
            人気
          </button>
        </div>
      </div>
      <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} />
      {data && <QuizGrid quizzes={data.items} />}
    </div>
  );
}
