type OrbitalLoaderProps = {
  label?: string;
  className?: string;
};

export function OrbitalLoader({ label = 'Loading', className }: OrbitalLoaderProps) {
  const classes = className ? `orbital-loader ${className}` : 'orbital-loader';

  return (
    <div className={classes} role="status" aria-live="polite" aria-label={label}>
      <div className="orbital-loader__tilt" aria-hidden="true">
        <div className="orbital-loader__ring" />
        <div className="orbital-loader__spin">
          <div className="orbital-loader__spinPath">
            <div className="orbital-loader__orbiter">
              <div className="orbital-loader__orbiterBody">
                <span className="orbital-loader__tail" />
                <svg className="orbital-loader__shuttle" viewBox="0 0 24 12" aria-hidden="true">
                  <rect x="2" y="3" width="12" height="6" rx="3" fill="currentColor" />
                  <path d="M14 2L22 6L14 10Z" fill="currentColor" />
                  <rect x="5" y="4.5" width="3" height="3" rx="1.5" className="orbital-loader__shuttle-window" />
                  <path d="M6 9L3.5 11L7.5 10Z" fill="currentColor" />
                </svg>
              </div>
            </div>
          </div>
        </div>
        <div className="orbital-loader__planet" />
      </div>
      <span className="sr-only" data-nosnippet>
        {label}
      </span>
    </div>
  );
}
