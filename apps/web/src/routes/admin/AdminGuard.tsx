import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { QueryState } from '../../components/QueryState';
import { useMe } from '../../hooks/useMe';
import { isUnauthorized } from '../../lib/api';

// /admin 配下の共通ガード。未ログインは /login へ誘導し、ログイン済みだが非adminは
// アクセス不可メッセージを表示する（依頼: 「非adminはアクセス不可表示」）。
export function AdminGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, error, isLoading } = useMe();

  if (isLoading) {
    return <QueryState isLoading isError={false} className="min-h-[50vh]" />;
  }

  if (!data || isUnauthorized(error)) {
    const redirectTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect_to=${redirectTo}`} replace />;
  }

  if (data.user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-8 text-center">
        <p className="text-sm text-gray-600">このページにアクセスする権限がありません。</p>
      </div>
    );
  }

  return <>{children}</>;
}
