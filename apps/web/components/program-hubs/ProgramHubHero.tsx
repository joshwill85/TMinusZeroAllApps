import type { ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';

type ProgramHubTheme = 'spacex' | 'blue-origin' | 'artemis';

type ProgramHubBadge = {
  label: string;
  tone?: 'default' | 'accent' | 'success' | 'warning';
};

type ProgramHubMetric = {
  label: string;
  value: string;
  detail?: string;
};

type ProgramHubRoute = {
  href: string;
  label: string;
  description: string;
  eyebrow?: string;
};

type ProgramHubSecondaryLink = {
  href: string;
  label: string;
};

type ProgramHubHeroProps = {
  theme: ProgramHubTheme;
  eyebrow: string;
  title: string;
  description: string;
  logo: ReactNode;
  badges?: ProgramHubBadge[];
  metrics: ProgramHubMetric[];
  routes: ProgramHubRoute[];
  secondaryLinks?: ProgramHubSecondaryLink[];
  routesTitle?: string;
  routesDescription?: string;
  footnote?: ReactNode;
};

const THEME_STYLES: Record<
  ProgramHubTheme,
  {
    frameClassName: string;
    orbPrimaryClassName: string;
    orbSecondaryClassName: string;
    gridGlowClassName: string;
    logoFrameClassName: string;
    metricClassName: string;
    metricValueClassName: string;
    accentBadgeClassName: string;
    accentTextClassName: string;
    routeClassName: string;
    routeEyebrowClassName: string;
    routeArrowClassName: string;
    secondaryLinkClassName: string;
  }
> = {
  spacex: {
    frameClassName:
      'border-primary/20 bg-[linear-gradient(135deg,rgba(2,10,18,0.98),rgba(6,18,34,0.96)_44%,rgba(7,9,19,0.94))] shadow-[0_34px_110px_rgba(34,211,238,0.12)]',
    orbPrimaryClassName:
      'bg-[radial-gradient(circle,rgba(34,211,238,0.22),rgba(34,211,238,0)_70%)]',
    orbSecondaryClassName:
      'bg-[radial-gradient(circle,rgba(168,244,255,0.14),rgba(168,244,255,0)_74%)]',
    gridGlowClassName:
      'bg-[linear-gradient(125deg,rgba(255,255,255,0.08),rgba(255,255,255,0)_32%),linear-gradient(90deg,rgba(34,211,238,0.14),rgba(34,211,238,0)_45%)]',
    logoFrameClassName:
      'border-primary/[0.18] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] shadow-[0_20px_55px_rgba(34,211,238,0.12)]',
    metricClassName: 'border-white/10 bg-[rgba(255,255,255,0.04)]',
    metricValueClassName: 'text-primary',
    accentBadgeClassName: 'border-primary/30 bg-primary/10 text-primary',
    accentTextClassName: 'text-primary',
    routeClassName:
      'border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] hover:border-primary/40 hover:bg-[linear-gradient(180deg,rgba(34,211,238,0.12),rgba(255,255,255,0.03))]',
    routeEyebrowClassName: 'text-primary/[0.85]',
    routeArrowClassName:
      'border-primary/[0.22] bg-primary/10 text-primary group-hover:border-primary/40 group-hover:bg-primary/15',
    secondaryLinkClassName:
      'border-white/10 bg-white/[0.03] hover:border-primary/[0.35] hover:text-text1'
  },
  'blue-origin': {
    frameClassName:
      'border-[#4f79ff]/[0.18] bg-[linear-gradient(135deg,rgba(7,11,24,0.98),rgba(13,24,56,0.96)_42%,rgba(7,9,19,0.95))] shadow-[0_34px_110px_rgba(79,121,255,0.12)]',
    orbPrimaryClassName:
      'bg-[radial-gradient(circle,rgba(111,147,255,0.22),rgba(111,147,255,0)_70%)]',
    orbSecondaryClassName:
      'bg-[radial-gradient(circle,rgba(193,208,255,0.14),rgba(193,208,255,0)_74%)]',
    gridGlowClassName:
      'bg-[linear-gradient(125deg,rgba(255,255,255,0.08),rgba(255,255,255,0)_30%),linear-gradient(90deg,rgba(95,128,255,0.14),rgba(95,128,255,0)_48%)]',
    logoFrameClassName:
      'border-[#5f80ff]/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] shadow-[0_20px_55px_rgba(79,121,255,0.12)]',
    metricClassName: 'border-white/10 bg-[rgba(255,255,255,0.04)]',
    metricValueClassName: 'text-[#b9c7ff]',
    accentBadgeClassName: 'border-[#6f93ff]/30 bg-[#6f93ff]/10 text-[#b9c7ff]',
    accentTextClassName: 'text-[#b9c7ff]',
    routeClassName:
      'border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] hover:border-[#6f93ff]/40 hover:bg-[linear-gradient(180deg,rgba(95,128,255,0.12),rgba(255,255,255,0.03))]',
    routeEyebrowClassName: 'text-[#b9c7ff]',
    routeArrowClassName:
      'border-[#6f93ff]/[0.22] bg-[#6f93ff]/10 text-[#b9c7ff] group-hover:border-[#6f93ff]/40 group-hover:bg-[#6f93ff]/15',
    secondaryLinkClassName:
      'border-white/10 bg-white/[0.03] hover:border-[#6f93ff]/[0.35] hover:text-text1'
  },
  artemis: {
    frameClassName:
      'border-[#f0c97c]/[0.18] bg-[linear-gradient(135deg,rgba(15,13,9,0.98),rgba(33,24,14,0.96)_44%,rgba(10,11,18,0.95))] shadow-[0_34px_110px_rgba(240,201,124,0.12)]',
    orbPrimaryClassName:
      'bg-[radial-gradient(circle,rgba(240,201,124,0.24),rgba(240,201,124,0)_70%)]',
    orbSecondaryClassName:
      'bg-[radial-gradient(circle,rgba(255,232,183,0.14),rgba(255,232,183,0)_74%)]',
    gridGlowClassName:
      'bg-[linear-gradient(125deg,rgba(255,255,255,0.08),rgba(255,255,255,0)_32%),linear-gradient(90deg,rgba(240,201,124,0.14),rgba(240,201,124,0)_48%)]',
    logoFrameClassName:
      'border-[#f0c97c]/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] shadow-[0_20px_55px_rgba(240,201,124,0.12)]',
    metricClassName: 'border-white/10 bg-[rgba(255,255,255,0.04)]',
    metricValueClassName: 'text-[#f5d998]',
    accentBadgeClassName: 'border-[#f0c97c]/30 bg-[#f0c97c]/10 text-[#f5d998]',
    accentTextClassName: 'text-[#f5d998]',
    routeClassName:
      'border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] hover:border-[#f0c97c]/40 hover:bg-[linear-gradient(180deg,rgba(240,201,124,0.12),rgba(255,255,255,0.03))]',
    routeEyebrowClassName: 'text-[#f5d998]',
    routeArrowClassName:
      'border-[#f0c97c]/[0.22] bg-[#f0c97c]/10 text-[#f5d998] group-hover:border-[#f0c97c]/40 group-hover:bg-[#f0c97c]/15',
    secondaryLinkClassName:
      'border-white/10 bg-white/[0.03] hover:border-[#f0c97c]/[0.35] hover:text-text1'
  }
};

const BADGE_TONE_CLASSNAMES: Record<NonNullable<ProgramHubBadge['tone']>, string> = {
  default: 'border-white/12 bg-white/5 text-text2',
  accent: '',
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/25 bg-warning/10 text-warning'
};

export function ProgramHubHero({
  theme,
  eyebrow,
  title,
  description,
  logo,
  badges = [],
  metrics,
  routes,
  secondaryLinks = [],
  routesTitle = 'Navigate the program',
  routesDescription = 'Jump directly into the strongest route families for this hub.',
  footnote
}: ProgramHubHeroProps) {
  const styles = THEME_STYLES[theme];

  return (
    <section className={clsx('relative overflow-hidden rounded-[2rem] border p-6 sm:p-8 xl:p-10', styles.frameClassName)}>
      <div className={clsx('pointer-events-none absolute -right-20 top-[-7rem] h-72 w-72 rounded-full blur-2xl', styles.orbPrimaryClassName)} />
      <div className={clsx('pointer-events-none absolute bottom-[-7rem] left-[-4rem] h-64 w-64 rounded-full blur-2xl', styles.orbSecondaryClassName)} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.03))]" />
      <div className={clsx('pointer-events-none absolute inset-0 opacity-70', styles.gridGlowClassName)} />

      <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,26rem)]">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={clsx(
                'flex h-16 w-16 items-center justify-center rounded-[1.4rem] border sm:h-20 sm:w-20',
                styles.logoFrameClassName
              )}
            >
              {logo}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={clsx(
                  'inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em]',
                  styles.accentBadgeClassName
                )}
              >
                {eyebrow}
              </span>
              {badges.map((badge) => (
                <span
                  key={`${badge.label}:${badge.tone ?? 'default'}`}
                  className={clsx(
                    'inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]',
                    badge.tone === 'accent' ? styles.accentBadgeClassName : BADGE_TONE_CLASSNAMES[badge.tone ?? 'default']
                  )}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          </div>

          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-text1 sm:text-5xl lg:text-6xl">{title}</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-text2 sm:text-lg">{description}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className={clsx('rounded-[1.35rem] border p-4', styles.metricClassName)}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text4">{metric.label}</p>
                <p className={clsx('mt-3 text-2xl font-semibold tracking-[-0.03em]', styles.metricValueClassName)}>{metric.value}</p>
                {metric.detail ? <p className="mt-2 text-sm leading-6 text-text2">{metric.detail}</p> : null}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-white/10 bg-[rgba(6,9,18,0.56)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={clsx('text-[10px] font-semibold uppercase tracking-[0.24em]', styles.accentTextClassName)}>{routesTitle}</p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-text2">{routesDescription}</p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text3">
              {routes.length} routes
            </span>
          </div>

          <div className="mt-5 space-y-2.5">
            {routes.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className={clsx(
                  'group flex items-center justify-between gap-4 rounded-[1.3rem] border p-3 transition duration-200',
                  styles.routeClassName
                )}
              >
                <div className="min-w-0">
                  {route.eyebrow ? (
                    <p className={clsx('text-[10px] font-semibold uppercase tracking-[0.22em]', styles.routeEyebrowClassName)}>{route.eyebrow}</p>
                  ) : null}
                  <p className="mt-1 text-base font-semibold text-text1">{route.label}</p>
                  <p className="mt-1 text-sm leading-6 text-text2">{route.description}</p>
                </div>
                <span
                  aria-hidden="true"
                  className={clsx(
                    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-lg transition-transform group-hover:translate-x-1',
                    styles.routeArrowClassName
                  )}
                >
                  →
                </span>
              </Link>
            ))}
          </div>

          {secondaryLinks.length ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {secondaryLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={clsx(
                    'inline-flex rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-text2 transition',
                    styles.secondaryLinkClassName
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ) : null}

          {footnote ? <div className="mt-5 rounded-[1.2rem] border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm text-text2">{footnote}</div> : null}
        </div>
      </div>
    </section>
  );
}
