import { Link, useLocation } from 'react-router-dom';

// §12 ルート表: /studio/:teamId 配下の共通タブナビゲーション。
function TabLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
        active ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
      }`}
    >
      {label}
    </Link>
  );
}

export function StudioNav({ teamId }: { teamId: string }) {
  const location = useLocation();
  const path = location.pathname;
  const base = `/studio/${teamId}`;

  const tabs = [
    { to: base, label: 'クイズ', active: path === base || path.includes('/quizzes/') },
    { to: `${base}/images`, label: '画像', active: path === `${base}/images` },
    { to: `${base}/members`, label: 'メンバー', active: path === `${base}/members` },
    { to: `${base}/settings`, label: '設定', active: path === `${base}/settings` },
  ];

  return (
    <div className="mb-4 flex items-center gap-3 border-b border-gray-200 pb-2">
      <Link to="/studio" className="shrink-0 text-xs text-gray-500 hover:text-indigo-600">
        ← チーム切替
      </Link>
      <nav className="flex gap-2 overflow-x-auto" aria-label="Studioナビゲーション">
        {tabs.map((t) => (
          <TabLink key={t.to} to={t.to} label={t.label} active={t.active} />
        ))}
      </nav>
    </div>
  );
}
