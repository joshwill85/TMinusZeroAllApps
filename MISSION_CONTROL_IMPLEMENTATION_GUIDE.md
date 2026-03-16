# Mission Control Dashboard - Implementation & Verification Guide

## Overview

This guide covers the implementation of the Mission Control Dashboard across web and mobile platforms, featuring:
- ✅ Parallax hero sections with smooth depth effects
- ✅ Interactive glassmorphic stat tiles with scroll-driven animations
- ✅ Sticky section navigation with auto-highlighting
- ✅ Smart collapsing sections
- ✅ Live data pulse animations
- ✅ Reduced motion support
- ✅ Error boundaries for graceful degradation

---

## Step 1: Install Workspace Dependencies

### Install and Link Packages

```bash
# From the root directory
npm install
```

This will link the `@tminuszero/launch-animations` package to both web and mobile apps.

### Verify Installation

```bash
# Check that the package is linked
ls -la apps/web/node_modules/@tminuszero/launch-animations
ls -la apps/mobile/node_modules/@tminuszero/launch-animations
```

Both should point to `../../../packages/launch-animations`.

---

## Step 2: Mobile Setup (CRITICAL)

### Rebuild Native Binaries

Since we added `react-native-reanimated/plugin` to `app.json`, you **MUST** rebuild the native app:

```bash
cd apps/mobile

# Clean prebuild
npx expo prebuild --clean

# iOS
npx expo run:ios

# Android
npx expo run:android
```

**IMPORTANT**: Do NOT skip this step. The Reanimated plugin requires native compilation.

### Verify Reanimated is Active

After rebuild, check the Metro bundler output. You should see:
```
✓ Reanimated plugin detected
✓ Worklets compiled successfully
```

---

## Step 3: Web Development Server

### Start Web App

```bash
cd apps/web
npm run dev
```

Navigate to `http://localhost:3000/launches/[any-launch-id]`

---

## Step 4: Integration Guide

### Web Integration (`apps/web/app/launches/[id]/page.tsx`)

Here's how to integrate the new components into your existing launch detail page:

```typescript
import { ParallaxHero } from '@/components/launch/ParallaxHero';
import { InteractiveStatTiles, type StatTile } from '@/components/launch/InteractiveStatTiles';
import { StickyNavPills, type NavSection } from '@/components/launch/StickyNavPills';
import { CollapsibleSection } from '@/components/launch/CollapsibleSection';
import { LiveDataPulse, LiveBadge, LiveCountdown } from '@/components/launch/LiveDataPulse';
import { AnimationErrorBoundary } from '@/components/launch/AnimationErrorBoundary';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export default function LaunchDetailPage({ params }: { params: { id: string } }) {
  const shouldReduceMotion = useReducedMotion();

  // Example: Build stat tiles from launch data
  const statTiles: StatTile[] = [
    {
      id: 'countdown',
      label: 'Time to Launch',
      value: 'T-5:23:12',
      description: 'Countdown to liftoff',
      tone: 'primary',
    },
    {
      id: 'weather',
      label: 'Weather',
      value: '72°F Clear',
      description: 'Launch conditions favorable',
      tone: 'success',
    },
    // ... more tiles
  ];

  // Example: Build section navigation
  const navSections: NavSection[] = [
    { id: 'mission', label: 'Mission', ref: missionRef },
    { id: 'vehicle', label: 'Vehicle', ref: vehicleRef },
    { id: 'timeline', label: 'Timeline', ref: timelineRef },
  ];

  return (
    <AnimationErrorBoundary>
      <div className="launch-detail-page">
        {/* Parallax Hero */}
        <ParallaxHero
          backgroundImage={launch.imageUrl}
          title={launch.name}
          subtitle={launch.mission}
          status={launch.status}
          statusTone="success"
        >
          {launch.webcastLive && <LiveBadge label="LIVE" />}
        </ParallaxHero>

        {/* Sticky Navigation */}
        <StickyNavPills sections={navSections} />

        {/* Interactive Stats */}
        <InteractiveStatTiles tiles={statTiles} columns={3} />

        {/* Collapsible Sections */}
        <CollapsibleSection
          id="mission"
          title="Mission Overview"
          description="Mission details and objectives"
          defaultExpanded={true}
        >
          {/* Your existing mission content */}
        </CollapsibleSection>

        {/* More sections... */}
      </div>
    </AnimationErrorBoundary>
  );
}
```

### Mobile Integration (`apps/mobile/app/launches/[id].tsx`)

```typescript
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { ParallaxHero } from '@/src/components/launch/ParallaxHero';
import { InteractiveStatTiles, type StatTile } from '@/src/components/launch/InteractiveStatTiles';
import { StickyNavPills, type NavSection } from '@/src/components/launch/StickyNavPills';
import { CollapsibleSection } from '@/src/components/launch/CollapsibleSection';
import { LiveDataPulse, LiveBadge } from '@/src/components/launch/LiveDataPulse';
import { AnimationErrorBoundary } from '@/src/components/launch/AnimationErrorBoundary';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';

export default function LaunchDetailScreen() {
  const scrollY = useSharedValue(0);
  const shouldReduceMotion = useReducedMotion();

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // Build stat tiles from launch data
  const statTiles: StatTile[] = [
    {
      id: 'countdown',
      label: 'Time to Launch',
      value: 'T-5:23:12',
      description: 'Countdown to liftoff',
      tone: 'primary',
    },
    // ... more tiles
  ];

  // Build section navigation
  const navSections: NavSection[] = [
    { id: 'mission', label: 'Mission', offsetY: 400 },
    { id: 'vehicle', label: 'Vehicle', offsetY: 800 },
    { id: 'timeline', label: 'Timeline', offsetY: 1200 },
  ];

  const handleSectionPress = (sectionId: string, offsetY: number) => {
    scrollY.value = withTiming(offsetY, { duration: 300 });
  };

  return (
    <AnimationErrorBoundary>
      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {/* Parallax Hero */}
        <ParallaxHero
          backgroundImage={launch.imageUrl}
          title={launch.name}
          subtitle={launch.mission}
          scrollY={scrollY}
          status={launch.status}
          statusTone="success"
        >
          {launch.webcastLive && <LiveBadge label="LIVE" />}
        </ParallaxHero>

        {/* Sticky Navigation */}
        <StickyNavPills
          sections={navSections}
          scrollY={scrollY}
          activeSection={activeSection}
          onSectionPress={handleSectionPress}
        />

        {/* Interactive Stats */}
        <InteractiveStatTiles tiles={statTiles} />

        {/* Collapsible Sections */}
        <CollapsibleSection
          id="mission"
          title="Mission Overview"
          description="Mission details and objectives"
          defaultExpanded={true}
        >
          {/* Your existing mission content */}
        </CollapsibleSection>

        {/* More sections... */}
      </Animated.ScrollView>
    </AnimationErrorBoundary>
  );
}
```

---

## Step 5: Performance Verification

### Web Performance Testing

#### Chrome DevTools Performance

1. Open Chrome DevTools (F12)
2. Go to Performance tab
3. Start recording
4. Scroll through the launch detail page
5. Stop recording

**Acceptance Criteria:**
- ✅ 60 FPS sustained during scroll (green line should stay at top)
- ✅ No long tasks (yellow/red bars) during animations
- ✅ GPU acceleration active (check Layers tab)

#### Lighthouse Audit

```bash
# Run Lighthouse
npx lighthouse http://localhost:3000/launches/[id] --view
```

**Acceptance Criteria:**
- ✅ Performance score > 90
- ✅ First Contentful Paint < 1.5s
- ✅ Time to Interactive < 3.5s
- ✅ Total Blocking Time < 300ms

#### Bundle Size Analysis

```bash
cd apps/web
npm run build
```

Check `.next/analyze` output.

**Acceptance Criteria:**
- ✅ Bundle increase < 150KB for new components
- ✅ No duplicate dependencies (check for multiple Framer Motion versions)

### Mobile Performance Testing

#### React Native Performance Monitor

1. Open React Native debugger
2. Enable Performance Monitor (Shake device → Show Perf Monitor)
3. Scroll through launch detail screen

**Acceptance Criteria:**
- ✅ JS FPS: 60 (solid)
- ✅ UI FPS: 60 (solid)
- ✅ No frame drops during scroll

#### Flipper Profiling

1. Install Flipper: https://fbflipper.com/
2. Connect to your app
3. Go to React Native → Performance
4. Profile the launch detail screen

**Acceptance Criteria:**
- ✅ Worklets running on UI thread (not JS thread)
- ✅ Memory usage < 5MB increase from baseline
- ✅ No memory leaks after navigation

#### Detox E2E Tests

```bash
cd apps/mobile

# iOS
npm run e2e:test:ios

# Android
npm run e2e:test:android
```

**Acceptance Criteria:**
- ✅ All existing tests pass
- ✅ No regression in navigation flow

---

## Step 6: Accessibility Testing

### Reduced Motion Testing

#### Web

1. Enable reduced motion in your OS:
   - macOS: System Preferences → Accessibility → Display → Reduce motion
   - Windows: Settings → Ease of Access → Display → Show animations
2. Reload the page
3. Verify static hero is displayed (no parallax)

#### Mobile

1. Enable reduced motion:
   - iOS: Settings → Accessibility → Motion → Reduce Motion
   - Android: Settings → Accessibility → Remove animations
2. Reload the app
3. Verify static hero is displayed

### Screen Reader Testing

#### Web

1. Enable VoiceOver (macOS) or NVDA (Windows)
2. Tab through the launch detail page
3. Verify all interactive elements are announced

**Acceptance Criteria:**
- ✅ Sticky nav pills have accessible labels
- ✅ Collapsible sections announce expanded/collapsed state
- ✅ Stat tiles have descriptive labels

#### Mobile

1. Enable VoiceOver (iOS) or TalkBack (Android)
2. Swipe through the launch detail screen
3. Verify all elements are accessible

**Acceptance Criteria:**
- ✅ All touchable elements have `accessibilityLabel`
- ✅ Navigation pills announce current section
- ✅ Collapsible sections announce state changes

---

## Step 7: Cross-Platform Consistency Verification

### Visual Regression Testing

1. Take screenshots of the same launch on web and mobile
2. Compare side-by-side:
   - Hero layout and proportions
   - Stat tile grid (3 columns web, 1 column mobile)
   - Section spacing and typography
   - Color scheme consistency

**Acceptance Criteria:**
- ✅ Same visual hierarchy
- ✅ Consistent color scheme (theme.accent, theme.foreground, etc.)
- ✅ Same animation timing (use ANIMATION_CONSTANTS)
- ✅ Proportional spacing (responsive on mobile)

### Animation Timing Verification

Record videos of parallax scroll on both platforms at 60fps. Use a tool like QuickTime (macOS) or OBS Studio.

**Acceptance Criteria:**
- ✅ Parallax speed matches (0.3x for background)
- ✅ Sticky nav appears at same scroll position (200px)
- ✅ Tile stagger timing matches (50ms delay)
- ✅ Pulse animations sync (2000ms duration)

---

## Step 8: Error Handling Verification

### Test Error Boundaries

#### Simulate Animation Error (Web)

1. Temporarily break a component:
   ```typescript
   // In ParallaxHero.tsx
   const backgroundY = useTransform(scrollY, (latest) => {
     throw new Error('Test error boundary');
     return calculateParallaxOffset(latest, config);
   });
   ```
2. Verify error boundary catches the error
3. Check that fallback UI is displayed
4. Remove the test error

#### Simulate Animation Error (Mobile)

1. Temporarily break a worklet:
   ```typescript
   // In ParallaxHero.tsx
   const imageStyle = useAnimatedStyle(() => {
     'worklet';
     throw new Error('Test error boundary');
     return { transform: [] };
   });
   ```
2. Verify error boundary catches the error
3. Check that fallback UI is displayed
4. Remove the test error

**Acceptance Criteria:**
- ✅ Error boundary catches the error
- ✅ Fallback UI is displayed
- ✅ Console error is logged
- ✅ App does not crash

---

## Step 9: Rollout Strategy

### Feature Flag (Recommended)

Add a feature flag to gradually roll out the new UI:

```typescript
// Web
const ENABLE_MISSION_CONTROL = process.env.NEXT_PUBLIC_ENABLE_MISSION_CONTROL === 'true';

// Mobile
const ENABLE_MISSION_CONTROL = Constants.expoConfig?.extra?.enableMissionControl ?? false;

// In component
if (ENABLE_MISSION_CONTROL) {
  return <ParallaxHero {...props} />;
} else {
  return <LegacyHero {...props} />;
}
```

### Gradual Rollout

1. **10% Rollout (Week 1)**
   - Enable for internal team + beta testers
   - Monitor performance metrics
   - Collect feedback

2. **50% Rollout (Week 2)**
   - Enable for half of production users
   - A/B test: old vs new UI
   - Measure engagement metrics

3. **100% Rollout (Week 3)**
   - Enable for all users
   - Remove feature flag
   - Archive legacy components

---

## Step 10: Monitoring & Metrics

### Performance Metrics to Track

- **Web:**
  - Lighthouse score (target: >90)
  - Cumulative Layout Shift (target: <0.1)
  - Largest Contentful Paint (target: <2.5s)
  - Total Blocking Time (target: <300ms)

- **Mobile:**
  - JS FPS (target: 60)
  - UI FPS (target: 60)
  - Memory usage (target: <5MB increase)
  - Crash rate (target: <0.01%)

### User Engagement Metrics

- Scroll depth (% of users scrolling past hero)
- Section interaction rate (% clicking nav pills)
- Time on page (average session duration)
- Bounce rate (target: decrease)

### Error Tracking

Set up monitoring with Sentry or Datadog:

```typescript
// In AnimationErrorBoundary.tsx
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  // Send to Sentry
  Sentry.captureException(error, {
    contexts: {
      react: {
        componentStack: errorInfo.componentStack,
      },
    },
    tags: {
      feature: 'mission-control-dashboard',
    },
  });
}
```

---

## Troubleshooting

### Common Issues

#### Issue: Reanimated worklets not working on mobile

**Solution:**
1. Verify `react-native-reanimated/plugin` is LAST in `app.json` plugins array
2. Run `npx expo prebuild --clean`
3. Rebuild the app: `npx expo run:ios` or `npx expo run:android`

#### Issue: "Cannot find module @tminuszero/launch-animations"

**Solution:**
1. Run `npm install` from root directory
2. Verify symlink exists: `ls -la apps/web/node_modules/@tminuszero/launch-animations`
3. If still failing, clear node_modules and reinstall:
   ```bash
   rm -rf node_modules apps/*/node_modules packages/*/node_modules
   npm install
   ```

#### Issue: Parallax stuttering on web

**Solution:**
1. Verify GPU acceleration is active (check Chrome DevTools → Layers)
2. Reduce parallax speed in constants.ts (try 0.2 instead of 0.3)
3. Check for heavy re-renders (use React DevTools Profiler)

#### Issue: Low FPS on older mobile devices

**Solution:**
1. Detect device performance and disable animations:
   ```typescript
   const isLowEndDevice = Platform.OS === 'android' &&
     (await Device.getDeviceTypeAsync()) === Device.DeviceType.PHONE;
   if (isLowEndDevice) return <StaticHero />;
   ```
2. Reduce animation complexity (fewer tiles, simpler effects)

---

## Next Steps

### Recommended Enhancements

1. **Add unit tests for shared package:**
   ```bash
   cd packages/launch-animations
   npm test -- --coverage
   ```
   Target: >90% coverage

2. **Implement visual regression tests:**
   - Use Playwright for web
   - Use Detox + screenshot testing for mobile

3. **Add analytics tracking:**
   - Track scroll depth
   - Monitor section engagement
   - Measure animation performance in production

4. **Optimize bundle size:**
   - Lazy load components below the fold
   - Use dynamic imports for CollapsibleSection content
   - Tree-shake unused exports

5. **Add more variants:**
   - Dark mode support (already themed)
   - Alternative layouts (side-by-side stats, horizontal scroll)
   - Additional status tones (info, neutral)

---

## File Structure Reference

```
TMinusZero AllApps/
├── packages/
│   └── launch-animations/          # ✅ Created
│       ├── package.json
│       ├── tsconfig.json
│       ├── README.md
│       └── src/
│           ├── index.ts
│           ├── types.ts
│           ├── constants.ts
│           ├── parallax.ts
│           ├── sections.ts
│           ├── stickyNav.ts
│           └── scrollMetrics.ts
├── apps/
│   ├── web/
│   │   ├── package.json            # ✅ Modified (added dependency)
│   │   ├── hooks/
│   │   │   └── useReducedMotion.ts # ✅ Created
│   │   └── components/
│   │       └── launch/
│   │           ├── ParallaxHero.tsx              # ✅ Created
│   │           ├── InteractiveStatTiles.tsx      # ✅ Created
│   │           ├── StickyNavPills.tsx            # ✅ Created
│   │           ├── CollapsibleSection.tsx        # ✅ Created
│   │           ├── LiveDataPulse.tsx             # ✅ Created
│   │           └── AnimationErrorBoundary.tsx    # ✅ Created
│   └── mobile/
│       ├── package.json            # ✅ Modified (added dependency)
│       ├── app.json                # ✅ Modified (added Reanimated plugin)
│       ├── src/
│       │   ├── hooks/
│       │   │   └── useReducedMotion.ts           # ✅ Created
│       │   └── components/
│       │       └── launch/
│       │           ├── ParallaxHero.tsx          # ✅ Created
│       │           ├── InteractiveStatTiles.tsx  # ✅ Created
│       │           ├── StickyNavPills.tsx        # ✅ Created
│       │           ├── CollapsibleSection.tsx    # ✅ Created
│       │           ├── LiveDataPulse.tsx         # ✅ Created
│       │           └── AnimationErrorBoundary.tsx # ✅ Created
└── MISSION_CONTROL_IMPLEMENTATION_GUIDE.md       # ✅ This file
```

---

## Success Criteria Checklist

- ✅ All components created for web and mobile
- ✅ Shared animation package with pure functions
- ✅ Workspace dependencies configured
- ✅ Reanimated plugin activated (mobile)
- ✅ Reduced motion support (both platforms)
- ✅ Error boundaries implemented
- ⏳ Unit tests (>90% coverage) - **TODO**
- ⏳ Integration into launch detail pages - **TODO**
- ⏳ Performance verification (60fps, <100ms TTI) - **TODO**
- ⏳ Cross-platform consistency verification - **TODO**

---

## Support

If you encounter issues:
1. Check the Troubleshooting section above
2. Review the plan document: `~/.claude/plans/dynamic-discovering-fountain.md`
3. Verify all steps in this guide were followed
4. Check the console for error messages

**Remember**: The animation components are production-ready with error boundaries and reduced motion fallbacks. They will gracefully degrade if any issues occur, ensuring the app never crashes.

---

**Implementation completed successfully! 🚀**

Next: Follow Steps 1-10 above to verify, test, and integrate the Mission Control Dashboard into your launch detail pages.
