'use client';

import { useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';

type LaunchHeroMediaFrameProps = {
  imageUrl: string | null;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function LaunchHeroMediaFrame({
  imageUrl,
  children,
  footer,
  className
}: LaunchHeroMediaFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start']
  });

  const imageY = useTransform(scrollYProgress, [0, 1], reducedMotion ? [0, 0] : [-14, 58]);
  const imageScale = useTransform(scrollYProgress, [0, 1], reducedMotion ? [1.06, 1.06] : [1.08, 1.18]);
  const panelY = useTransform(scrollYProgress, [0, 1], reducedMotion ? [0, 0] : [0, -18]);
  const panelScale = useTransform(scrollYProgress, [0, 1], reducedMotion ? [1, 1] : [1, 0.985]);
  const orbY = useTransform(scrollYProgress, [0, 1], reducedMotion ? [0, 0] : [0, -28]);

  return (
    <div
      ref={containerRef}
      className={clsx('relative isolate overflow-hidden rounded-2xl border border-stroke bg-surface-1', className)}
    >
      {imageUrl ? (
        <motion.div className="absolute inset-[-8%]" style={{ y: imageY, scale: imageScale }}>
          <img src={imageUrl} alt="" className="h-full w-full object-cover opacity-90" />
        </motion.div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 bg-[rgba(4,7,16,0.12)]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-black/35 to-[rgba(7,9,19,0.86)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(7,9,19,0.04),_rgba(7,9,19,0.22)_38%,_rgba(7,9,19,0.76)_100%)]" />
      <motion.div
        className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-300/12 blur-3xl"
        style={{ y: orbY }}
      />

      <div className="relative z-10 px-5 py-6 md:px-6 md:py-7 lg:px-8 lg:py-10">
        <div className="flex min-h-[32rem] items-center justify-center md:min-h-[35rem] lg:min-h-[38rem]">
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 20, scale: 0.985 }}
            animate={reducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            style={{ y: panelY, scale: panelScale }}
            className="w-full max-w-[56rem]"
          >
            {children}
          </motion.div>
        </div>

        {footer ? <div className="mx-auto mt-5 w-full max-w-[56rem]">{footer}</div> : null}
      </div>
    </div>
  );
}
