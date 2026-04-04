'use client';

import { type ReactNode, useState } from 'react';

type ThirdPartyEmbedGateProps = {
  title: string;
  description: string;
  loadLabel: string;
  externalUrl: string;
  externalLabel?: string;
  className?: string;
  preview?: ReactNode;
  blocked?: boolean;
  blockedMessage?: ReactNode;
  children: ReactNode;
};

export function ThirdPartyEmbedGate({
  title,
  description,
  loadLabel,
  externalUrl,
  externalLabel = 'Open externally',
  className,
  preview,
  blocked = false,
  blockedMessage,
  children
}: ThirdPartyEmbedGateProps) {
  const [hasLoaded, setHasLoaded] = useState(false);

  return (
    <div className={className}>
      {hasLoaded && !blocked ? (
        children
      ) : (
        <div className="overflow-hidden rounded-xl border border-stroke bg-surface-0">
          {preview ? <div className="border-b border-stroke">{preview}</div> : null}
          <div className="space-y-3 p-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-text1">{title}</div>
              <p className="text-sm text-text3">
                {blocked ? blockedMessage : description}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!blocked ? (
                <button
                  type="button"
                  className="btn rounded-lg px-4 py-2 text-sm"
                  onClick={() => setHasLoaded(true)}
                >
                  {loadLabel}
                </button>
              ) : null}
              <a
                href={externalUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary rounded-lg px-4 py-2 text-sm"
              >
                {externalLabel}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
