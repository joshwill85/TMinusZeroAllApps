import Image from 'next/image';
import Link from 'next/link';

const LOGO_SCALE_FACTOR = 2.5;
const scaleLogoSize = (size: number, multiplier = 1) => Math.round(size * LOGO_SCALE_FACTOR * multiplier);

const PROGRAM_ITEMS = [
  {
    href: '/artemis',
    label: 'Artemis Program',
    logoSrc: '/assets/program-logos/artemis-nasa-official.png',
    logoWidth: scaleLogoSize(58),
    logoHeight: scaleLogoSize(54),
    logoClass: '',
    logoFrameClass: 'bg-transparent'
  },
  {
    href: '/spacex',
    label: 'SpaceX Program',
    logoSrc: '/assets/program-logos/spacex-official.png',
    logoWidth: scaleLogoSize(76, 2.5),
    logoHeight: scaleLogoSize(24, 2.5),
    logoClass: '',
    logoFrameClass: 'bg-transparent'
  },
  {
    href: '/blue-origin',
    label: 'Blue Origin Program',
    logoSrc: '/assets/program-logos/blueorigin-official.png',
    logoWidth: scaleLogoSize(36),
    logoHeight: scaleLogoSize(36),
    logoClass: '',
    logoFrameClass: 'bg-transparent'
  }
] as const;

export function ProgramHubDock() {
  return (
    <section className="py-1">
      <div className="flex w-full flex-nowrap items-center gap-2 sm:w-auto">
        {PROGRAM_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="inline-flex min-w-0 flex-1 items-center justify-center rounded-xl px-2 py-1.5 transition-opacity hover:opacity-85"
            aria-label={item.label}
            title={item.label}
          >
            <span className={`inline-flex w-full items-center justify-center overflow-hidden rounded-md ${item.logoFrameClass}`}>
              <Image
                src={item.logoSrc}
                alt={`${item.label} official logo`}
                width={item.logoWidth}
                height={item.logoHeight}
                className={`h-auto w-auto max-w-full object-contain ${item.logoClass}`}
              />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
