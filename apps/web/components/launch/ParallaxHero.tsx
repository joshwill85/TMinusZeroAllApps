'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import Image from 'next/image';
import {
  calculateParallaxOffset,
  calculateParallaxScale,
  calculateParallaxOpacity,
  createParallaxConfig,
  ANIMATION_CONSTANTS,
} from '@tminuszero/launch-animations';

type ParallaxHeroProps = {
  backgroundImage: string | null;
  title: string;
  subtitle: string;
  status?: string;
  statusTone?: 'default' | 'success' | 'warning' | 'danger';
  children?: React.ReactNode;
};

/**
 * Parallax hero section for launch details
 * Features smooth depth effects with background image moving at different speed
 */
export function ParallaxHero({
  backgroundImage,
  title,
  subtitle,
  status,
  statusTone = 'default',
  children,
}: ParallaxHeroProps) {
  const { scrollY } = useScroll();

  // Create parallax config for background using shared logic
  const parallaxConfig = createParallaxConfig({
    speed: ANIMATION_CONSTANTS.BACKGROUND_PARALLAX_SPEED,
    direction: 'vertical',
    enabled: true,
  });

  // Background parallax offset
  const backgroundY = useTransform(scrollY, (latest) =>
    calculateParallaxOffset(latest, parallaxConfig)
  );

  // Content fade out as user scrolls
  const contentOpacity = useTransform(
    scrollY,
    [0, 300],
    [calculateParallaxOpacity(0, 0, 1), calculateParallaxOpacity(1, 0, 1)]
  );

  // Background scale effect (subtle zoom)
  const backgroundScale = useTransform(scrollY, [0, 300], [calculateParallaxScale(0), calculateParallaxScale(1)]);

  return (
    <div className="relative h-[60vh] min-h-[500px] overflow-hidden rounded-3xl border border-stroke">
      {/* Parallax Background Image */}
      {backgroundImage && (
        <motion.div
          className="absolute inset-0 -top-[20%] -bottom-[20%]"
          style={{ y: backgroundY }}
        >
          <motion.div
            className="relative w-full h-full"
            style={{ scale: backgroundScale }}
          >
            <Image
              src={backgroundImage}
              alt=""
              fill
              className="object-cover"
              sizes="100vw"
              priority
              quality={85}
            />
          </motion.div>
        </motion.div>
      )}

      {/* Gradient Overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/40 via-transparent to-background/40 pointer-events-none" />

      {/* Content Container */}
      <motion.div
        className="absolute inset-0 flex flex-col justify-end p-8 md:p-12"
        style={{ opacity: contentOpacity }}
      >
        {/* Status Badge */}
        {status && (
          <div className="mb-4">
            <span
              className={`
                inline-block px-4 py-2 rounded-full text-xs font-bold tracking-wider uppercase
                border backdrop-blur-sm
                ${
                  statusTone === 'success'
                    ? 'bg-success/20 border-success/40 text-success'
                    : statusTone === 'warning'
                      ? 'bg-warning/20 border-warning/40 text-warning'
                      : statusTone === 'danger'
                        ? 'bg-danger/20 border-danger/40 text-danger'
                        : 'bg-primary/20 border-primary/40 text-primary'
                }
              `}
            >
              {status}
            </span>
          </div>
        )}

        {/* Title */}
        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-text1 mb-3 leading-tight">
          {title}
        </h1>

        {/* Subtitle */}
        <p className="text-xl md:text-2xl text-text2 max-w-3xl leading-relaxed">
          {subtitle}
        </p>

        {/* Optional children for additional content */}
        {children && <div className="mt-6">{children}</div>}
      </motion.div>

      {/* Decorative elements */}
      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary/60 via-primary/30 to-transparent pointer-events-none" />
    </div>
  );
}

/**
 * Static hero fallback for reduced motion users
 */
export function StaticHero({
  backgroundImage,
  title,
  subtitle,
  status,
  statusTone = 'default',
  children,
}: ParallaxHeroProps) {
  return (
    <div className="relative h-[60vh] min-h-[500px] overflow-hidden rounded-3xl border border-stroke">
      {/* Static Background */}
      {backgroundImage && (
        <div className="absolute inset-0">
          <Image
            src={backgroundImage}
            alt=""
            fill
            className="object-cover"
            sizes="100vw"
            priority
            quality={85}
          />
        </div>
      )}

      {/* Gradients */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end p-8 md:p-12">
        {status && (
          <div className="mb-4">
            <span
              className={`
                inline-block px-4 py-2 rounded-full text-xs font-bold tracking-wider uppercase
                border backdrop-blur-sm
                ${
                  statusTone === 'success'
                    ? 'bg-success/20 border-success/40 text-success'
                    : statusTone === 'warning'
                      ? 'bg-warning/20 border-warning/40 text-warning'
                      : statusTone === 'danger'
                        ? 'bg-danger/20 border-danger/40 text-danger'
                        : 'bg-primary/20 border-primary/40 text-primary'
                }
              `}
            >
              {status}
            </span>
          </div>
        )}

        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-text1 mb-3 leading-tight">
          {title}
        </h1>

        <p className="text-xl md:text-2xl text-text2 max-w-3xl leading-relaxed">
          {subtitle}
        </p>

        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}
