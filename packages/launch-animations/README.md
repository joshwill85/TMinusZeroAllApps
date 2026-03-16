# @tminuszero/launch-animations

Cross-platform animation utilities for the Mission Control Dashboard launch detail pages.

## Overview

This package provides platform-agnostic animation logic that works identically on web (Framer Motion) and mobile (React Native Reanimated). All functions are pure and framework-independent.

## Features

- **Parallax Effects**: Calculate smooth parallax offsets, scales, and opacity
- **Section Management**: Visibility tracking, lazy loading, auto-collapse logic
- **Sticky Navigation**: State management for sticky headers with active section highlighting
- **Scroll Metrics**: Velocity calculation, direction detection, progress tracking
- **Type Safety**: Full TypeScript support with comprehensive type exports

## Installation

```bash
# Already installed as workspace dependency
# No npm install needed
```

## Usage

### Parallax Calculations

```typescript
import { calculateParallaxOffset, ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';

// Web (Framer Motion)
const backgroundY = useTransform(scrollY, (latest) =>
  calculateParallaxOffset(latest, {
    speed: ANIMATION_CONSTANTS.BACKGROUND_PARALLAX_SPEED,
    direction: 'vertical',
    enabled: true
  })
);

// Mobile (Reanimated)
const parallaxStyle = useAnimatedStyle(() => {
  'worklet';
  const offset = scrollY.value * ANIMATION_CONSTANTS.BACKGROUND_PARALLAX_SPEED;
  return { transform: [{ translateY: offset }] };
});
```

### Section Visibility

```typescript
import { calculateSectionVisibility, determineSectionState } from '@tminuszero/launch-animations';

const visibility = calculateSectionVisibility(
  sectionTop,      // 500
  sectionHeight,   // 300
  scrollY,         // 400
  viewportHeight   // 800
);

const state = determineSectionState(visibility, isCollapsed);
// { id: 'overview', phase: 'active', progress: 0.67 }
```

### Sticky Navigation

```typescript
import { calculateStickyNavState, ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';

const navState = calculateStickyNavState(
  scrollY,
  ANIMATION_CONSTANTS.STICKY_NAV_THRESHOLD,
  sectionVisibilityArray
);

// { activeSection: 'overview', isSticky: true, opacity: 0.8 }
```

## API Reference

### Constants

```typescript
ANIMATION_CONSTANTS = {
  // Parallax
  HERO_PARALLAX_SPEED: 0.5,
  BACKGROUND_PARALLAX_SPEED: 0.3,
  PARALLAX_MAX_SCALE: 1.15,

  // Sections
  SECTION_COLLAPSE_THRESHOLD: -100,
  SECTION_LAZY_LOAD_OFFSET: 500,

  // Sticky Nav
  STICKY_NAV_THRESHOLD: 200,
  STICKY_NAV_FADE_DURATION: 100,

  // Tiles
  TILE_STAGGER_DELAY: 50,
  TILE_SCALE_MAX: 1.05,
  TILE_SCALE_MIN: 0.98,

  // Live Pulse
  LIVE_PULSE_DURATION: 2000,
  LIVE_GLOW_OPACITY: 0.6,

  // Physics
  SPRING_DAMPING: 15,
  SPRING_STIFFNESS: 150,
}
```

### Types

```typescript
// Core scroll metrics
type ScrollMetrics = {
  scrollY: number;
  viewportHeight: number;
  contentHeight: number;
  scrollProgress: number; // 0-1
};

// Parallax configuration
type ParallaxConfig = {
  speed: number;           // 0-1
  direction: 'vertical' | 'horizontal';
  enabled: boolean;
};

// Section visibility
type SectionVisibility = {
  sectionId: string;
  isVisible: boolean;
  visibilityRatio: number; // 0-1
  distanceFromTop: number; // px
};

// Sticky nav state
type StickyNavState = {
  activeSection: string | null;
  isSticky: boolean;
  opacity: number; // 0-1
};
```

## Performance

All functions are:
- **Pure**: No side effects, deterministic output
- **Lightweight**: Minimal computation, suitable for 60fps animations
- **Memoization-friendly**: Same inputs always produce same outputs
- **Worklet-compatible**: Can run on React Native UI thread

## Testing

```bash
npm test                  # Run unit tests
npm run test:coverage    # Generate coverage report
```

Target: >90% code coverage

## Architecture

```
parallax.ts     → Parallax offset, scale, opacity calculations
sections.ts     → Section visibility, lazy load, auto-collapse
stickyNav.ts    → Sticky nav state, active section detection
scrollMetrics.ts → Scroll velocity, direction, progress
constants.ts    → Centralized animation values
types.ts        → TypeScript type definitions
index.ts        → Public API exports
```

## Platform Usage

### Web (Next.js + Framer Motion)

Components import pure functions and use with Framer Motion hooks:

```typescript
import { useScroll, useTransform } from 'framer-motion';
import { calculateParallaxOffset } from '@tminuszero/launch-animations';

const { scrollY } = useScroll();
const y = useTransform(scrollY, latest => calculateParallaxOffset(latest, config));
```

### Mobile (React Native + Reanimated)

Components import pure functions and use in worklets:

```typescript
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';

const style = useAnimatedStyle(() => {
  'worklet';
  const offset = scrollY.value * ANIMATION_CONSTANTS.BACKGROUND_PARALLAX_SPEED;
  return { transform: [{ translateY: offset }] };
});
```

## Design Principles

1. **Platform Agnostic**: No framework dependencies, works everywhere
2. **Pure Functions**: Predictable, testable, cacheable
3. **Type Safe**: Full TypeScript with strict mode
4. **Performance First**: Optimized for 60fps animations
5. **Well Documented**: JSDoc comments on all public APIs

## License

Private package for TMinusZero monorepo
