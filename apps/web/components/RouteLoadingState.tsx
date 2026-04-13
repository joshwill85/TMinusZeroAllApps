import { OrbitalLoader } from '@/components/OrbitalLoader';

export function RouteLoadingState({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  void eyebrow;
  void title;
  void description;

  return (
    <div
      className="mx-auto flex min-h-[50vh] w-full max-w-5xl flex-col items-center justify-center gap-6 px-4 py-10 md:px-8"
      aria-busy="true"
    >
      <OrbitalLoader label={null} />
      <div className="w-full max-w-2xl space-y-3" aria-hidden="true">
        <div className="mx-auto h-3 w-28 rounded-full bg-[rgba(255,255,255,0.08)]" />
        <div className="mx-auto h-8 w-full max-w-md rounded-full bg-[rgba(255,255,255,0.12)]" />
        <div className="mx-auto h-4 w-full rounded-full bg-[rgba(255,255,255,0.07)]" />
        <div className="mx-auto h-4 w-[82%] rounded-full bg-[rgba(255,255,255,0.05)]" />
      </div>
    </div>
  );
}
