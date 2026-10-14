import type { TeamMember, TeamRole } from '@memorix/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { QueryState } from '../../components/QueryState';
import { StudioNav } from '../../components/studio/StudioNav';
import { useMyTeamRole } from '../../hooks/useStudio';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { PageResult } from '../../lib/pageResult';

interface Invite {
  id: string;
  role: 'editor' | 'viewer';
  url: string;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
  createdAt: string;
}

function InviteForm({ teamId }: { teamId: string }) {
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [expiresInHours, setExpiresInHours] = useState(168);
  const [maxUses, setMaxUses] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ url: string }>(`/teams/${teamId}/invites`, {
        role,
        expiresInHours,
        maxUses: maxUses ? Number(maxUses) : undefined,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites', teamId] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-2 rounded border border-gray-200 bg-gray-50 p-3"
    >
      <div>
        <label htmlFor="invite-role" className="mb-1 block text-xs text-gray-500">
          役割
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="editor">編集者</option>
          <option value="viewer">閲覧者</option>
        </select>
      </div>
      <div>
        <label htmlFor="invite-hours" className="mb-1 block text-xs text-gray-500">
          有効期限(時間)
        </label>
        <input
          id="invite-hours"
          type="number"
          min={1}
          max={720}
          value={expiresInHours}
          onChange={(e) => setExpiresInHours(Number(e.target.value))}
          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label htmlFor="invite-maxuses" className="mb-1 block text-xs text-gray-500">
          最大使用回数(任意)
        </label>
        <input
          id="invite-maxuses"
          type="number"
          min={1}
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          placeholder="無制限"
          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        招待リンクを発行
      </button>
      {mutation.isError && (
        <p className="w-full text-xs text-red-600">{errorMessage(mutation.error)}</p>
      )}
      {mutation.isSuccess && (
        <p className="w-full break-all rounded bg-white p-2 text-xs text-indigo-600">
          {mutation.data.url}
        </p>
      )}
    </form>
  );
}

function InviteList({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['invites', teamId],
    queryFn: () => api.get<PageResult<Invite>>(`/teams/${teamId}/invites?per_page=50`),
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => api.delete(`/teams/${teamId}/invites/${inviteId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites', teamId] }),
  });

  if (!data || data.items.length === 0) {
    return <p className="text-xs text-gray-500">有効な招待リンクはありません。</p>;
  }

  return (
    <div className="space-y-2">
      {data.items.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center gap-2 rounded border border-gray-200 p-2 text-xs"
        >
          <span className="rounded bg-gray-100 px-1.5 py-0.5">
            {inv.role === 'editor' ? '編集者' : '閲覧者'}
          </span>
          <span className="min-w-0 flex-1 truncate text-gray-500">{inv.url}</span>
          <span className="shrink-0 text-gray-500">
            使用 {inv.useCount}
            {inv.maxUses ? `/${inv.maxUses}` : ''}回・{formatDateTime(inv.expiresAt)}まで
          </span>
          <button
            type="button"
            onClick={() => revokeMutation.mutate(inv.id)}
            className="shrink-0 rounded border border-gray-300 px-2 py-1 text-gray-500 hover:border-red-300 hover:text-red-600"
          >
            失効
          </button>
        </div>
      ))}
    </div>
  );
}

function MemberRow({
  teamId,
  member,
  canManage,
}: {
  teamId: string;
  member: TeamMember;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const roleMutation = useMutation({
    mutationFn: (role: TeamRole) =>
      api.patch(`/teams/${teamId}/members/${member.userId}`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', teamId] }),
  });
  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/teams/${teamId}/members/${member.userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', teamId] }),
  });

  return (
    <div className="flex items-center gap-3 rounded border border-gray-200 bg-white p-2">
      {member.avatarUrl ? (
        <img src={member.avatarUrl} alt={member.name} className="h-8 w-8 rounded-full" />
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
          {member.name.slice(0, 1)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{member.name}</p>
        <p className="truncate text-xs text-gray-500">{member.email}</p>
      </div>
      {canManage ? (
        <select
          value={member.role}
          onChange={(e) => roleMutation.mutate(e.target.value as TeamRole)}
          disabled={roleMutation.isPending}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="owner">オーナー</option>
          <option value="editor">編集者</option>
          <option value="viewer">閲覧者</option>
        </select>
      ) : (
        <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">{member.role}</span>
      )}
      {canManage && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`${member.name}をチームから外しますか？`)) {
              removeMutation.mutate();
            }
          }}
          className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:border-red-300 hover:text-red-600"
        >
          削除
        </button>
      )}
      {(roleMutation.isError || removeMutation.isError) && (
        <p className="w-full text-xs text-red-600">
          {errorMessage(roleMutation.error ?? removeMutation.error)}
        </p>
      )}
    </div>
  );
}

// /studio/:teamId/members: メンバー・招待リンク管理（owner のみ操作可、§12 ルート表）。
export function StudioMembers() {
  const { teamId = '' } = useParams();
  const role = useMyTeamRole(teamId);
  const isOwner = role === 'owner';

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['members', teamId],
    queryFn: () => api.get<PageResult<TeamMember>>(`/teams/${teamId}/members?per_page=100`),
  });

  return (
    <div className="mx-auto max-w-2xl p-4">
      <StudioNav teamId={teamId} />
      <h1 className="mb-4 text-lg font-semibold text-gray-900">メンバー</h1>

      <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} className="p-8" />

      <div className="mb-6 space-y-2">
        {(data?.items ?? []).map((m) => (
          <MemberRow key={m.userId} teamId={teamId} member={m} canManage={isOwner} />
        ))}
      </div>

      {isOwner && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">招待リンク</h2>
          <InviteForm teamId={teamId} />
          <InviteList teamId={teamId} />
        </div>
      )}
    </div>
  );
}
