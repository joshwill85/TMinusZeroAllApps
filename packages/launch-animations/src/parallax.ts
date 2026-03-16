/**
 * Parallax calculation utilities for Mission Control Dashboard
 * Pure functions that work identically on web and mobile platforms
 */

import type { ParallaxConfig } from './types';
import { ANIMATION_CONSTANTS } from './constants';

/**
 * Calculate parallax offset based on scroll position and config
 *
 * @param scrollY - Current vertical scroll position in pixels
 * @param config - Parallax configuration object
 * @returns Offset value in pixels
 *
 * @example
 * // Background moves at 30% of scroll speed
 * const offset = calculateParallaxOffset(100, {
 *   speed: 0.3,
 *   direction: 'vertical',
 *   enabled: true
 * }); // Returns 70
 */
export function calculateParallaxOffset(
  scrollY: number,
  config: ParallaxConfig
): number {
  if (!config.enabled) {
    return 0;
  }

  if (config.direction !== 'vertical') {
    // Horizontal parallax not implemented yet
    return 0;
  }

  // Calculate offset: slower speed = larger offset
  // speed of 0.5 means background moves at half the scroll speed
  // offset = scrollY * (1 - speed)
  const offset = scrollY * (1 - config.speed);

  return offset;
}

/**
 * Calculate parallax scale based on scroll progress
 * Used for zoom effects on hero images
 *
 * @param scrollProgress - Normalized scroll progress (0-1)
 * @param maxScale - Maximum scale value (default from constants)
 * @param minScale - Minimum scale value (default from constants)
 * @returns Scale multiplier
 *
 * @example
 * const scale = calculateParallaxScale(0.5); // Returns 1.075 (midpoint between 1.0 and 1.15)
 */
export function calculateParallaxScale(
  scrollProgress: number,
  maxScale: number = ANIMATION_CONSTANTS.PARALLAX_MAX_SCALE,
  minScale: number = ANIMATION_CONSTANTS.PARALLAX_MIN_SCALE
): number {
  // Clamp scroll progress to 0-1 range
  const clampedProgress = Math.max(0, Math.min(1, scrollProgress));

  // Linear interpolation between min and max scale
  const scale = minScale + (maxScale - minScale) * clampedProgress;

  return scale;
}

/**
 * Calculate parallax opacity for fade effects
 * Used for fading content as user scrolls
 *
 * @param scrollProgress - Normalized scroll progress (0-1)
 * @param fadeStart - Progress where fade begins (0-1)
 * @param fadeEnd - Progress where fade completes (0-1)
 * @returns Opacity value (0-1)
 *
 * @example
 * const opacity = calculateParallaxOpacity(0.15, 0, 0.3); // Returns 0.5 (halfway through fade)
 */
export function calculateParallaxOpacity(
  scrollProgress: number,
  fadeStart: number = 0,
  fadeEnd: number = 0.3
): number {
  // Before fade starts: fully opaque
  if (scrollProgress <= fadeStart) {
    return 1;
  }

  // After fade ends: fully transparent
  if (scrollProgress >= fadeEnd) {
    return 0;
  }

  // During fade: linear transition
  const fadeRange = fadeEnd - fadeStart;
  const fadeProgress = (scrollProgress - fadeStart) / fadeRange;
  const opacity = 1 - fadeProgress;

  return Math.max(0, Math.min(1, opacity));
}

/**
 * Calculate parallax translation for multi-layer effects
 * Supports both Y and X axis transformations
 *
 * @param scrollY - Current vertical scroll position
 * @param layerSpeed - Speed multiplier for this layer (0-1)
 * @param axis - Axis of translation ('vertical' | 'horizontal')
 * @returns Translation value in pixels
 */
export function calculateLayerTranslation(
  scrollY: number,
  layerSpeed: number,
  axis: 'vertical' | 'horizontal' = 'vertical'
): number {
  if (axis !== 'vertical') {
    // Horizontal translation not implemented yet
    return 0;
  }

  // Slower layers move less (higher differential = more depth)
  return scrollY * layerSpeed;
}

/**
 * Calculate normalized scroll progress from scroll position
 *
 * @param scrollY - Current scroll position
 * @param contentHeight - Total scrollable content height
 * @param viewportHeight - Visible viewport height
 * @returns Normalized progress (0-1)
 */
export function calculateScrollProgress(
  scrollY: number,
  contentHeight: number,
  viewportHeight: number
): number {
  const maxScroll = contentHeight - viewportHeight;

  if (maxScroll <= 0) {
    return 0;
  }

  const progress = scrollY / maxScroll;

  return Math.max(0, Math.min(1, progress));
}

/**
 * Helper to create a parallax config object with defaults
 *
 * @param overrides - Partial config to override defaults
 * @returns Complete ParallaxConfig object
 */
export function createParallaxConfig(
  overrides: Partial<ParallaxConfig> = {}
): ParallaxConfig {
  return {
    speed: ANIMATION_CONSTANTS.BACKGROUND_PARALLAX_SPEED,
    direction: 'vertical',
    enabled: true,
    ...overrides,
  };
}
