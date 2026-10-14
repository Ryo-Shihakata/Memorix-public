import type { AdminUser, ServiceRole } from '@memorix/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { QueryState } from '../../components/QueryState';
import { useMe } from '../../hooks/useMe';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { buildQuery, type PageResult } from '../../lib/pageResult';
import { AdminLayout } from './AdminLayout';

const QUERY_KEY = 'admin-users';

// 自分自身のBAN・降格はAPIが400を返す（apps/worker/src/routes/admin/users.ts）。
// UI側でも操作ボタンを無効化してロックアウトを未然に防ぐ（依頼: エラー表示の前提として自明な防御）。
function UserRow({ user, meId }: { user: AdminUser; meId: string }) {
  const queryClient = useQueryClient();
  const isSelf = user.id === meId;

  const banMutation = useMutation({
    mutationFn: () =>
      user.bannedAt
        ? api.delete(`/admin/users/${user.id}/ban`)
        : api.post(`/admin/users/${user.id}/ban`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });
  const roleMutation = useMutation({
    mutationFn: (role: ServiceRole) => api.patch(`/admin/users/${user.id}/role`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  return (
    <tr className="border-b border-gray-100 align-top text-sm">
      <td className="p-2">
        <p className="font-medium text-gray-900">{user.name}</p>
        <p className="text-xs text-gray-500">{user.email}</p>
        {user.bannedAt && <p className="text-xs font-medium text-red-600">BAN中</p>}
      </td>
      <td className="p-2">
        <select
          value={user.role}
          onChange={(e) => roleMutation.mutate(e.target.value as ServiceRole)}
          disabled={roleMutation.isPending || isSelf}
          aria-label={`${user.name}のロール`}
          className="rounded border border-gray-300 px-1.5 py-1 text-xs disabled:opacity-50"
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td className="p-2 text-xs text-gray-500">{formatDate(user.createdAt)}</td>
      <td className="p-2 text-xs text-gray-500">
        {user.lastLoginAt ? formatDate(user.lastLoginAt) : '—'}
      </td>
      <td className="p-2">
        <button
          type="button"
          onClick={() => banMutation.mutate()}
          disabled={banMutation.isPending || isSelf}
          className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${
            user.bannedAt
              ? 'border border-gray-300 text-gray-600 hover:border-indigo-300'
              : 'bg-red-600 text-white hover:bg-red-700'
          }`}
        >
          {user.bannedAt ? 'BAN解除' : 'BAN'}
        </button>
        {(banMutation.isError || roleMutation.isError) && (
          <p className="mt-1 text-xs text-red-600">
            {errorMessage(banMutation.error ?? roleMutation.error)}
          </p>
        )}
      </td>
    </tr>
  );
}

function UsersContent() {
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const [queryQ, setQueryQ] = useState('');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [QUERY_KEY, queryQ],
    queryFn: () =>
      api.get<PageResult<AdminUser>>(`/admin/users${buildQuery({ q: queryQ || undefined })}`),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setQueryQ(q.trim());
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-900">ユーザー管理</h1>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="メールアドレス・名前で検索"
          className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          検索
        </button>
      </form>
      <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} />
      {data && data.items.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-500">ユーザーが見つかりませんでした。</p>
      )}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="p-2">ユーザー</th>
                <th className="p-2">ロール</th>
                <th className="p-2">登録日</th>
                <th className="p-2">最終ログイン</th>
                <th className="p-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <UserRow key={u.id} user={u} meId={me?.user.id ?? ''} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Users() {
  return (
    <AdminLayout>
      <UsersContent />
    </AdminLayout>
  );
}
