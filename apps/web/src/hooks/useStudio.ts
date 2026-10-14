import type { Team, TeamRole } from '@memorix/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMe } from './useMe';

// Studio共通: チーム詳細 + 自分のロール（owner操作可否の判定に使う）。
export function useTeam(teamId: string) {
  return useQuery({
    queryKey: ['team', teamId],
    queryFn: () => api.get<Team>(`/teams/${teamId}`),
    enabled: !!teamId,
  });
}

export function useMyTeamRole(teamId: string): TeamRole | null {
  const { data } = useMe();
  const found = data?.teams.find((t) => t.id === teamId);
  return found?.role ?? null;
}
