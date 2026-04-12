'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  calculateScrollToSection,
  calculateStickyNavState,
  type SectionVisibility
} from '@tminuszero/launch-animations';
import type { LaunchSectionId } from '@tminuszero/launch-detail-ui';

type LaunchSectionRailProps = {
  sections: Array<{ id: LaunchSectionId; label: string }>;
  topOffset?: number;
  navHeight?: number;
  stickyThreshold?: number;
  className?: string;
};

type LaunchSectionRailState = {
  activeSection: LaunchSectionId | null;
  isSticky: boolean;
  opacity: number;
};

export function LaunchSectionRail({
  sections,
  topOffset = 116,
  navHeight = 108,
  stickyThreshold = 200,
  className
}: LaunchSectionRailProps) {
  const [navState, setNavState] = useState<LaunchSectionRailState>(() => ({
    activeSection: sections[0]?.id ?? null,
    isSticky: false,
    opacity: 0
  }));

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

      const nextNavState = calculateStickyNavState(window.scrollY, stickyThreshold, sectionVisibility);
      const resolvedActiveSection = sections.find((section) => section.id === nextNavState.activeSection)?.id ?? visibleSections[0] ?? null;

      setNavState({
        activeSection: resolvedActiveSection,
        isSticky: nextNavState.isSticky,
        opacity: nextNavState.opacity
      });
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [sections, stickyThreshold, topOffset, visibleSections]);

  if (!sections.length) {
    return null;
  }

  return (
    <AnimatePresence initial={false}>
      {navState.isSticky ? (
        <motion.div
          initial={{ height: 0, opacity: 0, y: -10 }}
          animate={{ height: 'auto', opacity: navState.opacity, y: 0 }}
          exit={{ height: 0, opacity: 0, y: -10 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className={clsx('overflow-hidden', className)}
        >
          <motion.div
            animate={{ opacity: navState.opacity, scale: 0.985 + navState.opacity * 0.015 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative mt-2 rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
          >
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="flex min-w-max items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {sections.map((section) => {
                const isActive = navState.activeSection === section.id;
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
                      'group relative isolate rounded-full px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors duration-300',
                      isActive ? 'text-text1' : 'text-text3 hover:text-text1'
                    )}
                  >
                    {isActive ? (
                      <motion.span
                        layoutId="launch-section-rail-pill"
                        className="absolute inset-0 rounded-full border border-primary/35 bg-[linear-gradient(135deg,rgba(34,211,238,0.24),rgba(59,130,246,0.14))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_30px_rgba(14,165,233,0.18)]"
                        transition={{ type: 'spring', stiffness: 300, damping: 28, mass: 0.8 }}
                      />
                    ) : (
                      <span className="absolute inset-0 rounded-full border border-transparent transition duration-300 group-hover:border-white/10" />
                    )}
                    <span className="relative z-10">{section.label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
