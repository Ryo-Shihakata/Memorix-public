// D1 スキーマの DEFAULT (lower(hex(randomblob(16)))) と同形式の 32 文字 hex ID。
// アプリ層で子テーブルの FK に使うため、INSERT 前に生成する。
export function newId(): string {
  return randomHex(16);
}

// nBytes バイトのランダム値を hex 文字列にする（セッション ID は 32 バイト）
export function randomHex(nBytes: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(nBytes));
  let s = '';
  for (const b of bytes) {
    s += b.toString(16).padStart(2, '0');
  }
  return s;
}
