import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StudioNav } from '../../components/studio/StudioNav';
import { api, errorMessage } from '../../lib/api';

interface PreviewResult {
  questionCount: number;
  blankCount: number;
  warnings: string[];
}
interface ConfirmResult {
  created: number;
  updated: number;
}

// /studio/:teamId/quizzes/:id/import: CSV(preview→confirm)。§10。
export function StudioImport() {
  const { teamId = '', quizId = '' } = useParams();
  const queryClient = useQueryClient();
  const textRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLInputElement>(null);
  const blanksRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);

  function buildForm(): FormData {
    const form = new FormData();
    const text = textRef.current?.files?.[0];
    const table = tableRef.current?.files?.[0];
    const blanks = blanksRef.current?.files?.[0];
    if (text) form.set('text_questions', text);
    if (table) form.set('table_questions', table);
    if (blanks) form.set('blanks', blanks);
    return form;
  }

  const previewMutation = useMutation({
    mutationFn: () =>
      api.postForm<PreviewResult>(
        `/teams/${teamId}/quiz-sets/${quizId}/import/preview`,
        buildForm(),
      ),
    onSuccess: (result) => {
      setPreview(result);
      setConfirmResult(null);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      api.postForm<ConfirmResult>(
        `/teams/${teamId}/quiz-sets/${quizId}/import/confirm`,
        buildForm(),
      ),
    onSuccess: (result) => {
      setConfirmResult(result);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ['studio-quiz', quizId] });
    },
  });

  return (
    <div className="mx-auto max-w-2xl p-4">
      <StudioNav teamId={teamId} />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">CSVインポート</h1>
        <Link
          to={`/studio/${teamId}/quizzes/${quizId}`}
          className="text-xs text-gray-500 hover:text-indigo-600"
        >
          クイズ設定に戻る
        </Link>
      </div>

      <div className="mb-4 rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
        <p className="mb-2 font-medium text-gray-700">テンプレートのダウンロード</p>
        <div className="flex flex-wrap gap-3 text-indigo-600">
          <a href="/templates/text_questions.csv" download className="hover:underline">
            テキスト問題テンプレ
          </a>
          <a href="/templates/table_questions.csv" download className="hover:underline">
            表問題テンプレ
          </a>
          <a href="/templates/blanks.csv" download className="hover:underline">
            空欄テンプレ
          </a>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="csv-text" className="mb-1 block text-xs font-medium text-gray-500">
            text_questions.csv
          </label>
          <input id="csv-text" ref={textRef} type="file" accept=".csv" className="text-sm" />
        </div>
        <div>
          <label htmlFor="csv-table" className="mb-1 block text-xs font-medium text-gray-500">
            table_questions.csv
          </label>
          <input id="csv-table" ref={tableRef} type="file" accept=".csv" className="text-sm" />
        </div>
        <div>
          <label htmlFor="csv-blanks" className="mb-1 block text-xs font-medium text-gray-500">
            blanks.csv
          </label>
          <input id="csv-blanks" ref={blanksRef} type="file" accept=".csv" className="text-sm" />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            プレビュー
          </button>
          <button
            type="button"
            onClick={() => confirmMutation.mutate()}
            disabled={!preview || confirmMutation.isPending}
            className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:border-indigo-400 disabled:opacity-50"
          >
            確定してインポート
          </button>
        </div>

        {previewMutation.isError && (
          <p className="text-xs text-red-600">{errorMessage(previewMutation.error)}</p>
        )}
        {confirmMutation.isError && (
          <p className="text-xs text-red-600">{errorMessage(confirmMutation.error)}</p>
        )}

        {preview && (
          <div className="rounded border border-gray-200 p-3 text-sm">
            <p>
              問題数 {preview.questionCount}・空欄数 {preview.blankCount}
            </p>
            {preview.warnings.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-amber-600">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {confirmResult && (
          <p className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            新規 {confirmResult.created}件・更新 {confirmResult.updated}件をインポートしました。
          </p>
        )}
      </div>
    </div>
  );
}
