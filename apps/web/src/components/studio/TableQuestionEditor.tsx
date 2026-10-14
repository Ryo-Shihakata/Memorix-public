import type { CellType } from '@memorix/shared';
import { useState } from 'react';
import type { EditableCell, EditableQuestion } from '../../lib/studioQuestionSave';
import { nextUnusedOrder } from '../../lib/textMarkers';
import { BlankListEditor } from './BlankListEditor';
import { ImagePicker } from './ImagePicker';

const CELL_TYPE_LABEL: Record<CellType, string> = {
  text: 'テキスト',
  header: '見出し',
  blank: '空欄',
  image: '画像',
};

function emptyCell(rowIndex: number, colIndex: number): EditableCell {
  return { rowIndex, colIndex, cellType: 'text', content: '', imageId: null, blankOrder: null };
}

// §12.2 表型: 行×列グリッド（セルクリックで下に編集パネルを表示。D&Dの代わりに行列の追加/削除ボタン）。
export function TableQuestionEditor({
  teamId,
  question,
  onChange,
}: {
  teamId: string;
  question: EditableQuestion;
  onChange: (question: EditableQuestion) => void;
}) {
  const rowCount = question.cells.reduce((n, c) => Math.max(n, c.rowIndex + 1), 0);
  const colCount = question.cells.reduce((n, c) => Math.max(n, c.colIndex + 1), 0);
  const cellMap = new Map(question.cells.map((c) => [`${c.rowIndex}-${c.colIndex}`, c]));
  const [activePos, setActivePos] = useState<{ r: number; c: number } | null>(null);

  function setCells(cells: EditableCell[]) {
    onChange({ ...question, cells });
  }

  function updateCell(r: number, c: number, patch: Partial<EditableCell>) {
    const key = `${r}-${c}`;
    const current = cellMap.get(key) ?? emptyCell(r, c);
    const next = { ...current, ...patch };
    setCells([
      ...question.cells.filter((cell) => `${cell.rowIndex}-${cell.colIndex}` !== key),
      next,
    ]);
  }

  function addRow() {
    const cells = [...question.cells];
    for (let c = 0; c < Math.max(colCount, 1); c++) {
      cells.push(emptyCell(rowCount, c));
    }
    setCells(cells);
  }

  function addCol() {
    const cells = [...question.cells];
    for (let r = 0; r < Math.max(rowCount, 1); r++) {
      cells.push(emptyCell(r, colCount));
    }
    setCells(cells);
  }

  function removeRow(r: number) {
    const removedOrders = question.cells
      .filter((c) => c.rowIndex === r && c.cellType === 'blank' && c.blankOrder !== null)
      .map((c) => c.blankOrder as number);
    const cells = question.cells
      .filter((c) => c.rowIndex !== r)
      .map((c) => (c.rowIndex > r ? { ...c, rowIndex: c.rowIndex - 1 } : c));
    setCells(cells);
    if (removedOrders.length > 0) {
      onChange({
        ...question,
        cells,
        blanks: question.blanks.filter((b) => !removedOrders.includes(b.blankOrder)),
      });
    }
    setActivePos(null);
  }

  function removeCol(c: number) {
    const removedOrders = question.cells
      .filter(
        (cell) => cell.colIndex === c && cell.cellType === 'blank' && cell.blankOrder !== null,
      )
      .map((cell) => cell.blankOrder as number);
    const cells = question.cells
      .filter((cell) => cell.colIndex !== c)
      .map((cell) => (cell.colIndex > c ? { ...cell, colIndex: cell.colIndex - 1 } : cell));
    setCells(cells);
    if (removedOrders.length > 0) {
      onChange({
        ...question,
        cells,
        blanks: question.blanks.filter((b) => !removedOrders.includes(b.blankOrder)),
      });
    }
    setActivePos(null);
  }

  function changeCellType(r: number, c: number, cellType: CellType) {
    const current = cellMap.get(`${r}-${c}`) ?? emptyCell(r, c);
    if (cellType === 'blank' && current.cellType !== 'blank') {
      const order = nextUnusedOrder(question.blanks.map((b) => b.blankOrder));
      onChange({
        ...question,
        cells: [
          ...question.cells.filter((cell) => `${cell.rowIndex}-${cell.colIndex}` !== `${r}-${c}`),
          { ...current, cellType, blankOrder: order, content: '', imageId: null },
        ],
        blanks: [
          ...question.blanks,
          { blankOrder: order, acceptedAnswers: [], hint: '', hintImageId: null },
        ],
      });
      return;
    }
    if (current.cellType === 'blank' && cellType !== 'blank' && current.blankOrder !== null) {
      const removedOrder = current.blankOrder;
      onChange({
        ...question,
        cells: [
          ...question.cells.filter((cell) => `${cell.rowIndex}-${cell.colIndex}` !== `${r}-${c}`),
          { ...current, cellType, blankOrder: null },
        ],
        blanks: question.blanks.filter((b) => b.blankOrder !== removedOrder),
      });
      return;
    }
    updateCell(r, c, { cellType });
  }

  const active = activePos
    ? (cellMap.get(`${activePos.r}-${activePos.c}`) ?? emptyCell(activePos.r, activePos.c))
    : null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={addRow}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-indigo-400"
        >
          + 行を追加
        </button>
        <button
          type="button"
          onClick={addCol}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-indigo-400"
        >
          + 列を追加
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <tbody>
            {Array.from({ length: rowCount }, (_, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 行インデックス自体が安定した識別子(行削除は配列を詰め直す)
              <tr key={r}>
                {Array.from({ length: colCount }, (_, c) => {
                  const cell = cellMap.get(`${r}-${c}`) ?? emptyCell(r, c);
                  const isActive = activePos?.r === r && activePos?.c === c;
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 列インデックス自体が安定した識別子
                    <td key={c} className="border border-gray-200 p-0">
                      <button
                        type="button"
                        data-testid={`studio-table-cell-${r}-${c}`}
                        onClick={() => setActivePos(isActive ? null : { r, c })}
                        className={`block min-h-[2.5rem] min-w-[4rem] p-2 text-center ${
                          isActive ? 'bg-indigo-50' : ''
                        } ${cell.cellType === 'header' ? 'font-bold' : ''} ${
                          cell.cellType === 'blank' ? 'text-indigo-600' : ''
                        }`}
                      >
                        {cell.cellType === 'blank'
                          ? `[空欄${cell.blankOrder}]`
                          : cell.cellType === 'image'
                            ? cell.imageId
                              ? '[画像]'
                              : '(画像未選択)'
                            : cell.content || '　'}
                      </button>
                    </td>
                  );
                })}
                <td className="border-none p-1">
                  <button
                    type="button"
                    onClick={() => removeRow(r)}
                    className="text-xs text-gray-500 hover:text-red-600"
                  >
                    行削除
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              {Array.from({ length: colCount }, (_, c) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 列インデックス自体が安定した識別子
                <td key={c} className="border-none p-1 text-center">
                  <button
                    type="button"
                    onClick={() => removeCol(c)}
                    className="text-xs text-gray-500 hover:text-red-600"
                  >
                    列削除
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {active && activePos && (
        <div className="space-y-2 rounded border border-indigo-200 bg-indigo-50 p-3">
          <p className="text-xs font-semibold text-indigo-700">
            セル ({activePos.r + 1}行目, {activePos.c + 1}列目)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CELL_TYPE_LABEL) as CellType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => changeCellType(activePos.r, activePos.c, t)}
                className={`rounded-full px-2 py-1 text-xs font-medium ${
                  active.cellType === t
                    ? 'bg-indigo-600 text-white'
                    : 'border border-gray-300 bg-white text-gray-600'
                }`}
              >
                {CELL_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          {active.cellType === 'text' || active.cellType === 'header' ? (
            <input
              type="text"
              value={active.content}
              onChange={(e) => updateCell(activePos.r, activePos.c, { content: e.target.value })}
              placeholder="セルの内容"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          ) : null}
          {active.cellType === 'image' && (
            <ImagePicker
              teamId={teamId}
              value={active.imageId}
              onChange={(imageId) => updateCell(activePos.r, activePos.c, { imageId })}
            />
          )}
          {active.cellType === 'blank' && (
            <p className="text-xs text-indigo-700">
              空欄 {active.blankOrder} として登録されています（下の空欄リストで正解を編集）。
            </p>
          )}
        </div>
      )}

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
