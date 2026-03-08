export function MissionControlEmptyState({
  title,
  detail
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-stroke-strong bg-surface-0 px-4 py-6 text-center">
      <p className="text-sm font-semibold text-text1">{title}</p>
      <p className="mt-1 text-xs text-text3">{detail}</p>
    </div>
  );
}
