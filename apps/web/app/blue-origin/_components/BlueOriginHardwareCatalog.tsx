'use client';

import Link from 'next/link';

type HardwareItem = {
  id: string;
  slug: string;
  name: string;
  status?: string | null;
  description?: string;
  specs?: { label: string; value: string }[];
  type: 'vehicle' | 'engine';
  engines?: HardwareItem[]; // Nested engines for vehicles
};

export function BlueOriginHardwareCatalog({ 
  items 
}: { 
  items: HardwareItem[] 
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {items.map((item) => (
        <div 
          key={item.id} 
          className="flex flex-col gap-4 rounded-xl border border-stroke bg-surface-1/40 p-6 transition-all hover:border-primary/40 hover:bg-surface-1"
        >
          <header className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-text3">
                {item.type} SPECIFICATION
              </span>
              <Link 
                href={`/blue-origin/${item.type === 'vehicle' ? 'vehicles' : 'engines'}/${item.slug}`}
                className="mt-1 text-lg font-bold text-text1 hover:text-primary"
              >
                {item.name}
              </Link>
            </div>
            {item.status && (
              <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] font-bold uppercase tracking-tighter text-text3">
                {item.status}
              </span>
            )}
          </header>

          {item.description && (
            <p className="text-sm leading-relaxed text-text2">
              {item.description}
            </p>
          )}

          {item.specs && item.specs.length > 0 && (
            <div className="grid grid-cols-2 gap-4 border-t border-stroke pt-4">
              {item.specs.map((spec) => (
                <div key={spec.label} className="flex flex-col">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-text3">
                    {spec.label}
                  </span>
                  <span className="font-mono text-xs font-semibold text-text2">
                    {spec.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {item.type === 'vehicle' && item.engines && item.engines.length > 0 && (
            <div className="mt-2 border-t border-stroke pt-4">
              <span className="text-[9px] font-bold uppercase tracking-widest text-text3">
                Propulsion System
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {item.engines.map((engine) => (
                  <Link 
                    key={engine.id}
                    href={`/blue-origin/engines/${engine.slug}`}
                    className="flex items-center gap-2 rounded-lg border border-stroke bg-surface-2 px-3 py-1.5 transition-colors hover:border-primary/60"
                  >
                    <span className="font-mono text-[10px] text-text1">{engine.name}</span>
                    <span className="text-[10px] text-text3">→</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
