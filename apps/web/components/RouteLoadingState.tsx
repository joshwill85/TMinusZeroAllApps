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
  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-5xl flex-col items-center justify-center gap-6 px-4 py-10 text-center md:px-8">
      <OrbitalLoader label={title} />
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.14em] text-text3">{eyebrow}</p>
        <h1 className="text-2xl font-semibold text-text1">{title}</h1>
        <p className="max-w-2xl text-sm text-text2">{description}</p>
      </div>
    </div>
  );
}
