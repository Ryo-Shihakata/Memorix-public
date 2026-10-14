import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { ACCEPTED_IMAGE_TYPES, compressImage } from '../../lib/imageCompress';
import type { PageResult } from '../../lib/pageResult';

interface StudioImage {
  id: string;
  url: string;
  filename: string;
  width: number | null;
  height: number | null;
}

// §12.2: 問題・空欄・セルの画像はチームの画像ライブラリから選択、またはその場でアップロードする。
export function ImagePicker({
  teamId,
  value,
  onChange,
}: {
  teamId: string;
  value: string | null;
  onChange: (imageId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['studio-images', teamId],
    queryFn: () => api.get<PageResult<StudioImage>>(`/teams/${teamId}/images?per_page=100`),
    enabled: open,
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
      const image = await api.postForm<StudioImage>(`/teams/${teamId}/images`, form);
      queryClient.invalidateQueries({ queryKey: ['studio-images', teamId] });
      onChange(image.id);
      setOpen(false);
    } catch (e) {
      setUploadError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  const selected = (data?.items ?? []).find((img) => img.id === value);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {value ? (
          <img
            src={`/img/${value}`}
            alt={selected?.filename ?? ''}
            className="h-16 w-16 rounded border border-gray-200 object-cover"
          />
        ) : (
          <span className="text-xs text-gray-500">画像なし</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-indigo-400"
        >
          {value ? '変更' : '画像を選択'}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:border-red-300 hover:text-red-600"
          >
            外す
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-2">
          <div className="flex flex-wrap gap-2">
            {(data?.items ?? []).map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => {
                  onChange(img.id);
                  setOpen(false);
                }}
                className="rounded border border-gray-200 hover:border-indigo-400"
              >
                <img src={img.url} alt={img.filename} className="h-12 w-12 object-cover" />
              </button>
            ))}
            {(data?.items ?? []).length === 0 && (
              <p className="text-xs text-gray-500">ライブラリに画像がありません。</p>
            )}
          </div>
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
            className="text-xs"
          />
          {uploading && <p className="text-xs text-gray-500">アップロード中…</p>}
          {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
        </div>
      )}
    </div>
  );
}
