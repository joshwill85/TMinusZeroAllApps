/**
 * Core types for cross-platform launch detail animations
 * Used by both web (Framer Motion) and mobile (React Native Reanimated)
 */

/**
 * Scroll metrics calculated from scroll position
 */
export type ScrollMetrics = {
  /** Current vertical scroll position in pixels */
  scrollY: number;
  /** Height of the viewport in pixels */
  viewportHeight: number;
  /** Total scrollable content height in pixels */
  contentHeight: number;
  /** Normalized scroll progress from 0 to 1 */
  scrollProgress: number;
};

/**
 * Configuration for parallax effects
 */
export type ParallaxConfig = {
  /** Parallax speed multiplier (0-1, where 0.5 = half speed) */
  speed: number;
  /** Direction of parallax movement */
  direction: 'vertical' | 'horizontal';
  /** Whether parallax is enabled */
  enabled: boolean;
};

/**
 * Visibility state for a content section
 */
export type SectionVisibility = {
  /** Unique identifier for the section */
  sectionId: string;
  /** Whether section is currently in viewport */
  isVisible: boolean;
  /** How much of the section is visible (0-1) */
  visibilityRatio: number;
  /** Distance from section top to viewport top (negative = above) */
  distanceFromTop: number;
};

/**
 * State for sticky navigation
 */
export type StickyNavState = {
  /** Currently active section ID or null */
  activeSection: string | null;
  /** Whether sticky nav should be displayed */
  isSticky: boolean;
  /** Opacity for fade-in animation (0-1) */
  opacity: number;
};

/**
 * Animation phase for a section
 */
export type AnimationPhase =
  | 'entering' // Section entering viewport from below
  | 'active'   // Section fully visible in viewport
  | 'exiting'  // Section exiting viewport from top
  | 'collapsed'; // Section manually collapsed

/**
 * Complete state for a section including animation phase
 */
export type SectionState = {
  /** Unique identifier for the section */
  id: string;
  /** Current animation phase */
  phase: AnimationPhase;
  /** Progress within current phase (0-1) */
  progress: number;
};

/**
 * Configuration for section collapse behavior
 */
export type CollapseConfig = {
  /** Threshold in pixels above viewport to trigger collapse */
  collapseThreshold: number;
  /** Whether auto-collapse is enabled */
  autoCollapse: boolean;
};

/**
 * Scroll event data (platform-agnostic)
 */
export type ScrollEvent = {
  /** Current scroll Y position */
  y: number;
  /** Current scroll X position */
  x: number;
  /** Timestamp of the event */
  timestamp: number;
};
