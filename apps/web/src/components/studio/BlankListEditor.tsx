import type { EditableBlank } from '../../lib/studioQuestionSave';
import { ImagePicker } from './ImagePicker';

// §12.2: 空欄リスト。正解候補は改行区切り、ヒントは任意（テキスト型・表型で共通）。
export function BlankListEditor({
  teamId,
  blanks,
  onChange,
}: {
  teamId: string;
  blanks: EditableBlank[];
  onChange: (blanks: EditableBlank[]) => void;
}) {
  function updateBlank(order: number, patch: Partial<EditableBlank>) {
    onChange(blanks.map((b) => (b.blankOrder === order ? { ...b, ...patch } : b)));
  }

  if (blanks.length === 0) {
    return <p className="text-xs text-gray-500">空欄はまだありません。</p>;
  }

  return (
    <div className="space-y-3">
      {[...blanks]
        .sort((a, b) => a.blankOrder - b.blankOrder)
        .map((b) => (
          <div key={b.blankOrder} className="rounded border border-gray-200 p-2">
            <p className="mb-1 text-xs font-semibold text-gray-500">空欄 {b.blankOrder}</p>
            <textarea
              aria-label={`空欄${b.blankOrder}の正解候補（改行区切り）`}
              value={b.acceptedAnswers.join('\n')}
              onChange={(e) =>
                updateBlank(b.blankOrder, {
                  acceptedAnswers: e.target.value.split('\n'),
                })
              }
              onBlur={(e) =>
                updateBlank(b.blankOrder, {
                  acceptedAnswers: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0),
                })
              }
              placeholder="正解候補（改行区切り）"
              rows={2}
              className="mb-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <input
              type="text"
              aria-label={`空欄${b.blankOrder}のヒント（任意）`}
              value={b.hint}
              onChange={(e) => updateBlank(b.blankOrder, { hint: e.target.value })}
              placeholder="ヒント（任意）"
              className="mb-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <div>
              <p className="mb-1 text-xs text-gray-500">ヒント画像（任意）</p>
              <ImagePicker
                teamId={teamId}
                value={b.hintImageId}
                onChange={(imageId) => updateBlank(b.blankOrder, { hintImageId: imageId })}
              />
            </div>
          </div>
        ))}
    </div>
  );
}
