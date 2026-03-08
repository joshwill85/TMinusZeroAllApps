'use client';

import { useEffect, useState } from 'react';

const SECTIONS = [
  { id: 'manifest', label: '01 MANIFEST', count: null },
  { id: 'hardware', label: '02 HARDWARE', count: null },
  { id: 'procurement', label: '03 PROCUREMENT', count: null },
  { id: 'timeline', label: '04 TIMELINE', count: null },
  { id: 'media', label: '05 MEDIA', count: null }
];

export function BlueOriginJumpRail({ 
  counts,
  variant = 'both'
}: { 
  counts?: { [key: string]: number | null };
  variant?: 'desktop' | 'mobile' | 'both';
}) {
  const [activeSection, setActiveSection] = useState<string>('manifest');

  useEffect(() => {
    const observerOptions = {
      root: null,
      rootMargin: '-20% 0px -70% 0px',
      threshold: 0
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveSection(entry.target.id);
        }
      });
    }, observerOptions);

    SECTIONS.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const offset = 80; // Account for any sticky headers
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = element.getBoundingClientRect().top;
      const elementPosition = elementRect - bodyRect;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  };

  return (
    <>
      {(variant === 'desktop' || variant === 'both') && (
        <nav className="sticky top-24 hidden h-fit w-48 flex-col gap-1 border-l border-stroke pl-4 md:flex">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-text3">Navigation</p>
          {SECTIONS.map((section) => {
            const isActive = activeSection === section.id;
            const count = counts?.[section.id];

            return (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className={`flex items-center justify-between py-1.5 text-left text-[11px] font-medium tracking-wider transition-colors hover:text-primary ${
                  isActive ? 'text-primary' : 'text-text2'
                }`}
              >
                <span>{section.label}</span>
                {count != null && (
                  <span className={`ml-2 rounded-sm px-1.5 py-0.5 text-[9px] ${
                    isActive ? 'bg-primary/10 text-primary' : 'bg-surface-2 text-text3'
                  }`}>
                    {count}
                  </span>
                )}
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
              const count = counts?.[section.id];
              return (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                    isActive
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-stroke bg-surface-1 text-text2'
                  }`}
                >
                  <span>{section.label.split(' ')[0]}</span>
                  {count != null ? <span className="font-mono text-[9px] text-text3">{count}</span> : null}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
