import { NavLink } from 'react-router-dom';

const LINKS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/admin', label: 'ダッシュボード', end: true },
  { to: '/admin/subjects', label: '科目' },
  { to: '/admin/reports', label: '通報' },
  { to: '/admin/users', label: 'ユーザー' },
];

export function AdminNav() {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 bg-white px-4">
      {LINKS.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) =>
            `shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${
              isActive
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}
