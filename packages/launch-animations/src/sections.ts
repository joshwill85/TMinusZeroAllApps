/**
 * Section visibility and state management utilities
 * Handles collapsible sections, lazy loading, and animation phases
 */

import type {
  SectionVisibility,
  SectionState,
  AnimationPhase,
  CollapseConfig,
} from './types';
import { ANIMATION_CONSTANTS } from './constants';

/**
 * Calculate visibility metrics for a section
 *
 * @param sectionTop - Top position of section relative to document
 * @param sectionHeight - Height of the section in pixels
 * @param scrollY - Current scroll position
 * @param viewportHeight - Height of the viewport
 * @returns SectionVisibility object with calculated metrics
 *
 * @example
 * const visibility = calculateSectionVisibility(500, 300, 400, 800);
 * // Returns: { isVisible: true, visibilityRatio: 0.67, distanceFromTop: 100, ... }
 */
export function calculateSectionVisibility(
  sectionTop: number,
  sectionHeight: number,
  scrollY: number,
  viewportHeight: number
): Omit<SectionVisibility, 'sectionId'> {
  const sectionBottom = sectionTop + sectionHeight;
  const viewportBottom = scrollY + viewportHeight;

  // Check if section intersects with viewport
  const isVisible = sectionBottom > scrollY && sectionTop < viewportBottom;

  let visibilityRatio = 0;

  if (isVisible) {
    // Calculate how much of the section is visible
    const visibleTop = Math.max(sectionTop, scrollY);
    const visibleBottom = Math.min(sectionBottom, viewportBottom);
    const visibleHeight = visibleBottom - visibleTop;

    visibilityRatio = Math.max(
      0,
      Math.min(1, visibleHeight / sectionHeight)
    );
  }

  // Distance from section top to viewport top (negative = above viewport)
  const distanceFromTop = sectionTop - scrollY;

  return {
    isVisible,
    visibilityRatio,
    distanceFromTop,
  };
}

/**
 * Determine the animation phase for a section based on visibility
 *
 * @param visibility - Section visibility metrics
 * @param isCollapsed - Whether section is manually collapsed
 * @returns SectionState with phase and progress
 */
export function determineSectionState(
  visibility: SectionVisibility,
  isCollapsed: boolean
): SectionState {
  // Collapsed state takes precedence
  if (isCollapsed) {
    return {
      id: visibility.sectionId,
      phase: 'collapsed',
      progress: 0,
    };
  }

  // Section not visible
  if (!visibility.isVisible) {
    // Determine if it's above or below viewport
    const phase: AnimationPhase =
      visibility.distanceFromTop > 0 ? 'entering' : 'exiting';

    return {
      id: visibility.sectionId,
      phase,
      progress: 0,
    };
  }

  // Section is visible and active
  return {
    id: visibility.sectionId,
    phase: 'active',
    progress: visibility.visibilityRatio,
  };
}

/**
 * Check if a section should auto-collapse based on scroll position
 *
 * @param visibility - Section visibility metrics
 * @param config - Collapse configuration
 * @returns Whether section should collapse
 */
export function shouldAutoCollapse(
  visibility: SectionVisibility,
  config: CollapseConfig = createCollapseConfig()
): boolean {
  if (!config.autoCollapse) {
    return false;
  }

  // Auto-collapse when section is above viewport by threshold amount
  return (
    !visibility.isVisible &&
    visibility.distanceFromTop < config.collapseThreshold
  );
}

/**
 * Check if a section should start lazy loading
 *
 * @param distanceFromTop - Distance from section top to viewport top
 * @param lazyLoadOffset - Offset in pixels before viewport to start loading
 * @returns Whether section should lazy load
 */
export function shouldLazyLoad(
  distanceFromTop: number,
  lazyLoadOffset: number = ANIMATION_CONSTANTS.SECTION_LAZY_LOAD_OFFSET
): boolean {
  // Start loading when section is within offset distance of viewport
  return distanceFromTop <= lazyLoadOffset;
}

/**
 * Calculate opacity for section based on visibility
 * Used for fade-in animations as section enters viewport
 *
 * @param visibilityRatio - How much of section is visible (0-1)
 * @param fadeThreshold - Minimum visibility to start fading in
 * @returns Opacity value (0-1)
 */
export function calculateSectionOpacity(
  visibilityRatio: number,
  fadeThreshold: number = ANIMATION_CONSTANTS.SECTION_VISIBILITY_THRESHOLD
): number {
  if (visibilityRatio <= fadeThreshold) {
    return 0;
  }

  // Map visibility ratio above threshold to opacity
  const adjustedRatio = (visibilityRatio - fadeThreshold) / (1 - fadeThreshold);

  return Math.max(0, Math.min(1, adjustedRatio));
}

/**
 * Calculate Y translation for section enter animation
 *
 * @param visibilityRatio - How much of section is visible (0-1)
 * @param maxTranslation - Maximum translation distance in pixels
 * @returns Translation value in pixels
 */
export function calculateSectionTranslation(
  visibilityRatio: number,
  maxTranslation: number = 20
): number {
  // Start below and move to 0 as section becomes visible
  const translation = maxTranslation * (1 - visibilityRatio);

  return Math.max(0, translation);
}

/**
 * Group sections by their animation phase
 *
 * @param sectionStates - Array of section states
 * @returns Object mapping phases to section IDs
 */
export function groupSectionsByPhase(
  sectionStates: SectionState[]
): Record<AnimationPhase, string[]> {
  const groups: Record<AnimationPhase, string[]> = {
    entering: [],
    active: [],
    exiting: [],
    collapsed: [],
  };

  for (const state of sectionStates) {
    groups[state.phase].push(state.id);
  }

  return groups;
}

/**
 * Find the most visible section
 *
 * @param sections - Array of section visibility data
 * @returns ID of most visible section or null
 */
export function findMostVisibleSection(
  sections: SectionVisibility[]
): string | null {
  let maxVisibility = 0;
  let mostVisibleId: string | null = null;

  for (const section of sections) {
    if (section.visibilityRatio > maxVisibility) {
      maxVisibility = section.visibilityRatio;
      mostVisibleId = section.sectionId;
    }
  }

  return mostVisibleId;
}

/**
 * Helper to create a collapse config with defaults
 *
 * @param overrides - Partial config to override defaults
 * @returns Complete CollapseConfig object
 */
export function createCollapseConfig(
  overrides: Partial<CollapseConfig> = {}
): CollapseConfig {
  return {
    collapseThreshold: ANIMATION_CONSTANTS.SECTION_COLLAPSE_THRESHOLD,
    autoCollapse: true,
    ...overrides,
  };
}
