// §8.4 フロントの入力保護。
// キー memorix:draft:{sessionId} に {answers, focusedAt} を debounce 500ms で保存し、マウント時に復元する。

export interface DraftState {
  answers: Record<string, string>;
  focusedAt: Record<string, number>;
}

function draftKey(sessionId: string): string {
  return `memorix:draft:${sessionId}`;
}

export function loadDraft(sessionId: string): DraftState {
  try {
    const raw = localStorage.getItem(draftKey(sessionId));
    if (!raw) return { answers: {}, focusedAt: {} };
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    return {
      answers: parsed.answers ?? {},
      focusedAt: parsed.focusedAt ?? {},
    };
  } catch {
    return { answers: {}, focusedAt: {} };
  }
}

export function saveDraft(sessionId: string, state: DraftState): void {
  try {
    localStorage.setItem(draftKey(sessionId), JSON.stringify(state));
  } catch {
    // 容量超過等は致命的ではないため無視する。
  }
}

export function clearDraft(sessionId: string): void {
  try {
    localStorage.removeItem(draftKey(sessionId));
  } catch {
    // 無視する。
  }
}
