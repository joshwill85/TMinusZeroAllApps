'use client';

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { ANIMATION_CONSTANTS } from '@tminuszero/launch-animations';

export type StatTile = {
  id: string;
  label: string;
  value: string;
  description?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
};

type InteractiveStatTilesProps = {
  tiles: StatTile[];
  columns?: 1 | 2 | 3 | 4;
  className?: string;
};

/**
 * Interactive stat tiles with stagger animations and hover effects
 * Uses shared animation constants for consistent behavior across platforms
 */
export function InteractiveStatTiles({
  tiles,
  columns = 3,
  className = '',
}: InteractiveStatTilesProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, {
    once: false,
    amount: ANIMATION_CONSTANTS.TILE_VISIBILITY_AMOUNT,
  });

  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  };

  return (
    <div ref={ref} className={`grid ${gridCols[columns]} gap-4 ${className}`}>
      {tiles.map((tile, index) => (
        <StatTileCard key={tile.id} tile={tile} index={index} isInView={isInView} />
      ))}
    </div>
  );
}

function StatTileCard({
  tile,
  index,
  isInView,
}: {
  tile: StatTile;
  index: number;
  isInView: boolean;
}) {
  const toneColors = {
    default: {
      border: 'border-stroke',
      bg: 'bg-surface-1',
      hoverBorder: 'group-hover:border-primary/40',
      hoverGradient: 'group-hover:from-primary/10',
    },
    primary: {
      border: 'border-primary/20',
      bg: 'bg-primary/5',
      hoverBorder: 'group-hover:border-primary/40',
      hoverGradient: 'group-hover:from-primary/15',
    },
    success: {
      border: 'border-success/20',
      bg: 'bg-success/5',
      hoverBorder: 'group-hover:border-success/40',
      hoverGradient: 'group-hover:from-success/15',
    },
    warning: {
      border: 'border-warning/20',
      bg: 'bg-warning/5',
      hoverBorder: 'group-hover:border-warning/40',
      hoverGradient: 'group-hover:from-warning/15',
    },
    danger: {
      border: 'border-danger/20',
      bg: 'bg-danger/5',
      hoverBorder: 'group-hover:border-danger/40',
      hoverGradient: 'group-hover:from-danger/15',
    },
  };

  const colors = toneColors[tile.tone || 'default'];

  return (
    <motion.div
      className="group relative"
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{
        duration: ANIMATION_CONSTANTS.TILE_ANIMATION_DURATION / 1000,
        delay: index * (ANIMATION_CONSTANTS.TILE_STAGGER_DELAY / 1000),
        ease: 'easeOut',
      }}
      whileHover={{
        scale: ANIMATION_CONSTANTS.TILE_SCALE_MAX,
        transition: { duration: 0.2 },
      }}
      whileTap={{
        scale: ANIMATION_CONSTANTS.TILE_SCALE_MIN,
        transition: { duration: 0.1 },
      }}
    >
      <div
        className={`
          relative rounded-2xl border ${colors.border} ${colors.bg} ${colors.hoverBorder}
          p-6 overflow-hidden cursor-pointer
          transition-colors duration-300
          backdrop-blur-sm
        `}
        style={{
          backdropFilter: `blur(${ANIMATION_CONSTANTS.GLASS_BLUR_RADIUS}px)`,
        }}
      >
        {/* Glassmorphic shine on hover */}
        <motion.div
          className={`
            absolute inset-0 bg-gradient-to-br from-transparent to-transparent
            ${colors.hoverGradient} group-hover:to-transparent
            transition-all duration-300 pointer-events-none
          `}
        />

        {/* Content */}
        <div className="relative z-10">
          {/* Icon and Label Row */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-text3 uppercase tracking-wider font-bold">
              {tile.label}
            </div>
            {tile.icon && <div className="text-text3 opacity-60">{tile.icon}</div>}
          </div>

          {/* Value */}
          <div className="text-3xl font-bold text-text1 mb-2 tabular-nums">
            {tile.value}
          </div>

          {/* Description */}
          {tile.description && (
            <div className="text-sm text-text2 leading-relaxed">
              {tile.description}
            </div>
          )}
        </div>

        {/* Bottom accent line */}
        <motion.div
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/0 group-hover:bg-primary/60"
          initial={false}
          transition={{ duration: 0.3 }}
        />
      </div>
    </motion.div>
  );
}

/**
 * Compact variant for smaller stat displays
 */
export function CompactStatTiles({
  tiles,
  className = '',
}: {
  tiles: StatTile[];
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      {tiles.map((tile, index) => (
        <motion.div
          key={tile.id}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-stroke bg-surface-1 backdrop-blur-sm"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            delay: index * 0.05,
            duration: 0.2,
          }}
          whileHover={{ scale: 1.05 }}
        >
          {tile.icon && <div className="text-text3">{tile.icon}</div>}
          <div>
            <div className="text-xs text-text3 uppercase tracking-wide font-bold">
              {tile.label}
            </div>
            <div className="text-sm font-bold text-text1 tabular-nums">
              {tile.value}
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
