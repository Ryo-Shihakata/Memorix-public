import type { PlayPayload } from '@memorix/shared';

// PlayPayload を取得できる API は POST /api/sessions（セッション開始）のみで、
// 開始済みセッションを再取得する GET は存在しない（§7.3, §8.1）。
// そのためリロード・結果画面での「問題ごとの表示」のためにクライアント側で
// sessionId をキーに payload をキャッシュしておく（同一ブラウザでのみ有効）。

export interface PlaySource {
  quizSetId?: string;
  shareToken?: string;
}

export interface PlayCacheEntry {
  payload: PlayPayload;
  source: PlaySource;
}

const PREFIX = 'memorix:play:';

export function savePlayCache(sessionId: string, entry: PlayCacheEntry): void {
  try {
    localStorage.setItem(`${PREFIX}${sessionId}`, JSON.stringify(entry));
  } catch {
    // ストレージ容量超過等は致命的ではないため無視する。
  }
}

export function loadPlayCache(sessionId: string): PlayCacheEntry | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as PlayCacheEntry;
  } catch {
    return null;
  }
}
