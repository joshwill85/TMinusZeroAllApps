'use client';

import { motion } from 'framer-motion';
import { ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';

type LiveDataPulseProps = {
  children: React.ReactNode;
  variant?: 'glow' | 'dot' | 'both';
  color?: 'success' | 'primary' | 'warning' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

/**
 * Animated pulse effect for live data (countdown, status, etc.)
 * Provides subtle glow and/or dot indicator
 */
export function LiveDataPulse({
  children,
  variant = 'both',
  color = 'success',
  size = 'md',
  className = '',
}: LiveDataPulseProps) {
  const colors = {
    success: {
      glow: 'rgba(52, 211, 153, 0.6)',
      dot: 'rgb(52, 211, 153)',
      glowMin: 'rgba(52, 211, 153, 0.3)',
    },
    primary: {
      glow: 'rgba(34, 211, 238, 0.6)',
      dot: 'rgb(34, 211, 238)',
      glowMin: 'rgba(34, 211, 238, 0.3)',
    },
    warning: {
      glow: 'rgba(251, 191, 36, 0.6)',
      dot: 'rgb(251, 191, 36)',
      glowMin: 'rgba(251, 191, 36, 0.3)',
    },
    danger: {
      glow: 'rgba(251, 113, 133, 0.6)',
      dot: 'rgb(251, 113, 133)',
      glowMin: 'rgba(251, 113, 133, 0.3)',
    },
  };

  const dotSizes = {
    sm: 'h-2 w-2',
    md: 'h-3 w-3',
    lg: 'h-4 w-4',
  };

  const glowPadding = {
    sm: 'p-1',
    md: 'p-2',
    lg: 'p-3',
  };

  const colorScheme = colors[color];
  const showGlow = variant === 'glow' || variant === 'both';
  const showDot = variant === 'dot' || variant === 'both';

  const pulseAnimation = {
    opacity: [
      ANIMATION_CONSTANTS.LIVE_GLOW_MIN_OPACITY,
      ANIMATION_CONSTANTS.LIVE_GLOW_OPACITY,
      ANIMATION_CONSTANTS.LIVE_GLOW_MIN_OPACITY,
    ],
    scale: [1, 1.05, 1],
  };

  const pulseTiming = {
    duration: ANIMATION_CONSTANTS.LIVE_PULSE_DURATION / 1000,
    repeat: Infinity,
    ease: 'easeInOut',
  };

  return (
    <div className={`relative inline-block ${className}`}>
      {/* Pulsing glow background */}
      {showGlow && (
        <motion.div
          className={`absolute -inset-2 rounded-lg blur-md ${glowPadding[size]} pointer-events-none`}
          style={{
            backgroundColor: colorScheme.glowMin,
          }}
          animate={pulseAnimation}
          transition={pulseTiming}
        />
      )}

      {/* Content */}
      <div className="relative">
        {children}
      </div>

      {/* Animated dot indicator */}
      {showDot && (
        <motion.span
          className={`absolute -top-1 -right-1 ${dotSizes[size]} rounded-full shadow-lg`}
          style={{
            backgroundColor: colorScheme.dot,
          }}
          animate={{
            scale: [
              ANIMATION_CONSTANTS.LIVE_DOT_SCALE_MIN,
              ANIMATION_CONSTANTS.LIVE_DOT_SCALE_MAX,
              ANIMATION_CONSTANTS.LIVE_DOT_SCALE_MIN,
            ],
            opacity: [1, 0.5, 1],
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}
    </div>
  );
}

/**
 * Live badge with pulse effect
 */
export function LiveBadge({
  label = 'LIVE',
  className = '',
}: {
  label?: string;
  className?: string;
}) {
  return (
    <LiveDataPulse variant="both" color="danger" size="sm" className={className}>
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-danger/20 border border-danger/40 text-danger text-xs font-bold tracking-wider uppercase">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-danger"></span>
        </span>
        {label}
      </span>
    </LiveDataPulse>
  );
}

/**
 * Countdown display with pulse effect
 */
export function LiveCountdown({
  value,
  label,
  className = '',
}: {
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <LiveDataPulse variant="glow" color="primary" size="lg" className={className}>
      <div className="text-center">
        <div className="text-4xl md:text-5xl font-bold text-text1 tabular-nums">
          {value}
        </div>
        <div className="text-sm text-text3 uppercase tracking-wider font-semibold mt-1">
          {label}
        </div>
      </div>
    </LiveDataPulse>
  );
}

/**
 * Status indicator with pulse
 */
export function LiveStatus({
  status,
  color = 'success',
  size = 'md',
  className = '',
}: {
  status: string;
  color?: 'success' | 'primary' | 'warning' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <LiveDataPulse variant="dot" color={color} size={size} className={className}>
      <span className={`inline-block font-semibold ${textSizes[size]}`}>
        {status}
      </span>
    </LiveDataPulse>
  );
}
