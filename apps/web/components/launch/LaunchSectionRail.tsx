'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  calculateScrollToSection,
  calculateStickyNavState,
  type SectionVisibility
} from '@tminuszero/launch-animations';
import type { VisibleLaunchSectionId } from '@tminuszero/launch-detail-ui';

type LaunchSectionRailProps = {
  sections: Array<{ id: VisibleLaunchSectionId; label: string }>;
  topOffset?: number;
  navHeight?: number;
  className?: string;
};

export function LaunchSectionRail({
  sections,
  topOffset = 88,
  navHeight = 56,
  className
}: LaunchSectionRailProps) {
  const [activeSection, setActiveSection] = useState<string | null>(sections[0]?.id ?? null);

  const visibleSections = useMemo(() => sections.map((section) => section.id), [sections]);

  useEffect(() => {
    if (!visibleSections.length) {
      return;
    }

    const update = () => {
      const sectionVisibility: SectionVisibility[] = visibleSections.map((sectionId) => {
        const element = document.getElementById(sectionId);
        if (!element) {
          return {
            sectionId,
            isVisible: false,
            visibilityRatio: 0,
            distanceFromTop: Number.POSITIVE_INFINITY
          };
        }

        const rect = element.getBoundingClientRect();
        const viewportHeight = window.innerHeight || 1;
        const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        const visibilityRatio = rect.height > 0 ? visibleHeight / rect.height : 0;

        return {
          sectionId,
          isVisible: visibleHeight > 0,
          visibilityRatio,
          distanceFromTop: rect.top - topOffset
        };
      });

      const navState = calculateStickyNavState(window.scrollY, 120, sectionVisibility);
      setActiveSection(navState.activeSection ?? visibleSections[0] ?? null);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [topOffset, visibleSections]);

  if (!sections.length) {
    return null;
  }

  return (
    <div
      className={clsx(
        'sticky z-20 overflow-x-auto rounded-full border border-stroke bg-[rgba(7,9,19,0.88)] px-2 py-2 shadow-[0_16px_50px_rgba(0,0,0,0.24)] backdrop-blur-xl',
        className
      )}
      style={{ top: topOffset }}
    >
      <div className="flex min-w-max items-center gap-2">
        {sections.map((section) => {
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => {
                const element = document.getElementById(section.id);
                if (!element) return;

                const targetScroll = calculateScrollToSection(
                  window.scrollY + element.getBoundingClientRect().top,
                  navHeight,
                  18
                );

                window.scrollTo({ top: targetScroll, behavior: 'smooth' });
              }}
              className={clsx(
                'rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] transition',
                isActive
                  ? 'border border-primary/40 bg-primary/10 text-primary'
                  : 'border border-transparent text-text2 hover:border-white/10 hover:text-text1'
              )}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
