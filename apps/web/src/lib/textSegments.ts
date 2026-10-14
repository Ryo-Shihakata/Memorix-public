// §12.1: text 型問題本文中の [b:N] マーカーをインライン入力に置換するための分割処理。
export type TextSegment = { type: 'text'; value: string } | { type: 'blank'; blankOrder: number };

export function parseTextSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /\[b:(\d+)\]/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null = regex.exec(text);
  while (m !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, m.index) });
    }
    const order = m[1];
    if (order !== undefined) {
      segments.push({ type: 'blank', blankOrder: Number(order) });
    }
    lastIndex = regex.lastIndex;
    m = regex.exec(text);
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}
