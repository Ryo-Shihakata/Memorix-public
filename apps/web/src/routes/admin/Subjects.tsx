import type { Subject } from '@memorix/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { QueryState } from '../../components/QueryState';
import { api, errorMessage } from '../../lib/api';
import { AdminLayout } from './AdminLayout';

const QUERY_KEY = ['admin-subjects'];

function CreateSubjectForm() {
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post<Subject>('/admin/subjects', {
        slug: slug.trim(),
        name: name.trim(),
        icon: icon.trim() || undefined,
        color: color.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setSlug('');
      setName('');
      setIcon('');
      setColor('');
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!slug.trim() || !name.trim()) return;
    mutation.mutate();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-3"
    >
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-gray-500">slug</span>
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="english"
          maxLength={50}
          className="w-32 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-gray-500">名前</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="英語"
          maxLength={50}
          className="w-32 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-gray-500">アイコン</span>
        <input
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder="📘"
          maxLength={10}
          className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-gray-500">色</span>
        <input
          value={color}
          onChange={(e) => setColor(e.target.value)}
          placeholder="#6366f1"
          maxLength={20}
          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={mutation.isPending || !slug.trim() || !name.trim()}
        className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        追加
      </button>
      {mutation.isError && (
        <p className="w-full text-xs text-red-600">{errorMessage(mutation.error)}</p>
      )}
    </form>
  );
}

function SubjectRow({ subject }: { subject: Subject }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(subject.name);
  const [icon, setIcon] = useState(subject.icon ?? '');
  const [color, setColor] = useState(subject.color ?? '');
  const [displayOrder, setDisplayOrder] = useState(String(subject.displayOrder));

  const patchMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<Subject>(`/admin/subjects/${subject.id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setEditing(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/admin/subjects/${subject.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  function saveEdit(e: FormEvent) {
    e.preventDefault();
    patchMutation.mutate({
      name: name.trim(),
      icon: icon.trim() || null,
      color: color.trim() || null,
      displayOrder: Number(displayOrder) || 0,
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg">{subject.icon || '❔'}</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900">{subject.name}</p>
          <p className="text-xs text-gray-500">
            slug: {subject.slug} ・ 表示順 {subject.displayOrder}
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={subject.isActive}
            onChange={(e) => patchMutation.mutate({ isActive: e.target.checked })}
            disabled={patchMutation.isPending}
          />
          有効
        </label>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-indigo-300"
        >
          {editing ? '閉じる' : '編集'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`科目「${subject.name}」を削除しますか？`)) {
              deleteMutation.mutate();
            }
          }}
          disabled={deleteMutation.isPending}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:border-red-300 hover:text-red-600"
        >
          削除
        </button>
      </div>

      {editing && (
        <form
          onSubmit={saveEdit}
          className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-2"
        >
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-500">名前</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-32 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-500">アイコン</span>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-500">色</span>
            <input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-500">表示順</span>
            <input
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={patchMutation.isPending}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            保存
          </button>
        </form>
      )}

      {(patchMutation.isError || deleteMutation.isError) && (
        <p className="text-xs text-red-600">
          {errorMessage(patchMutation.error ?? deleteMutation.error)}
        </p>
      )}
    </div>
  );
}

function SubjectsContent() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<Subject[]>('/admin/subjects'),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-900">科目管理</h1>
      <CreateSubjectForm />
      <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} />
      {data && data.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-500">科目がまだありません。</p>
      )}
      {data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((s) => (
            <SubjectRow key={s.id} subject={s} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Subjects() {
  return (
    <AdminLayout>
      <SubjectsContent />
    </AdminLayout>
  );
}
