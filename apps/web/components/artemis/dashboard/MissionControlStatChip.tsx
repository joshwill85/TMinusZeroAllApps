import clsx from 'clsx';

export function MissionControlStatChip({
  label,
  tone = 'default',
  className
}: {
  label: string;
  tone?: 'default' | 'info' | 'success' | 'warning';
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em]',
        tone === 'default' && 'border-stroke text-text3',
        tone === 'info' && 'border-primary/40 bg-primary/10 text-text2',
        tone === 'success' && 'border-success/40 bg-success/10 text-text2',
        tone === 'warning' && 'border-warning/40 bg-warning/10 text-text2',
        className
      )}
    >
      {label}
    </span>
  );
}
