import Image from 'next/image';
import Link from 'next/link';

const LOGO_SCALE_FACTOR = 2.5;
const scaleLogoSize = (size: number, multiplier = 1) => Math.round(size * LOGO_SCALE_FACTOR * multiplier);

type ProgramItem = {
  href: string;
  label: string;
  logoSrc: string;
  logoWidth: number;
  logoHeight: number;
  logoClass: string;
  logoFrameClass: string;
  renderGraphic?: () => JSX.Element;
};

const PROGRAM_ITEMS: readonly ProgramItem[] = [
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
    logoFrameClass: 'bg-transparent',
    renderGraphic: renderBlueOriginGraphic
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
              {item.renderGraphic ? (
                item.renderGraphic()
              ) : (
                <Image
                  src={item.logoSrc}
                  alt={`${item.label} official logo`}
                  width={item.logoWidth}
                  height={item.logoHeight}
                  className={`h-auto w-auto max-w-full object-contain ${item.logoClass}`}
                />
              )}
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

function renderBlueOriginGraphic() {
  return (
    <span className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-[#315be0]/45 bg-[radial-gradient(circle_at_left,rgba(67,118,255,0.5),rgba(14,20,39,0.96)_62%)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[rgba(255,255,255,0.08)] shadow-[0_0_22px_rgba(58,103,240,0.32)]">
        <Image
          src="/assets/program-logos/blueorigin-official.png"
          alt="Blue Origin official logo"
          width={32}
          height={32}
          className="h-auto w-auto max-h-8 max-w-8 object-contain drop-shadow-[0_0_16px_rgba(69,120,255,0.48)]"
        />
      </span>
      <span className="flex min-w-0 flex-col items-start">
        <span className="text-[9px] font-semibold uppercase tracking-[0.32em] text-[#b8cbff]">Blue</span>
        <span className="text-sm font-semibold uppercase tracking-[0.18em] text-white">Origin</span>
      </span>
    </span>
  );
}
