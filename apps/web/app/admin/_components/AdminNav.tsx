'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/access', label: 'Access' },
  { href: '/admin/usaspending', label: 'USASpending' },
  { href: '/admin/ops', label: 'Ops' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/billing', label: 'Billing' },
  { href: '/admin/coupons', label: 'Discounts' },
  { href: '/admin/feedback', label: 'Feedback' }
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminNav() {
  const pathname = usePathname() || '/admin';

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'rounded-full border px-3 py-1 text-xs uppercase tracking-[0.1em]',
              active ? 'border-primary/60 text-text1 bg-primary/10' : 'border-stroke text-text3 hover:text-text1'
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
