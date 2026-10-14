import { LIMITS } from '@memorix/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { QueryState } from '../../components/QueryState';
import { StudioNav } from '../../components/studio/StudioNav';
import { useTeam } from '../../hooks/useStudio';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { ACCEPTED_IMAGE_TYPES, compressImage } from '../../lib/imageCompress';
import type { PageResult } from '../../lib/pageResult';

interface StudioImage {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// /studio/:teamId/images: 画像ライブラリ（使用量バー、削除）§12 ルート表。
export function StudioImages() {
  const { teamId = '' } = useParams();
  const { data: team } = useTeam(teamId);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['studio-images', teamId],
    queryFn: () => api.get<PageResult<StudioImage>>(`/teams/${teamId}/images?per_page=100`),
  });

  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => api.delete(`/teams/${teamId}/images/${imageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studio-images', teamId] });
      queryClient.invalidateQueries({ queryKey: ['team', teamId] });
    },
  });

  async function onUpload(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.set('file', compressed.blob, file.name);
      form.set('width', String(compressed.width));
      form.set('height', String(compressed.height));
      form.set('filename', file.name);
      await api.postForm(`/teams/${teamId}/images`, form);
      queryClient.invalidateQueries({ queryKey: ['studio-images', teamId] });
      queryClient.invalidateQueries({ queryKey: ['team', teamId] });
    } catch (e) {
      setUploadError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  const used = team?.storageUsedBytes ?? 0;
  const usagePercent = Math.min(100, (used / LIMITS.TEAM_STORAGE_MAX_BYTES) * 100);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <StudioNav teamId={teamId} />
      <h1 className="mb-4 text-lg font-semibold text-gray-900">画像ライブラリ</h1>

      <div className="mb-4 space-y-1">
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full ${usagePercent > 90 ? 'bg-red-500' : 'bg-indigo-500'}`}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
        <p className="text-xs text-gray-500">
          {formatBytes(used)} / {formatBytes(LIMITS.TEAM_STORAGE_MAX_BYTES)} 使用中
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          aria-label="画像をアップロード"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
          className="text-sm"
        />
        {uploading && <span className="text-xs text-gray-500">アップロード中…</span>}
      </div>
      {uploadError && <p className="mb-3 text-xs text-red-600">{uploadError}</p>}

      <QueryState isLoading={isLoading} isError={isError} onRetry={refetch} className="p-8" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(data?.items ?? []).map((img) => (
          <div key={img.id} className="space-y-1 rounded border border-gray-200 bg-white p-2">
            <img src={img.url} alt={img.filename} className="h-24 w-full rounded object-cover" />
            <p className="truncate text-xs text-gray-500">{img.filename}</p>
            <p className="text-xs text-gray-500">
              {formatBytes(img.fileSize)}・{formatDate(img.createdAt)}
            </p>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`画像「${img.filename}」を削除しますか？`)) {
                  deleteMutation.mutate(img.id);
                }
              }}
              className="w-full rounded border border-gray-300 py-1 text-xs text-gray-500 hover:border-red-300 hover:text-red-600"
            >
              削除
            </button>
          </div>
        ))}
      </div>
      {deleteMutation.isError && (
        <p className="mt-2 text-xs text-red-600">{errorMessage(deleteMutation.error)}</p>
      )}
      {(data?.items ?? []).length === 0 && !isLoading && (
        <p className="py-8 text-center text-sm text-gray-500">画像がまだありません。</p>
      )}
    </div>
  );
}
