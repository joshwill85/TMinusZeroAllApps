import { useState, useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Hook to detect if the user has reduced motion preferences enabled
 * Uses React Native's AccessibilityInfo API
 *
 * @returns boolean - true if user prefers reduced motion
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    // Check initial state
    AccessibilityInfo.isReduceMotionEnabled().then((isEnabled) => {
      setReduceMotion(isEnabled ?? false);
    });

    // Listen for changes
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (isEnabled) => {
        setReduceMotion(isEnabled);
      }
    );

    return () => {
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
