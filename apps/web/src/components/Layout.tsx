import type { FormEvent, ReactNode } from 'react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMe } from '../hooks/useMe';
import { isUnauthorized } from '../lib/api';
import { OfflineBanner } from './OfflineBanner';

function HeaderSearch() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (q.trim()) {
      navigate(`/search?q=${encodeURIComponent(q.trim())}`);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex-1 max-w-md">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="クイズを検索"
        aria-label="クイズを検索"
        className="w-full rounded-full border border-gray-300 px-4 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
      />
    </form>
  );
}

function HeaderAuth() {
  const { data, error, isLoading } = useMe();

  if (isLoading) return null;

  if (!data || isUnauthorized(error)) {
    return (
      <Link
        to="/login"
        className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        ログイン
      </Link>
    );
  }

  return (
    <nav aria-label="ユーザーメニュー" className="flex items-center gap-3 text-sm">
      <Link to="/studio" className="text-gray-600 hover:text-indigo-600">
        Studio
      </Link>
      <Link to="/bookmarks" className="text-gray-600 hover:text-indigo-600">
        ブックマーク
      </Link>
      <Link to="/history" className="text-gray-600 hover:text-indigo-600">
        受験履歴
      </Link>
      {data.user.avatarUrl ? (
        <img src={data.user.avatarUrl} alt={data.user.name} className="h-8 w-8 rounded-full" />
      ) : (
        <span
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700"
        >
          {data.user.name.slice(0, 1)}
        </span>
      )}
    </nav>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <OfflineBanner />
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-2">
        <Link to="/" className="shrink-0 text-xl font-bold text-indigo-600">
          Memorix
        </Link>
        <HeaderSearch />
        <div className="ml-auto">
          <HeaderAuth />
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-gray-200 px-4 py-3 text-center text-xs text-gray-500">
        <Link to="/terms" className="hover:text-gray-600">
          利用規約
        </Link>
        {' ・ '}
        <Link to="/privacy" className="hover:text-gray-600">
          プライバシーポリシー
        </Link>
      </footer>
    </div>
  );
}
