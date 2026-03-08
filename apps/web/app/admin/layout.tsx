import type { Metadata } from 'next';
import AdminNav from './_components/AdminNav';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-stroke bg-surface-0/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-[0.1em] text-text3">Admin</span>
          </div>
          <AdminNav />
        </div>
      </header>
      {children}
    </div>
  );
}
