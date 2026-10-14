import { useRef } from 'react';
import type { EditableQuestion } from '../../lib/studioQuestionSave';
import { extractMarkerOrders, insertBlankMarker, nextUnusedOrder } from '../../lib/textMarkers';
import { BlankListEditor } from './BlankListEditor';
import { ImagePicker } from './ImagePicker';

// §12.2 テキスト型: textarea 選択→「空欄にする」→未使用最小Nで[b:N]挿入+空欄リスト自動追加。
// 手書きマーカーも許容し、blur時にマーカー集合と空欄リストを同期する。
export function TextQuestionEditor({
  teamId,
  question,
  onChange,
}: {
  teamId: string;
  question: EditableQuestion;
  onChange: (question: EditableQuestion) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function makeBlank() {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const usedOrders = question.blanks.map((b) => b.blankOrder);
    const order = nextUnusedOrder(usedOrders);
    const { text, cursorPos } = insertBlankMarker(question.textContent, start, end, order);
    onChange({
      ...question,
      textContent: text,
      blanks: [
        ...question.blanks,
        { blankOrder: order, acceptedAnswers: [], hint: '', hintImageId: null },
      ],
    });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursorPos, cursorPos);
    });
  }

  function syncMarkersOnBlur() {
    const markerOrders = extractMarkerOrders(question.textContent);
    const existingOrders = new Set(question.blanks.map((b) => b.blankOrder));
    const sameSet =
      markerOrders.size === existingOrders.size &&
      [...markerOrders].every((o) => existingOrders.has(o));
    if (sameSet) return;

    let blanks = question.blanks.filter((b) => markerOrders.has(b.blankOrder));
    for (const order of markerOrders) {
      if (!existingOrders.has(order)) {
        blanks = [
          ...blanks,
          { blankOrder: order, acceptedAnswers: [], hint: '', hintImageId: null },
        ];
      }
    }
    onChange({ ...question, blanks });
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="text-content" className="text-xs font-medium text-gray-500">
            本文
          </label>
          <button
            type="button"
            onClick={makeBlank}
            className="rounded border border-indigo-300 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50"
          >
            選択範囲を空欄にする
          </button>
        </div>
        <textarea
          id="text-content"
          ref={textareaRef}
          value={question.textContent}
          onChange={(e) => onChange({ ...question, textContent: e.target.value })}
          onBlur={syncMarkersOnBlur}
          rows={5}
          maxLength={10000}
          placeholder="日本の首都は[b:1]である。"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-500">
          [b:N] を直接入力しても、フォーカスを外すと空欄リストに反映されます。
        </p>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">画像（任意）</p>
        <ImagePicker
          teamId={teamId}
          value={question.imageId}
          onChange={(imageId) => onChange({ ...question, imageId })}
        />
        {question.imageId && (
          <div className="mt-2 flex gap-2">
            <select
              aria-label="画像の表示位置"
              value={question.imagePosition}
              onChange={(e) =>
                onChange({ ...question, imagePosition: e.target.value as 'above' | 'below' })
              }
              className="rounded border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="above">本文の上</option>
              <option value="below">本文の下</option>
            </select>
            <input
              type="text"
              aria-label="画像のキャプション（任意）"
              value={question.imageCaption}
              onChange={(e) => onChange({ ...question, imageCaption: e.target.value })}
              placeholder="キャプション（任意）"
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
            />
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">空欄</p>
        <BlankListEditor
          teamId={teamId}
          blanks={question.blanks}
          onChange={(blanks) => onChange({ ...question, blanks })}
        />
      </div>
    </div>
  );
}
