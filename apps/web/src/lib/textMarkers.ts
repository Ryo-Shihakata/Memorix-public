// §12.2 Studio エディタ: textarea 選択→「空欄にする」で使う [b:N] マーカー操作。
// サーバー側(apps/worker/src/lib/quizAccess.ts extractMarkerOrders)と同じ正規表現を使う。
const MARKER_RE = /\[b:(\d+)\]/g;

export function extractMarkerOrders(text: string): Set<number> {
  const orders = new Set<number>();
  for (const m of text.matchAll(MARKER_RE)) {
    const order = m[1];
    if (order !== undefined) orders.add(Number(order));
  }
  return orders;
}

// 未使用の最小のN(1始まり)を返す。
export function nextUnusedOrder(usedOrders: Iterable<number>): number {
  const used = new Set(usedOrders);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

// selectionStart..selectionEnd の選択範囲を [b:N] に置換する。
export function insertBlankMarker(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  order: number,
): { text: string; cursorPos: number } {
  const marker = `[b:${order}]`;
  const next = text.slice(0, selectionStart) + marker + text.slice(selectionEnd);
  return { text: next, cursorPos: selectionStart + marker.length };
}
