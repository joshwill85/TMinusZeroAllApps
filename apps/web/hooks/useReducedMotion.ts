import { useReducedMotion as useFramerReducedMotion } from 'framer-motion';

/**
 * Hook to detect if the user has reduced motion preferences enabled
 * Uses Framer Motion's built-in hook for consistent behavior
 *
 * @returns boolean - true if user prefers reduced motion
 */
export function useReducedMotion() {
  return useFramerReducedMotion();
}
