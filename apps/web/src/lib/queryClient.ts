import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api';

// 401/403/404 はリトライしても解決しないため即座に諦める。
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
    return false;
  }
  return failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
});
