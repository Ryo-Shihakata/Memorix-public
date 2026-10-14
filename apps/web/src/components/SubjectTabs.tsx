import { Link } from 'react-router-dom';
import { useSubjects } from '../hooks/useDiscover';

export function SubjectTabs({ activeSlug }: { activeSlug?: string }) {
  const { data: subjects } = useSubjects();

  return (
    <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="科目タブ">
      <Link
        to="/"
        className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
          !activeSlug ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
        }`}
      >
        すべて
      </Link>
      {(subjects ?? []).map((s) => (
        <Link
          key={s.id}
          to={`/subjects/${s.slug}`}
          className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
            activeSlug === s.slug
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          {s.icon ? `${s.icon} ` : ''}
          {s.name}
        </Link>
      ))}
    </nav>
  );
}
