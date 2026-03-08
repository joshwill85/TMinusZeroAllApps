import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">404</p>
        <h1 className="text-3xl font-semibold text-text1">Page not found</h1>
        <p className="max-w-prose text-sm text-text2">
          That link doesn&apos;t exist on {BRAND_NAME}. Jump back to the schedule or browse launch details.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Link href="/#schedule" className="btn rounded-lg px-4 py-2 text-sm">
          Back to schedule
        </Link>
        <Link href="/docs/faq" className="btn-secondary rounded-lg px-4 py-2 text-sm">
          FAQ
        </Link>
        <Link href="/about" className="btn-secondary rounded-lg px-4 py-2 text-sm">
          About
        </Link>
      </div>
    </div>
  );
}

