import { useModalA11y } from '../hooks/useModalA11y';

// a11y: Escで閉じる・フォーカストラップ（依頼: lightboxのEsc閉じ）。
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const containerRef = useModalA11y<HTMLDivElement>(onClose);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt || '画像'}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 focus:outline-none"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-zoom-out"
        aria-label="閉じる"
        onClick={onClose}
      />
      <img src={src} alt={alt} className="relative max-h-full max-w-full rounded object-contain" />
    </div>
  );
}
