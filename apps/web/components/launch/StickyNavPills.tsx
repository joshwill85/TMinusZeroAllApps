'use client';

import { motion, useScroll } from 'framer-motion';
import { useState, useEffect, useRef, type RefObject } from 'react';
import {
  calculateStickyNavState,
  calculateSectionVisibility,
  ANIMATION_CONSTANTS,
  type SectionVisibility,
} from '@tminuszero/launch-animations';

export type NavSection = {
  id: string;
  label: string;
  ref: RefObject<HTMLElement>;
};

type StickyNavPillsProps = {
  sections: NavSection[];
  offsetTop?: number;
  className?: string;
};

/**
 * Sticky section navigation with auto-highlighting
 * Appears after scrolling threshold and highlights active section
 */
export function StickyNavPills({
  sections,
  offsetTop = 80,
  className = '',
}: StickyNavPillsProps) {
  const { scrollY } = useScroll();
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isSticky, setIsSticky] = useState(false);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    const unsubscribe = scrollY.on('change', (latest) => {
      // Calculate section visibility for all sections
      const sectionVisibility: SectionVisibility[] = sections
        .map((section) => {
          const element = section.ref.current;
          if (!element) return null;

          const rect = element.getBoundingClientRect();
          const sectionTop = rect.top + latest;
          const sectionHeight = rect.height;

          const visibility = calculateSectionVisibility(
            sectionTop,
            sectionHeight,
            latest,
            window.innerHeight
          );

          return {
            ...visibility,
            sectionId: section.id,
          };
        })
        .filter((v): v is SectionVisibility => v !== null);

      // Calculate sticky nav state using shared logic
      const navState = calculateStickyNavState(
        latest,
        ANIMATION_CONSTANTS.STICKY_NAV_THRESHOLD,
        sectionVisibility
      );

      setActiveSection(navState.activeSection);
      setIsSticky(navState.isSticky);
      setOpacity(navState.opacity);
    });

    return () => unsubscribe();
  }, [scrollY, sections]);

  const handleSectionClick = (section: NavSection) => {
    section.ref.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  return (
    <motion.nav
      className={`
        sticky bg-background/80 backdrop-blur-xl border-b border-stroke
        ${className}
      `}
      style={{
        top: offsetTop,
        zIndex: ANIMATION_CONSTANTS.STICKY_NAV_Z_INDEX,
      }}
      initial={{ y: -100, opacity: 0 }}
      animate={{
        y: isSticky ? 0 : -100,
        opacity: isSticky ? opacity : 0,
      }}
      transition={{
        duration: ANIMATION_CONSTANTS.STICKY_NAV_FADE_DURATION / 1000,
        ease: 'easeOut',
      }}
    >
      <div className="flex gap-2 p-4 overflow-x-auto scrollbar-hide">
        {sections.map((section) => (
          <NavPill
            key={section.id}
            section={section}
            isActive={activeSection === section.id}
            onClick={() => handleSectionClick(section)}
          />
        ))}
      </div>
    </motion.nav>
  );
}

function NavPill({
  section,
  isActive,
  onClick,
}: {
  section: NavSection;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      className={`
        px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap
        transition-colors duration-200 border backdrop-blur-sm
        ${
          isActive
            ? 'bg-primary/20 text-primary border-primary/40'
            : 'bg-surface-1 text-text2 border-stroke hover:bg-surface-2 hover:border-stroke-hover'
        }
      `}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ duration: 0.15 }}
    >
      {section.label}
    </motion.button>
  );
}

/**
 * Minimal variant without sticky behavior
 * Useful for in-page section navigation
 */
export function SectionNav({
  sections,
  activeSection,
  onSectionClick,
  className = '',
}: {
  sections: { id: string; label: string }[];
  activeSection: string | null;
  onSectionClick: (id: string) => void;
  className?: string;
}) {
  return (
    <nav className={`flex gap-2 overflow-x-auto scrollbar-hide ${className}`}>
      {sections.map((section) => (
        <motion.button
          key={section.id}
          onClick={() => onSectionClick(section.id)}
          className={`
            px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap
            transition-colors duration-200 border
            ${
              activeSection === section.id
                ? 'bg-primary/20 text-primary border-primary/40'
                : 'bg-surface-1 text-text2 border-stroke hover:bg-surface-2'
            }
          `}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {section.label}
        </motion.button>
      ))}
    </nav>
  );
}
