import { useEffect, useRef } from 'react';

// モーダル/ライトボックス共通のa11yフック: Escで閉じる・Tabでフォーカスをコンテナ内に閉じ込める・
// 開いたときに最初のフォーカス可能要素へフォーカスし、閉じたときに元の要素へフォーカスを戻す。
export function useModalA11y<T extends HTMLElement>(onClose: () => void) {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function getFocusable(): HTMLElement[] {
      if (!container) return [];
      return Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    }

    const focusables = getFocusable();
    (focusables[0] ?? container)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return containerRef;
}
