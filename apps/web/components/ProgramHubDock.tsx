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
      <div className="grid w-full grid-cols-3 gap-2 sm:w-auto">
        {PROGRAM_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group inline-flex min-w-0 flex-1 flex-col items-stretch justify-center rounded-2xl border border-stroke bg-[linear-gradient(180deg,rgba(12,16,30,0.94),rgba(7,9,19,0.9))] px-2 py-2.5 shadow-glow transition duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:bg-[linear-gradient(180deg,rgba(18,24,42,0.98),rgba(9,12,24,0.96))] active:translate-y-0"
            aria-label={item.label}
            title={item.label}
          >
            <span
              className={`inline-flex min-h-[56px] w-full items-center justify-center overflow-hidden rounded-xl border border-white/6 bg-[rgba(255,255,255,0.03)] px-2 ${item.logoFrameClass}`}
            >
              <Image
                src={item.logoSrc}
                alt={`${item.label} official logo`}
                width={item.logoWidth}
                height={item.logoHeight}
                className={`h-auto w-auto max-w-full object-contain ${item.logoClass}`}
              />
            </span>
            <span className="mt-2 flex items-center justify-between gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-text2">
              <span className="truncate">{item.label.replace(' Program', '')}</span>
              <span
                aria-hidden="true"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-white/5 text-text3 transition group-hover:border-primary/40 group-hover:text-primary"
              >
                <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
                  <path d="M5 3.5 9.5 8 5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
