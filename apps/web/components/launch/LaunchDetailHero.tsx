'use client';

import clsx from 'clsx';
import Image from 'next/image';

type LaunchDetailHeroProps = {
  backgroundImage: string | null;
  launchName: string;
  provider: string | null;
  vehicle: string | null;
  status: string | null;
  statusTone?: 'default' | 'success' | 'warning' | 'danger';
  tier: string | null;
  webcastLive: boolean;
  countdown: string | null;
  netTime: string | null;
  location: string | null;
  actionButtons: React.ReactNode;
  className?: string;
};

/**
 * Hero section for tab-based launch details (Web)
 * Responsive layout with background image
 */
export function LaunchDetailHero({
  backgroundImage,
  launchName,
  provider,
  vehicle,
  status,
  statusTone = 'default',
  tier,
  webcastLive,
  countdown,
  netTime,
  location,
  actionButtons,
  className,
}: LaunchDetailHeroProps) {
  return (
    <div className={clsx('relative overflow-hidden', className)}>
      {/* Background Image */}
      {backgroundImage && (
        <div className="absolute inset-0">
          <Image
            src={backgroundImage}
            alt={launchName}
            fill
            className="object-cover"
            priority
          />
          {/* Gradient Overlays */}
          <div className="absolute inset-0 bg-[rgba(4,7,16,0.08)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-[rgba(7,9,19,0.78)]" />
          <div className="absolute inset-y-0 left-0 w-[62%] bg-gradient-to-r from-[rgba(7,9,19,0.54)] via-[rgba(7,9,19,0.18)] to-transparent" />
          <div className="absolute right-0 top-0 h-80 w-80 rounded-full bg-cyan-300/10 blur-3xl" />
        </div>
      )}

      {/* Content */}
      <div className="relative mx-auto max-w-5xl px-4 py-16 md:px-8 md:py-20">
        <div className="grid gap-8 md:grid-cols-3">
          {/* Left Column: Main Info (2/3 width) */}
          <div className="space-y-6 md:col-span-2">
            <div className="rounded-[2rem] border border-white/10 bg-[rgba(7,9,19,0.56)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl md:max-w-[42rem] md:p-7">
              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                {status && (
                  <StatusBadge
                    label={status}
                    tone={statusTone}
                  />
                )}
                {tier && (
                  <Badge label={tier} variant="secondary" />
                )}
                {webcastLive && (
                  <LiveBadge />
                )}
              </div>

              {/* Provider */}
              {provider && (
                <p className="mt-5 text-sm font-semibold uppercase tracking-wider text-text2">
                  {provider}
                </p>
              )}

              {/* Launch Name */}
              <h1 className="mt-3 text-4xl font-extrabold leading-tight text-text1 md:text-5xl lg:text-6xl">
                {launchName}
              </h1>

              {/* Vehicle */}
              {vehicle && (
                <p className="mt-3 text-xl font-semibold text-primary md:text-2xl">
                  {vehicle}
                </p>
              )}

              {/* Action Buttons */}
              <div className="mt-6 flex flex-wrap gap-3">
                {actionButtons}
              </div>
            </div>
          </div>

          {/* Right Column: Countdown & Details (1/3 width) */}
          <div className="space-y-6 md:col-span-1">
            {/* Countdown */}
            {countdown && (
              <div className="rounded-[1.75rem] border border-white/10 bg-[rgba(7,9,19,0.54)] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <p className="text-sm font-medium text-text2 mb-2">
                  Countdown
                </p>
                <p className="text-3xl font-extrabold text-text1 tracking-tight">
                  {countdown}
                </p>
              </div>
            )}

            {/* NET Time & Location */}
            <div className="space-y-3 rounded-[1.75rem] border border-white/10 bg-[rgba(7,9,19,0.48)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] backdrop-blur-xl">
              {netTime && (
                <div className="flex items-center gap-3">
                  <span className="text-xl">🕐</span>
                  <span className="text-sm font-medium text-text2">
                    {netTime}
                  </span>
                </div>
              )}
              {location && (
                <div className="flex items-center gap-3">
                  <span className="text-xl">🌍</span>
                  <span className="text-sm font-medium text-text2">
                    {location}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper Components

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'default' | 'success' | 'warning' | 'danger';
}) {
  const colors = {
    default: 'border-primary/40 bg-primary/10 text-primary',
    success: 'border-green-500/40 bg-green-500/10 text-green-400',
    warning: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400',
    danger: 'border-red-500/40 bg-red-500/10 text-red-400',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-full border',
        colors[tone]
      )}
    >
      {label}
    </span>
  );
}

function Badge({
  label,
  variant,
}: {
  label: string;
  variant: 'secondary';
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-full border',
        variant === 'secondary' &&
          'border-stroke bg-surface-1/50 text-text2'
      )}
    >
      {label}
    </span>
  );
}

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-full border border-red-500/40 bg-red-500/10 text-red-400">
      <span className="flex h-2 w-2 items-center justify-center">
        <span className="absolute h-2 w-2 animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative h-2 w-2 rounded-full bg-red-500" />
      </span>
      LIVE
    </span>
  );
}
