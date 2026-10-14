import type { BookmarkFolder } from '@memorix/shared';

// NOTE(既知のAPIギャップ): §7.1 は POST/PATCH/DELETE /api/me/bookmark-folders のみを定義し、
// 一覧取得 GET が存在しない（apps/worker/src/routes/me.ts 確認済み、チャンク7で未実装）。
// worker/shared はこのチャンクの変更範囲外のため追加できず、このブラウザで作成/リネームした
// フォルダのみを localStorage にキャッシュして表示する形で暫定対応する。
// 別ブラウザ・別デバイスで作成したフォルダはこの一覧に出てこない（folderId を直接知っていれば
// GET /me/bookmarks?folder_id= 自体は機能する）。恒久対応には GET 一覧APIの追加を推奨する。

const KEY = 'memorix:knownBookmarkFolders';

export function loadKnownFolders(): BookmarkFolder[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BookmarkFolder[];
  } catch {
    return [];
  }
}

function saveKnownFolders(folders: BookmarkFolder[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(folders));
  } catch {
    // 無視する。
  }
}

export function upsertKnownFolder(folder: BookmarkFolder): BookmarkFolder[] {
  const current = loadKnownFolders();
  const next = [...current.filter((f) => f.id !== folder.id), folder].sort(
    (a, b) => a.displayOrder - b.displayOrder,
  );
  saveKnownFolders(next);
  return next;
}

export function removeKnownFolder(folderId: string): BookmarkFolder[] {
  const next = loadKnownFolders().filter((f) => f.id !== folderId);
  saveKnownFolders(next);
  return next;
}
