'use client';

import { motion, AnimatePresence, useInView } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import {
  shouldAutoCollapse,
  calculateSectionVisibility,
  ANIMATION_CONSTANTS,
} from '@tminuszero/launch-animations';

type CollapsibleSectionProps = {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  enableAutoCollapse?: boolean;
  icon?: React.ReactNode;
  className?: string;
};

/**
 * Collapsible section with smooth height animations
 * Auto-collapses when scrolled past (optional)
 */
export function CollapsibleSection({
  id,
  title,
  description,
  children,
  defaultExpanded = true,
  enableAutoCollapse = false,
  icon,
  className = '',
}: CollapsibleSectionProps) {
  const ref = useRef<HTMLElement>(null);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const isInView = useInView(ref, { amount: 0.1 });

  // Auto-collapse when scrolled past
  useEffect(() => {
    if (!enableAutoCollapse || !ref.current) return;

    const handleScroll = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;

      const sectionTop = rect.top + window.scrollY;
      const sectionHeight = rect.height;

      const visibility = calculateSectionVisibility(
        sectionTop,
        sectionHeight,
        window.scrollY,
        window.innerHeight
      );

      const shouldCollapse = shouldAutoCollapse(
        { ...visibility, sectionId: id },
        {
          collapseThreshold: ANIMATION_CONSTANTS.SECTION_COLLAPSE_THRESHOLD,
          autoCollapse: true
        }
      );

      if (shouldCollapse && isExpanded) {
        setIsExpanded(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [enableAutoCollapse, id, isExpanded]);

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <motion.section
      ref={ref}
      id={id}
      className={`rounded-2xl border border-stroke bg-surface-1 overflow-hidden ${className}`}
      layout
      transition={{ duration: 0.3, ease: 'easeInOut' }}
    >
      {/* Header */}
      <motion.button
        onClick={toggleExpanded}
        className="w-full p-6 flex items-center justify-between hover:bg-surface-2 transition-colors group"
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.995 }}
      >
        <div className="flex-1 text-left">
          <div className="flex items-center gap-3">
            {icon && <div className="text-text2">{icon}</div>}
            <h2 className="text-2xl font-bold text-text1 group-hover:text-primary transition-colors">
              {title}
            </h2>
          </div>
          {description && (
            <p className="mt-2 text-sm text-text3">{description}</p>
          )}
        </div>

        {/* Expand/collapse arrow */}
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{
            duration: ANIMATION_CONSTANTS.COLLAPSE_ANIMATION_DURATION / 1000,
            ease: 'easeInOut',
          }}
          className="ml-4 text-text2 group-hover:text-primary transition-colors"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.div>
      </motion.button>

      {/* Content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              duration: ANIMATION_CONSTANTS.COLLAPSE_ANIMATION_DURATION / 1000,
              ease: 'easeInOut',
            }}
          >
            <div className="px-6 pb-6">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

/**
 * Simpler collapsible card for nested sections
 */
export function CollapsibleCard({
  title,
  children,
  defaultExpanded = false,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  className?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className={`rounded-xl border border-stroke bg-surface-2/50 overflow-hidden ${className}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-surface-2 transition-colors text-left"
      >
        <h3 className="text-lg font-semibold text-text1">{title}</h3>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-text3"
        >
          ▼
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="p-4 pt-0">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
