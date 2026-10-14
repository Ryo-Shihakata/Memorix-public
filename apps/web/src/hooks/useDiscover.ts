import type { QuizSetSummary, Subject } from '@memorix/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { buildQuery, type PageResult } from '../lib/pageResult';

export interface DiscoverParams {
  subject?: string;
  sort?: 'new' | 'popular';
  q?: string;
  page?: number;
}

export function useDiscover(params: DiscoverParams) {
  return useQuery({
    queryKey: ['discover', params],
    queryFn: () => api.get<PageResult<QuizSetSummary>>(`/discover${buildQuery({ ...params })}`),
  });
}

export function useSubjects() {
  return useQuery({
    queryKey: ['subjects'],
    queryFn: () => api.get<Subject[]>('/subjects'),
    staleTime: 5 * 60_000,
  });
}
