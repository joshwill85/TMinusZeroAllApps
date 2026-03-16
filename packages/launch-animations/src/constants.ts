/**
 * Animation constants for Mission Control Dashboard
 * Centralized values ensure consistency across web and mobile platforms
 */

export const ANIMATION_CONSTANTS = {
  // ============================================
  // Parallax Effects
  // ============================================

  /** Parallax speed for main hero section (0.5 = moves at half scroll speed) */
  HERO_PARALLAX_SPEED: 0.5,

  /** Parallax speed for background images (slower than hero for depth) */
  BACKGROUND_PARALLAX_SPEED: 0.3,

  /** Maximum scale for parallax zoom effect */
  PARALLAX_MAX_SCALE: 1.15,

  /** Minimum scale for parallax zoom effect */
  PARALLAX_MIN_SCALE: 1.0,

  // ============================================
  // Section Management
  // ============================================

  /** Pixels above viewport where sections auto-collapse */
  SECTION_COLLAPSE_THRESHOLD: -100,

  /** Pixels before viewport where sections start lazy loading */
  SECTION_LAZY_LOAD_OFFSET: 500,

  /** Minimum visibility ratio (0-1) to consider section "visible" */
  SECTION_VISIBILITY_THRESHOLD: 0.1,

  // ============================================
  // Sticky Navigation
  // ============================================

  /** Scroll position (px) where sticky nav becomes active */
  STICKY_NAV_THRESHOLD: 200,

  /** Duration for sticky nav fade-in animation (ms) */
  STICKY_NAV_FADE_DURATION: 100,

  /** Z-index for sticky navigation */
  STICKY_NAV_Z_INDEX: 40,

  // ============================================
  // Performance
  // ============================================

  /** Throttle interval for scroll events (ms) - 16ms ≈ 60fps */
  SCROLL_THROTTLE_MS: 16,

  /** IntersectionObserver thresholds for visibility detection */
  INTERSECTION_THRESHOLD: [0, 0.25, 0.5, 0.75, 1.0],

  // ============================================
  // Interactive Stat Tiles
  // ============================================

  /** Delay between tile animations (ms) for stagger effect */
  TILE_STAGGER_DELAY: 50,

  /** Maximum scale on hover/focus */
  TILE_SCALE_MAX: 1.05,

  /** Minimum scale on press/tap */
  TILE_SCALE_MIN: 0.98,

  /** Animation duration for tile interactions (ms) */
  TILE_ANIMATION_DURATION: 300,

  /** IntersectionObserver amount for tile visibility trigger */
  TILE_VISIBILITY_AMOUNT: 0.3,

  // ============================================
  // Live Data Pulse
  // ============================================

  /** Duration of one complete pulse cycle (ms) */
  LIVE_PULSE_DURATION: 2000,

  /** Maximum opacity for pulse glow effect (0-1) */
  LIVE_GLOW_OPACITY: 0.6,

  /** Minimum opacity for pulse glow effect (0-1) */
  LIVE_GLOW_MIN_OPACITY: 0.3,

  /** Scale range for pulse dot indicator */
  LIVE_DOT_SCALE_MIN: 1.0,
  LIVE_DOT_SCALE_MAX: 1.2,

  // ============================================
  // Collapsible Sections
  // ============================================

  /** Duration for section expand/collapse animation (ms) */
  COLLAPSE_ANIMATION_DURATION: 300,

  /** Arrow rotation for collapsed state (degrees) */
  COLLAPSE_ARROW_ROTATION_COLLAPSED: 0,

  /** Arrow rotation for expanded state (degrees) */
  COLLAPSE_ARROW_ROTATION_EXPANDED: 180,

  // ============================================
  // Spring Physics (for smooth animations)
  // ============================================

  /** Spring damping for natural motion (lower = more bounce) */
  SPRING_DAMPING: 15,

  /** Spring stiffness for responsiveness (higher = faster) */
  SPRING_STIFFNESS: 150,

  /** Spring mass for weight feel (higher = slower) */
  SPRING_MASS: 1,

  // ============================================
  // Glassmorphism
  // ============================================

  /** Backdrop blur radius (px) */
  GLASS_BLUR_RADIUS: 18,

  /** Border radius for cards (px) */
  GLASS_BORDER_RADIUS: 24,

  /** Border opacity for glass effect (0-1) */
  GLASS_BORDER_OPACITY: 0.12,

  // ============================================
  // Easing Curves
  // ============================================

  /** Ease-in-out for general animations */
  EASING_DEFAULT: 'ease-in-out',

  /** Ease-out for exit animations */
  EASING_EXIT: 'ease-out',

  /** Ease-in for enter animations */
  EASING_ENTER: 'ease-in',
} as const;

/**
 * Type for animation constant keys
 */
export type AnimationConstantKey = keyof typeof ANIMATION_CONSTANTS;

/**
 * Helper to get animation constant value with type safety
 */
export function getAnimationConstant<K extends AnimationConstantKey>(
  key: K
): typeof ANIMATION_CONSTANTS[K] {
  return ANIMATION_CONSTANTS[key];
}
