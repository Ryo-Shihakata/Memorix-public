import type { PlayPayload } from '@memorix/shared';
import { useState } from 'react';
import { parseTextSegments } from '../lib/textSegments';
import { AutoGrowInput } from './AutoGrowInput';
import { Lightbox } from './Lightbox';

type PlayQuestion = PlayPayload['questions'][number];

function QuestionImage({
  image,
  title,
}: {
  image: NonNullable<PlayQuestion['image']>;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block">
        <img
          src={image.url}
          alt={image.caption ?? title}
          className="max-h-72 w-auto rounded border border-gray-200 object-contain"
        />
      </button>
      {open && (
        <Lightbox src={image.url} alt={image.caption ?? title} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function TextQuestionBody({
  question,
  answers,
  onFocusBlank,
  onChangeBlank,
}: {
  question: PlayQuestion;
  answers: Record<string, string>;
  onFocusBlank: (blankId: string) => void;
  onChangeBlank: (blankId: string, value: string) => void;
}) {
  const blankByOrder = new Map(question.blanks.map((b) => [b.blankOrder, b]));
  const segments = parseTextSegments(question.textContent ?? '');

  return (
    <p className="whitespace-pre-wrap leading-loose text-gray-900">
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          // biome-ignore lint/suspicious/noArrayIndexKey: 静的テキスト断片で安定した他のキーが無い
          return <span key={i}>{seg.value}</span>;
        }
        const blank = blankByOrder.get(seg.blankOrder);
        if (!blank) return null;
        return (
          <AutoGrowInput
            key={blank.id}
            value={answers[blank.id] ?? ''}
            onFocus={() => onFocusBlank(blank.id)}
            onChange={(v) => onChangeBlank(blank.id, v)}
          />
        );
      })}
    </p>
  );
}

function TableQuestionBody({
  question,
  answers,
  onFocusBlank,
  onChangeBlank,
}: {
  question: PlayQuestion;
  answers: Record<string, string>;
  onFocusBlank: (blankId: string) => void;
  onChangeBlank: (blankId: string, value: string) => void;
}) {
  const cells = question.cells ?? [];
  const rowCount = cells.reduce((n, c) => Math.max(n, c.rowIndex + 1), 0);
  const colCount = cells.reduce((n, c) => Math.max(n, c.colIndex + 1), 0);
  const cellMap = new Map(cells.map((c) => [`${c.rowIndex}-${c.colIndex}`, c]));

  const rows = Array.from({ length: rowCount }, (_, r) => r);
  const cols = Array.from({ length: colCount }, (_, c) => c);

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              {cols.map((c) => {
                const cell = cellMap.get(`${r}-${c}`);
                if (!cell) {
                  return <td key={c} className="border border-gray-200 p-2" />;
                }
                if (cell.cellType === 'header') {
                  return (
                    <th
                      key={c}
                      className="border border-gray-200 bg-gray-100 p-2 text-center font-bold"
                    >
                      {cell.content}
                    </th>
                  );
                }
                if (cell.cellType === 'blank' && cell.blankId) {
                  return (
                    <td key={c} className="border border-gray-200 p-2 text-center">
                      <AutoGrowInput
                        value={answers[cell.blankId] ?? ''}
                        onFocus={() => onFocusBlank(cell.blankId as string)}
                        onChange={(v) => onChangeBlank(cell.blankId as string, v)}
                      />
                    </td>
                  );
                }
                if (cell.cellType === 'image' && cell.imageUrl) {
                  return (
                    <td key={c} className="border border-gray-200 p-2 text-center">
                      <QuestionImage
                        image={{ url: cell.imageUrl, position: 'above', caption: null }}
                        title={question.title ?? ''}
                      />
                    </td>
                  );
                }
                return (
                  <td key={c} className="border border-gray-200 p-2">
                    {cell.content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlayQuestionView({
  question,
  index,
  answers,
  onFocusBlank,
  onChangeBlank,
}: {
  question: PlayQuestion;
  index: number;
  answers: Record<string, string>;
  onFocusBlank: (blankId: string) => void;
  onChangeBlank: (blankId: string, value: string) => void;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-500">
        問題 {index + 1}
        {question.title ? `　${question.title}` : ''}
      </h2>

      {question.image && question.image.position === 'above' && (
        <QuestionImage image={question.image} title={question.title ?? ''} />
      )}

      {question.type === 'text' ? (
        <TextQuestionBody
          question={question}
          answers={answers}
          onFocusBlank={onFocusBlank}
          onChangeBlank={onChangeBlank}
        />
      ) : (
        <TableQuestionBody
          question={question}
          answers={answers}
          onFocusBlank={onFocusBlank}
          onChangeBlank={onChangeBlank}
        />
      )}

      {question.image && question.image.position === 'below' && (
        <QuestionImage image={question.image} title={question.title ?? ''} />
      )}
    </section>
  );
}
