/**
 * Sticky navigation state management
 * Handles sticky header behavior and active section highlighting
 */

import type { SectionVisibility, StickyNavState } from './types';
import { ANIMATION_CONSTANTS } from './constants';

/**
 * Calculate sticky navigation state based on scroll position and section visibility
 *
 * @param scrollY - Current vertical scroll position
 * @param stickyThreshold - Scroll position where sticky nav activates
 * @param sections - Array of section visibility data
 * @returns StickyNavState with active section and display properties
 *
 * @example
 * const navState = calculateStickyNavState(250, 200, sectionData);
 * // Returns: { activeSection: 'overview', isSticky: true, opacity: 0.5 }
 */
export function calculateStickyNavState(
  scrollY: number,
  stickyThreshold: number = ANIMATION_CONSTANTS.STICKY_NAV_THRESHOLD,
  sections: SectionVisibility[]
): StickyNavState {
  // Determine if sticky nav should be shown
  const isSticky = scrollY > stickyThreshold;

  // Calculate opacity for fade-in animation
  const fadeRange = ANIMATION_CONSTANTS.STICKY_NAV_FADE_DURATION;
  const fadeProgress = (scrollY - stickyThreshold) / fadeRange;
  const opacity = Math.max(0, Math.min(1, fadeProgress));

  // Find the section closest to the top of the viewport
  const activeSection = findActiveSectionForNav(sections);

  return {
    activeSection,
    isSticky,
    opacity,
  };
}

/**
 * Find which section should be highlighted in sticky nav
 * Prioritizes sections closest to the top of the viewport
 *
 * @param sections - Array of section visibility data
 * @returns ID of active section or null
 */
export function findActiveSectionForNav(
  sections: SectionVisibility[]
): string | null {
  if (sections.length === 0) {
    return null;
  }

  let activeSection: string | null = null;
  let minDistance = Infinity;

  for (const section of sections) {
    if (!section.isVisible) {
      continue;
    }

    // Calculate absolute distance from top of viewport
    const distance = Math.abs(section.distanceFromTop);

    // Find section closest to top (but prefer sections at top or slightly below)
    if (section.distanceFromTop >= -50 && distance < minDistance) {
      minDistance = distance;
      activeSection = section.sectionId;
    }
  }

  // If no section is near the top, use the first visible section
  if (activeSection === null) {
    const firstVisible = sections.find((s) => s.isVisible);
    if (firstVisible) {
      activeSection = firstVisible.sectionId;
    }
  }

  return activeSection;
}

/**
 * Calculate transform Y value for sticky nav slide-in animation
 *
 * @param scrollY - Current scroll position
 * @param stickyThreshold - Threshold where nav becomes sticky
 * @param navHeight - Height of the sticky nav in pixels
 * @returns Translation Y value in pixels
 */
export function calculateStickyNavTransform(
  scrollY: number,
  stickyThreshold: number = ANIMATION_CONSTANTS.STICKY_NAV_THRESHOLD,
  navHeight: number = 60
): number {
  if (scrollY <= stickyThreshold) {
    // Nav is hidden above viewport
    return -navHeight;
  }

  // Calculate slide-in progress
  const slideRange = ANIMATION_CONSTANTS.STICKY_NAV_FADE_DURATION;
  const slideProgress = (scrollY - stickyThreshold) / slideRange;
  const normalizedProgress = Math.max(0, Math.min(1, slideProgress));

  // Interpolate from -navHeight to 0
  const translateY = -navHeight * (1 - normalizedProgress);

  return translateY;
}

/**
 * Check if a specific section is currently active in the nav
 *
 * @param sectionId - ID of section to check
 * @param navState - Current sticky nav state
 * @returns Whether section is active
 */
export function isSectionActive(
  sectionId: string,
  navState: StickyNavState
): boolean {
  return navState.activeSection === sectionId;
}

/**
 * Calculate scroll position to reach a specific section
 * Used for smooth scrolling to sections when nav pill is clicked
 *
 * @param sectionTop - Top position of target section
 * @param navHeight - Height of sticky nav (to offset scroll position)
 * @param extraOffset - Additional offset in pixels
 * @returns Target scroll position
 */
export function calculateScrollToSection(
  sectionTop: number,
  navHeight: number = 60,
  extraOffset: number = 20
): number {
  // Scroll to section top, accounting for sticky nav height and extra spacing
  const targetScroll = sectionTop - navHeight - extraOffset;

  return Math.max(0, targetScroll);
}

/**
 * Calculate the width each nav pill should take for optimal spacing
 *
 * @param containerWidth - Width of the nav container
 * @param sectionCount - Number of sections/pills
 * @param minPillWidth - Minimum width per pill
 * @param maxPillWidth - Maximum width per pill
 * @returns Optimal pill width in pixels
 */
export function calculateNavPillWidth(
  containerWidth: number,
  sectionCount: number,
  minPillWidth: number = 80,
  maxPillWidth: number = 200
): number {
  if (sectionCount === 0) {
    return minPillWidth;
  }

  // Calculate even distribution
  const gap = 8; // Gap between pills
  const totalGapWidth = gap * (sectionCount - 1);
  const availableWidth = containerWidth - totalGapWidth;
  const evenWidth = availableWidth / sectionCount;

  // Clamp to min/max
  return Math.max(minPillWidth, Math.min(maxPillWidth, evenWidth));
}

/**
 * Get the background color for a nav pill based on active state
 *
 * @param isActive - Whether this pill is active
 * @param theme - Theme colors object
 * @returns Background color string
 */
export function getNavPillBackground(
  isActive: boolean,
  theme: { primary: string; surface: string }
): string {
  return isActive ? `${theme.primary}20` : theme.surface; // 20 = 12.5% opacity in hex
}

/**
 * Get the border color for a nav pill based on active state
 *
 * @param isActive - Whether this pill is active
 * @param theme - Theme colors object
 * @returns Border color string
 */
export function getNavPillBorderColor(
  isActive: boolean,
  theme: { primary: string; stroke: string }
): string {
  return isActive ? `${theme.primary}40` : theme.stroke; // 40 = 25% opacity in hex
}
