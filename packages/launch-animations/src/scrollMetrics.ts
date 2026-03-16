/**
 * Scroll metrics calculation utilities
 * Platform-agnostic functions for tracking and calculating scroll state
 */

import type { ScrollMetrics, ScrollEvent } from './types';

/**
 * Build a complete ScrollMetrics object from current scroll state
 *
 * @param scrollY - Current vertical scroll position
 * @param viewportHeight - Height of the viewport
 * @param contentHeight - Total scrollable content height
 * @returns Complete ScrollMetrics object
 */
export function buildScrollMetrics(
  scrollY: number,
  viewportHeight: number,
  contentHeight: number
): ScrollMetrics {
  const maxScroll = contentHeight - viewportHeight;
  const scrollProgress =
    maxScroll > 0 ? Math.max(0, Math.min(1, scrollY / maxScroll)) : 0;

  return {
    scrollY,
    viewportHeight,
    contentHeight,
    scrollProgress,
  };
}

/**
 * Calculate scroll velocity from two scroll events
 *
 * @param current - Current scroll event
 * @param previous - Previous scroll event
 * @returns Velocity in pixels per millisecond
 */
export function calculateScrollVelocity(
  current: ScrollEvent,
  previous: ScrollEvent
): number {
  const deltaY = current.y - previous.y;
  const deltaTime = current.timestamp - previous.timestamp;

  if (deltaTime === 0) {
    return 0;
  }

  // Velocity in pixels per millisecond
  return deltaY / deltaTime;
}

/**
 * Detect scroll direction from velocity
 *
 * @param velocity - Scroll velocity in px/ms
 * @returns Direction: 'up' | 'down' | 'none'
 */
export function getScrollDirection(
  velocity: number
): 'up' | 'down' | 'none' {
  if (Math.abs(velocity) < 0.01) {
    return 'none';
  }

  return velocity > 0 ? 'down' : 'up';
}

/**
 * Check if user has scrolled past a specific threshold
 *
 * @param scrollY - Current scroll position
 * @param threshold - Threshold position
 * @returns Whether threshold has been passed
 */
export function hasPassedThreshold(
  scrollY: number,
  threshold: number
): boolean {
  return scrollY >= threshold;
}

/**
 * Calculate progress through a specific scroll range
 *
 * @param scrollY - Current scroll position
 * @param rangeStart - Start of the range
 * @param rangeEnd - End of the range
 * @returns Progress through range (0-1)
 */
export function calculateRangeProgress(
  scrollY: number,
  rangeStart: number,
  rangeEnd: number
): number {
  if (rangeEnd <= rangeStart) {
    return 0;
  }

  if (scrollY <= rangeStart) {
    return 0;
  }

  if (scrollY >= rangeEnd) {
    return 1;
  }

  const progress = (scrollY - rangeStart) / (rangeEnd - rangeStart);

  return Math.max(0, Math.min(1, progress));
}

/**
 * Check if user is at the top of the scroll container
 *
 * @param scrollY - Current scroll position
 * @param threshold - Small threshold to account for floating point errors
 * @returns Whether at top
 */
export function isAtTop(scrollY: number, threshold: number = 1): boolean {
  return scrollY <= threshold;
}

/**
 * Check if user is at the bottom of the scroll container
 *
 * @param scrollY - Current scroll position
 * @param viewportHeight - Height of viewport
 * @param contentHeight - Total content height
 * @param threshold - Small threshold to account for floating point errors
 * @returns Whether at bottom
 */
export function isAtBottom(
  scrollY: number,
  viewportHeight: number,
  contentHeight: number,
  threshold: number = 1
): boolean {
  const maxScroll = contentHeight - viewportHeight;
  return scrollY >= maxScroll - threshold;
}

/**
 * Clamp scroll position to valid range
 *
 * @param scrollY - Scroll position to clamp
 * @param viewportHeight - Height of viewport
 * @param contentHeight - Total content height
 * @returns Clamped scroll position
 */
export function clampScrollPosition(
  scrollY: number,
  viewportHeight: number,
  contentHeight: number
): number {
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, Math.min(maxScroll, scrollY));
}

/**
 * Create a scroll event object
 *
 * @param y - Y scroll position
 * @param x - X scroll position
 * @param timestamp - Event timestamp (defaults to Date.now())
 * @returns ScrollEvent object
 */
export function createScrollEvent(
  y: number,
  x: number = 0,
  timestamp: number = Date.now()
): ScrollEvent {
  return { y, x, timestamp };
}

/**
 * Smooth scroll target calculation with easing
 * Used for programmatic scrolling with smooth animation
 *
 * @param current - Current scroll position
 * @param target - Target scroll position
 * @param speed - Speed factor (0-1, where 1 = instant)
 * @returns Next scroll position
 */
export function calculateSmoothScroll(
  current: number,
  target: number,
  speed: number = 0.1
): number {
  const delta = target - current;
  const next = current + delta * speed;

  // Snap to target if very close (within 1px)
  if (Math.abs(delta) < 1) {
    return target;
  }

  return next;
}
