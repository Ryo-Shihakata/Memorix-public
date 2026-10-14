import type { ReactNode } from 'react';
import { AdminGuard } from './AdminGuard';
import { AdminNav } from './AdminNav';

// /admin/* 各ページの共通枠（ガード＋タブナビ）。ページ本体はこの内側に置く。
export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminGuard>
      <div className="min-h-[70vh]">
        <AdminNav />
        <div className="mx-auto max-w-5xl p-4">{children}</div>
      </div>
    </AdminGuard>
  );
}
