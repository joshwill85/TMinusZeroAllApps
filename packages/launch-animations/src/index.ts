/**
 * @tminuszero/launch-animations
 *
 * Cross-platform animation utilities for Mission Control Dashboard
 * Shared logic for web (Framer Motion) and mobile (React Native Reanimated)
 *
 * @packageDocumentation
 */

// ============================================
// Type Exports
// ============================================

export type {
  ScrollMetrics,
  ParallaxConfig,
  SectionVisibility,
  StickyNavState,
  AnimationPhase,
  SectionState,
  CollapseConfig,
  ScrollEvent,
} from './types';

// ============================================
// Constants
// ============================================

export {
  ANIMATION_CONSTANTS,
  getAnimationConstant,
  type AnimationConstantKey,
} from './constants';

// ============================================
// Parallax Utilities
// ============================================

export {
  calculateParallaxOffset,
  calculateParallaxScale,
  calculateParallaxOpacity,
  calculateLayerTranslation,
  calculateScrollProgress,
  createParallaxConfig,
} from './parallax';

// ============================================
// Section Management
// ============================================

export {
  calculateSectionVisibility,
  determineSectionState,
  shouldAutoCollapse,
  shouldLazyLoad,
  calculateSectionOpacity,
  calculateSectionTranslation,
  groupSectionsByPhase,
  findMostVisibleSection,
  createCollapseConfig,
} from './sections';

// ============================================
// Sticky Navigation
// ============================================

export {
  calculateStickyNavState,
  findActiveSectionForNav,
  calculateStickyNavTransform,
  isSectionActive,
  calculateScrollToSection,
  calculateNavPillWidth,
  getNavPillBackground,
  getNavPillBorderColor,
} from './stickyNav';

// ============================================
// Scroll Metrics
// ============================================

export {
  buildScrollMetrics,
  calculateScrollVelocity,
  getScrollDirection,
  hasPassedThreshold,
  calculateRangeProgress,
  isAtTop,
  isAtBottom,
  clampScrollPosition,
  createScrollEvent,
  calculateSmoothScroll,
} from './scrollMetrics';
