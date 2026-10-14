import { useEffect, useState } from 'react';

// オフライン時にアプリ全体で表示するバナー（依頼: オフライン時のバナー表示）。
export function OfflineBanner() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white"
    >
      オフラインです。一部の機能が利用できない場合があります。
    </div>
  );
}
