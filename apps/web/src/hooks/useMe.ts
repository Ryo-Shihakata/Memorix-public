import type { Me } from '@memorix/shared';
import { useQuery } from '@tanstack/react-query';
import { api, isUnauthorized } from '../lib/api';

// GET /api/me はログイン必須（401）。未ログインは isUnauthorized(error) で判定し、
// 呼び出し側は「ログインしていない」状態として扱う（エラーバナーは出さない）。
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/me'),
    retry: false,
  });
}

export function useIsLoggedIn(): boolean {
  const { data, error } = useMe();
  if (data) return true;
  if (isUnauthorized(error)) return false;
  return false;
}
