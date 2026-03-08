import Link from 'next/link';
import clsx from 'clsx';

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={clsx('text-xs text-text3', className)}>
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const key = `${index}-${item.label}`;

          return (
            <li key={key} className="flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden className="text-text4">
                  /
                </span>
              )}
              {isLast || !item.href ? (
                <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'text-text1' : undefined}>
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} className="transition hover:text-text1">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

