import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMe } from '../hooks/useMe';
import { isUnauthorized } from '../lib/api';
import { QueryState } from './QueryState';

// §12.3: 401 は /login へ誘導。ログイン後に戻れるよう redirect_to を保持する。
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data, error, isLoading } = useMe();

  if (isLoading) {
    return <QueryState isLoading isError={false} className="min-h-[50vh]" />;
  }

  if (!data || isUnauthorized(error)) {
    const redirectTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect_to=${redirectTo}`} replace />;
  }

  return <>{children}</>;
}
