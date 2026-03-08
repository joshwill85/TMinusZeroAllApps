'use client';

import { useEffect, useState } from 'react';

export type SpaceXHubSectionId =
  | 'mission'
  | 'recovery'
  | 'hardware'
  | 'media'
  | 'flights'
  | 'contracts'
  | 'finance'
  | 'faq';

const SECTIONS: Array<{ id: SpaceXHubSectionId; label: string }> = [
  { id: 'mission', label: '01 MISSION' },
  { id: 'recovery', label: '02 RECOVERY' },
  { id: 'hardware', label: '03 HARDWARE' },
  { id: 'media', label: '04 MEDIA' },
  { id: 'flights', label: '05 FLIGHTS' },
  { id: 'contracts', label: '06 CONTRACTS' },
  { id: 'finance', label: '07 FINANCE' },
  { id: 'faq', label: '08 FAQ' }
];

export function SpaceXJumpRail({
  counts,
  variant = 'both'
}: {
  counts: Record<SpaceXHubSectionId, number>;
  variant?: 'desktop' | 'mobile' | 'both';
}) {
  const [activeSection, setActiveSection] = useState<SpaceXHubSectionId>('mission');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && isSpaceXHubSectionId(entry.target.id)) {
            setActiveSection(entry.target.id);
          }
        });
      },
      {
        root: null,
        rootMargin: '-20% 0px -70% 0px',
        threshold: 0
      }
    );

    for (const section of SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }

    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: SpaceXHubSectionId) => {
    const element = document.getElementById(id);
    if (!element) return;

    const offset = 80;
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
        <nav className="sticky top-24 hidden h-fit w-52 flex-col gap-1 border-l border-stroke pl-4 md:flex">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-text3">Navigation</p>
          {SECTIONS.map((section) => {
            const isActive = activeSection === section.id;
            const count = counts[section.id];

            return (
              <button
                key={section.id}
                type="button"
                onClick={() => scrollToSection(section.id)}
                className={`flex items-center justify-between py-1.5 text-left text-[11px] font-medium tracking-wider transition-colors hover:text-primary ${
                  isActive ? 'text-primary' : 'text-text2'
                }`}
                aria-label={`Jump to ${section.label}`}
                aria-pressed={isActive}
              >
                <span>{section.label}</span>
                <span
                  className={`ml-2 rounded-sm px-1.5 py-0.5 text-[9px] ${
                    isActive ? 'bg-primary/10 text-primary' : 'bg-surface-2 text-text3'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {(variant === 'mobile' || variant === 'both') && (
        <nav className="sticky top-14 z-20 -mx-4 border-y border-stroke bg-surface-0/95 px-4 py-2 backdrop-blur md:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {SECTIONS.map((section) => {
              const isActive = activeSection === section.id;
              const count = counts[section.id];

              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollToSection(section.id)}
                  className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                    isActive
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-stroke bg-surface-1 text-text2'
                  }`}
                  aria-label={`Jump to ${section.label}`}
                  aria-pressed={isActive}
                >
                  <span>{section.label.split(' ')[1]}</span>
                  <span className="font-mono text-[9px] text-text3">{count}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}

function isSpaceXHubSectionId(value: string): value is SpaceXHubSectionId {
  return SECTIONS.some((section) => section.id === value);
}
