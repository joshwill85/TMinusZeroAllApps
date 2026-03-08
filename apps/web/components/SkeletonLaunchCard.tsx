export function SkeletonLaunchCard() {
  return (
    <div className="launch-card w-full">
      <div className="launch-card__spine" aria-hidden="true">
        <div className="launch-card__spineTrack" />
        <div className="launch-card__spineFill" style={{ height: '70%' }} />
      </div>

      <div className="relative flex flex-col gap-4 p-4 pl-5">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="skeleton h-6 w-32 rounded-full" />
            <div className="mt-3 skeleton h-5 w-64 rounded" />
            <div className="mt-2 skeleton h-3 w-40 rounded" />
          </div>
          <div className="skeleton h-6 w-32 rounded-full" />
        </header>

        <section className="flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-4 w-56 rounded" />
            <div className="skeleton h-3 w-40 rounded" />
          </div>
          <div className="skeleton h-12 w-44 rounded-lg" />
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="skeleton h-10 w-24 rounded-lg" />
            <div className="skeleton h-10 w-20 rounded-lg" />
          </div>
          <div className="flex items-center gap-2">
            <div className="skeleton h-11 w-11 rounded-lg" />
            <div className="skeleton h-11 w-11 rounded-lg" />
          </div>
        </div>

        <footer className="grid grid-cols-3 gap-2 border-t border-white/5 pt-3">
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
        </footer>
      </div>
    </div>
  );
}
