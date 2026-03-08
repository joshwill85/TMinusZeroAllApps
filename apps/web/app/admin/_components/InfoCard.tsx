export default function InfoCard({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className="text-sm font-semibold text-text1">{String(value)}</div>
    </div>
  );
}

