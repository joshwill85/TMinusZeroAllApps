import Image from 'next/image';
import Link from 'next/link';

type ProgramKey = 'artemis' | 'spacex' | 'blue-origin';

const PROGRAM_META: Record<
  ProgramKey,
  {
    href: string;
    label: string;
    logoSrc: string;
    logoWidth: number;
    logoHeight: number;
    logoFrameClass: string;
  }
> = {
  artemis: {
    href: '/artemis',
    label: 'Artemis Hub',
    logoSrc: '/assets/program-logos/artemis-nasa-official.png',
    logoWidth: 58,
    logoHeight: 54,
    logoFrameClass: 'bg-[#08152a]'
  },
  spacex: {
    href: '/spacex',
    label: 'SpaceX Hub',
    logoSrc: '/assets/program-logos/spacex-official.png',
    logoWidth: 76,
    logoHeight: 24,
    logoFrameClass: 'bg-[#0b1220]'
  },
  'blue-origin': {
    href: '/blue-origin',
    label: 'Blue Origin Hub',
    logoSrc: '/assets/program-logos/blueorigin-official.png',
    logoWidth: 36,
    logoHeight: 36,
    logoFrameClass: 'bg-[#0b1630]'
  }
};

export function ProgramHubBackLink({ program }: { program: ProgramKey }) {
  const meta = PROGRAM_META[program];
  return (
    <Link
      href={meta.href}
      aria-label={`Back to ${meta.label}`}
      title={`Back to ${meta.label}`}
      className="inline-flex w-fit items-center rounded-xl border border-stroke bg-surface-0 p-1.5 transition hover:border-primary/60 hover:bg-[rgba(255,255,255,0.05)]"
    >
      <span className={`inline-flex h-10 w-16 items-center justify-center rounded-md border border-stroke/60 ${meta.logoFrameClass}`}>
        <Image
          src={meta.logoSrc}
          alt={`${meta.label} logo`}
          width={meta.logoWidth}
          height={meta.logoHeight}
          className="h-auto max-h-8 w-auto max-w-14 object-contain"
        />
      </span>
    </Link>
  );
}
