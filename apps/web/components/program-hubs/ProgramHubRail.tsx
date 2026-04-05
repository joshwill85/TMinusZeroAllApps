'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';

type ProgramHubTheme = 'spacex' | 'blue-origin';

export type ProgramHubRailSection = {
  id: string;
  label: string;
  shortLabel?: string;
  count?: number | null;
};

type ProgramHubRailProps = {
  theme: ProgramHubTheme;
  sections: ProgramHubRailSection[];
  variant?: 'desktop' | 'mobile' | 'both';
  label?: string;
};

const THEME_STYLES: Record<
  ProgramHubTheme,
  {
    accentClassName: string;
    desktopActiveClassName: string;
    desktopChipActiveClassName: string;
    desktopChipInactiveClassName: string;
    mobileActiveClassName: string;
    mobileInactiveClassName: string;
  }
> = {
  spacex: {
    accentClassName: 'text-primary',
    desktopActiveClassName: 'text-primary',
    desktopChipActiveClassName: 'bg-primary/10 text-primary',
    desktopChipInactiveClassName: 'bg-surface-2 text-text3',
    mobileActiveClassName: 'border-primary/50 bg-primary/10 text-primary',
    mobileInactiveClassName: 'border-stroke bg-surface-1 text-text2'
  },
  'blue-origin': {
    accentClassName: 'text-[#b9c7ff]',
    desktopActiveClassName: 'text-[#b9c7ff]',
    desktopChipActiveClassName: 'bg-[#6f93ff]/10 text-[#b9c7ff]',
    desktopChipInactiveClassName: 'bg-surface-2 text-text3',
    mobileActiveClassName: 'border-[#6f93ff]/50 bg-[#6f93ff]/10 text-[#b9c7ff]',
    mobileInactiveClassName: 'border-stroke bg-surface-1 text-text2'
  }
};

export function ProgramHubRail({
  theme,
  sections,
  variant = 'both',
  label = 'Sections'
}: ProgramHubRailProps) {
  const styles = THEME_STYLES[theme];
  const [activeSection, setActiveSection] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    if (!sections.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      {
        root: null,
        rootMargin: '-18% 0px -68% 0px',
        threshold: 0
      }
    );

    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [sections]);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (!element) return;

    const offset = 88;
    const bodyTop = document.body.getBoundingClientRect().top;
    const elementTop = element.getBoundingClientRect().top;
    const offsetTop = elementTop - bodyTop - offset;

    window.scrollTo({
      top: offsetTop,
      behavior: 'smooth'
    });
  };

  return (
    <>
      {(variant === 'desktop' || variant === 'both') && (
        <nav className="sticky top-24 hidden md:block">
          <div className="w-56 rounded-[1.75rem] border border-white/10 bg-[rgba(7,10,21,0.76)] p-4 shadow-surface backdrop-blur-xl">
            <p className={clsx('text-[10px] font-semibold uppercase tracking-[0.24em]', styles.accentClassName)}>{label}</p>
            <div className="mt-4 space-y-1.5">
              {sections.map((section) => {
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => scrollToSection(section.id)}
                    className={clsx(
                      'flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.18em] transition',
                      isActive ? 'bg-white/[0.04]' : 'text-text2 hover:bg-white/[0.03] hover:text-text1',
                      isActive && styles.desktopActiveClassName
                    )}
                    aria-label={`Jump to ${section.label}`}
                    aria-pressed={isActive}
                  >
                    <span>{section.label}</span>
                    {section.count != null ? (
                      <span
                        className={clsx(
                          'rounded-full px-2 py-1 text-[9px] font-semibold',
                          isActive ? styles.desktopChipActiveClassName : styles.desktopChipInactiveClassName
                        )}
                      >
                        {section.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </nav>
      )}

      {(variant === 'mobile' || variant === 'both') && (
        <nav className="sticky top-14 z-20 -mx-4 border-y border-stroke bg-[rgba(5,7,16,0.92)] px-4 py-2.5 backdrop-blur-xl md:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sections.map((section) => {
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollToSection(section.id)}
                  className={clsx(
                    'flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] transition',
                    isActive ? styles.mobileActiveClassName : styles.mobileInactiveClassName
                  )}
                  aria-label={`Jump to ${section.label}`}
                  aria-pressed={isActive}
                >
                  <span>{section.shortLabel ?? section.label}</span>
                  {section.count != null ? <span className="font-mono text-[9px] text-text3">{section.count}</span> : null}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
