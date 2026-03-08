import Link from 'next/link';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { buildCatalogCollectionPath } from '@/lib/utils/catalog';

export type CommandDeckTileType =
  | 'launcher_configurations'
  | 'spacecraft_configurations'
  | 'agencies'
  | 'astronauts'
  | 'locations'
  | 'pads'
  | 'launchers'
  | 'space_stations'
  | 'expeditions'
  | 'docking_events'
  | 'events'
  | 'starship'
  | 'spacex_drone_ships'
  | 'catalog'
  | 'jellyfish_effect';

export type CommandDeckTileSize = 'hero' | 'tall' | 'medium' | 'standard' | 'system';

type AccentTone = 'primary' | 'secondary' | 'accent' | 'info' | 'success';

type TileMeta =
  | {
      kind: 'status';
      tone: AccentTone;
      label: string;
    }
  | {
      kind: 'stat';
      tone: AccentTone;
      value: string;
      label: string;
      showOnHover?: boolean;
    };

type TileConfig = {
  eyebrow: string;
  label: string;
  description: string;
  href: string;
  accent: AccentTone;
  icon: (props: { className?: string }) => ReactNode;
  meta?: TileMeta;
};

const TILE_CONFIG: Record<CommandDeckTileType, TileConfig> = {
  launcher_configurations: {
    eyebrow: 'Hardware',
    label: 'Launch Vehicles',
    description: 'Rocket configurations, variants, and manufacturer context.',
    href: buildCatalogCollectionPath('launcher_configurations'),
    accent: 'primary',
    icon: RocketIcon,
    meta: { kind: 'stat', tone: 'primary', value: '148', label: 'Active configurations', showOnHover: true }
  },
  spacecraft_configurations: {
    eyebrow: 'Hardware',
    label: 'Spacecraft',
    description: 'Crewed and uncrewed spacecraft configurations tracked by LL2.',
    href: buildCatalogCollectionPath('spacecraft_configurations'),
    accent: 'secondary',
    icon: CapsuleIcon,
    meta: { kind: 'stat', tone: 'secondary', value: 'LL2', label: 'Reference index' }
  },
  starship: {
    eyebrow: 'Dashboard',
    label: 'SpaceX Program',
    description: 'Starship, Falcon, and Dragon activity in one console.',
    href: '/spacex',
    accent: 'accent',
    icon: StarshipIcon,
    meta: { kind: 'status', tone: 'accent', label: 'Program hub' }
  },
  spacex_drone_ships: {
    eyebrow: 'Dashboard',
    label: 'Drone Ships',
    description: 'SpaceX ASDS recovery fleet with assignment KPIs and launch links.',
    href: '/spacex/drone-ships',
    accent: 'secondary',
    icon: DroneShipIcon,
    meta: { kind: 'stat', tone: 'secondary', value: '3', label: 'Ships tracked' }
  },
  catalog: {
    eyebrow: 'Terminal',
    label: 'Data Catalog',
    description: 'Filter, search, and switch entities in the LL2 catalog view.',
    href: '/catalog',
    accent: 'info',
    icon: CatalogIcon,
    meta: { kind: 'status', tone: 'info', label: 'Indexed' }
  },
  agencies: {
    eyebrow: 'Players',
    label: 'Agencies',
    description: 'Space agencies, manufacturers, and launch service providers.',
    href: buildCatalogCollectionPath('agencies'),
    accent: 'info',
    icon: AgencyIcon,
    meta: { kind: 'status', tone: 'info', label: 'Verified roster' }
  },
  astronauts: {
    eyebrow: 'Players',
    label: 'Astronauts',
    description: 'Crew roster with agency and flight history when available.',
    href: buildCatalogCollectionPath('astronauts'),
    accent: 'accent',
    icon: SuitIcon,
    meta: { kind: 'status', tone: 'accent', label: 'On deck' }
  },
  locations: {
    eyebrow: 'Places',
    label: 'Locations',
    description: 'Launch sites, regions, and the geography behind every launch.',
    href: buildCatalogCollectionPath('locations'),
    accent: 'primary',
    icon: GlobeIcon,
    meta: { kind: 'status', tone: 'primary', label: 'Map locked' }
  },
  pads: {
    eyebrow: 'Deep data',
    label: 'Pads',
    description: 'Individual launch pads within each location.',
    href: buildCatalogCollectionPath('pads'),
    accent: 'primary',
    icon: PadIcon,
    meta: { kind: 'status', tone: 'primary', label: 'Ready for ignition' }
  },
  launchers: {
    eyebrow: 'Deep data',
    label: 'First stages',
    description: 'Reusable cores and first stages with flight history when available.',
    href: buildCatalogCollectionPath('launchers'),
    accent: 'secondary',
    icon: BoosterIcon,
    meta: { kind: 'status', tone: 'secondary', label: 'Recovery tracking' }
  },
  space_stations: {
    eyebrow: 'Deep data',
    label: 'Stations',
    description: 'Active + historic stations with orbit and ownership context.',
    href: buildCatalogCollectionPath('space_stations'),
    accent: 'success',
    icon: StationIcon,
    meta: { kind: 'stat', tone: 'success', value: '2', label: 'Active orbiters' }
  },
  expeditions: {
    eyebrow: 'Deep data',
    label: 'Expeditions',
    description: 'Station expeditions and related crew activity.',
    href: buildCatalogCollectionPath('expeditions'),
    accent: 'info',
    icon: PatchIcon,
    meta: { kind: 'status', tone: 'info', label: 'Rotation logs' }
  },
  docking_events: {
    eyebrow: 'Deep data',
    label: 'Docking',
    description: 'Vehicle dockings and departures for visiting spacecraft.',
    href: buildCatalogCollectionPath('docking_events'),
    accent: 'secondary',
    icon: DockingIcon,
    meta: { kind: 'status', tone: 'secondary', label: 'Ports monitored' }
  },
  events: {
    eyebrow: 'Deep data',
    label: 'Events',
    description: 'Non-launch events: landings, tests, EVAs, and more.',
    href: buildCatalogCollectionPath('events'),
    accent: 'accent',
    icon: WaveIcon,
    meta: { kind: 'status', tone: 'accent', label: 'Telemetry stream' }
  },
  jellyfish_effect: {
    eyebrow: 'Guide',
    label: 'Jellyfish Effect',
    description: 'What it is, why it happens, and how to catch one with JEP.',
    href: '/jellyfish-effect',
    accent: 'accent',
    icon: JellyfishIcon,
    meta: { kind: 'status', tone: 'accent', label: 'Viewing guide' }
  }
};

const layoutBySize: Record<CommandDeckTileSize, string> = {
  hero: 'md:col-span-2 md:row-span-2',
  tall: 'md:col-span-1 md:row-span-2',
  medium: 'md:col-span-1 md:row-span-1',
  standard: 'md:col-span-1 md:row-span-1',
  system: 'md:col-span-1 md:row-span-1'
};

const paddingBySize: Record<CommandDeckTileSize, string> = {
  hero: 'p-6',
  tall: 'p-5',
  medium: 'p-5',
  standard: 'p-5',
  system: 'p-4'
};

const titleBySize: Record<CommandDeckTileSize, string> = {
  hero: 'text-2xl md:text-3xl',
  tall: 'text-xl md:text-2xl',
  medium: 'text-xl',
  standard: 'text-lg',
  system: 'text-base'
};

const descriptionBySize: Record<CommandDeckTileSize, string> = {
  hero: 'text-sm md:text-base',
  tall: 'text-sm',
  medium: 'text-sm',
  standard: 'text-sm',
  system: 'text-xs'
};

const accentBorder: Record<AccentTone, string> = {
  primary: 'hover:border-primary focus-visible:ring-primary/40',
  secondary: 'hover:border-secondary focus-visible:ring-secondary/35',
  accent: 'hover:border-accent focus-visible:ring-accent/30',
  info: 'hover:border-info focus-visible:ring-info/30',
  success: 'hover:border-success focus-visible:ring-success/30'
};

const accentIcon: Record<AccentTone, string> = {
  primary: 'text-primary/80',
  secondary: 'text-secondary/80',
  accent: 'text-accent/80',
  info: 'text-info/80',
  success: 'text-success/80'
};

export function CommandDeckTile({
  type,
  size,
  className,
  metaOverride
}: {
  type: CommandDeckTileType;
  size: CommandDeckTileSize;
  className?: string;
  metaOverride?: TileMeta;
}) {
  const config = TILE_CONFIG[type];
  const tileMeta = metaOverride || config.meta;
  const iconClassName = clsx(
    'h-6 w-6 transition-transform duration-700',
    type === 'locations' && 'motion-safe:group-hover:rotate-[220deg] motion-safe:group-active:rotate-[220deg]'
  );

  return (
    <Link
      href={config.href}
      className={clsx(
        'group relative flex h-full flex-col overflow-hidden rounded-3xl border border-stroke bg-[rgba(11,16,35,0.76)] shadow-surface backdrop-blur-xl transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
        'hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.99]',
        accentBorder[config.accent],
        layoutBySize[size],
        paddingBySize[size],
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0">
        <DeckBackdrop type={type} />
        <div
          className={clsx(
            'absolute -inset-x-16 top-0 h-20 opacity-0 transition-opacity duration-300',
            'bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.10),transparent)]',
            'motion-safe:[animation:windowScan_9s_linear_infinite] motion-reduce:[animation:none]',
            'group-hover:opacity-80'
          )}
        />
      </div>

      <div className="relative flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-text4">{config.eyebrow}</div>
            <div className={clsx('mt-2 font-semibold text-text1', titleBySize[size])}>{config.label}</div>
          </div>
          <div className={clsx('mt-1 shrink-0', accentIcon[config.accent])}>
            {config.icon({ className: iconClassName })}
          </div>
        </div>

        <div className={clsx('mt-2 max-w-[46ch] text-text2', descriptionBySize[size])}>{config.description}</div>

        <div className="mt-auto flex items-end justify-between gap-4 pt-4">
          <DeckMeta meta={tileMeta} />
          <ChevronIcon className="h-4 w-4 text-text3 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-text2" />
        </div>
      </div>
    </Link>
  );
}

function DeckMeta({ meta }: { meta?: TileMeta }) {
  if (!meta) return <div />;

  if (meta.kind === 'status') {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-stroke bg-[rgba(7,9,19,0.55)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-text3">
        <span className={clsx('h-1.5 w-1.5 rounded-full', toneDot(meta.tone), 'shadow-[0_0_18px_rgba(255,255,255,0.12)]')} />
        <span>{meta.label}</span>
      </div>
    );
  }

  const pill = (
    <div className="inline-flex items-center gap-2 rounded-full border border-stroke bg-[rgba(7,9,19,0.55)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-text3">
      <span className={clsx('h-1.5 w-1.5 rounded-full', toneDot(meta.tone), 'shadow-[0_0_18px_rgba(255,255,255,0.12)]')} />
      <span className="text-text1">{meta.value}</span>
      <span className="text-text3">{meta.label}</span>
    </div>
  );

  if (meta.showOnHover) {
    return (
      <div className="translate-y-1 opacity-0 transition-[transform,opacity] duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 group-active:translate-y-0 group-active:opacity-100 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100">
        {pill}
      </div>
    );
  }

  return pill;
}

function toneDot(tone: AccentTone) {
  switch (tone) {
    case 'primary':
      return 'bg-primary';
    case 'secondary':
      return 'bg-secondary';
    case 'accent':
      return 'bg-accent';
    case 'info':
      return 'bg-info';
    case 'success':
      return 'bg-success';
  }
}

function DeckBackdrop({ type }: { type: CommandDeckTileType }) {
  switch (type) {
    case 'launcher_configurations':
      return <LaunchVehiclesBackdrop />;
    case 'spacecraft_configurations':
      return <SpacecraftBackdrop />;
    case 'agencies':
      return <AgenciesBackdrop />;
    case 'astronauts':
      return <AstronautsBackdrop />;
    case 'locations':
      return <LocationsBackdrop />;
    case 'starship':
      return <StarshipBackdrop />;
    case 'catalog':
      return <CatalogBackdrop />;
    case 'jellyfish_effect':
      return <JellyfishBackdrop />;
    default:
      return <SystemBackdrop tone={TILE_CONFIG[type].accent} />;
  }
}

function LaunchVehiclesBackdrop() {
  return (
    <>
      <div className="absolute inset-0 transition-transform duration-[1600ms] ease-out motion-safe:group-hover:scale-[1.06] motion-reduce:transform-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(34,211,238,0.24),transparent_60%),radial-gradient(circle_at_80%_0%,rgba(124,92,255,0.20),transparent_55%),linear-gradient(135deg,rgba(15,22,49,0.88),rgba(7,9,19,0.94))]" />
        <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(to_right,rgba(234,240,255,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(234,240,255,0.14)_1px,transparent_1px)] [background-size:48px_48px]" />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="absolute -right-12 -bottom-16 h-[340px] w-[340px] text-[rgba(234,240,255,0.10)]"
          aria-hidden="true"
        >
          <path
            d="M12 2c-3.2 2.7-5.2 6.8-5.2 11v7.6l5.2-2.1 5.2 2.1V13c0-4.2-2-8.3-5.2-11z"
            stroke="currentColor"
            strokeWidth="0.6"
          />
          <path d="M9.2 12.2h5.6" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" />
          <path d="M10 8.6h4" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" />
          <circle cx="12" cy="10.5" r="1.3" stroke="currentColor" strokeWidth="0.6" />
          <path
            d="M7.3 16.4 5 18.3v-3.8l3.5-1.7"
            stroke="currentColor"
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
          <path
            d="M16.7 16.4 19 18.3v-3.8l-3.5-1.7"
            stroke="currentColor"
            strokeWidth="0.6"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.62)] via-[rgba(0,0,0,0.08)] to-transparent opacity-90" />
    </>
  );
}

function SpacecraftBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_18%,rgba(124,92,255,0.26),transparent_55%),radial-gradient(circle_at_18%_80%,rgba(34,211,238,0.12),transparent_60%),linear-gradient(135deg,rgba(11,16,35,0.90),rgba(7,9,19,0.96))]" />
      <svg
        viewBox="0 0 220 220"
        fill="none"
        className="absolute -right-10 top-2 h-[260px] w-[260px] text-[rgba(234,240,255,0.10)]"
        aria-hidden="true"
      >
        <circle cx="126" cy="96" r="72" stroke="currentColor" strokeWidth="1" opacity="0.45" />
        <circle cx="126" cy="96" r="44" stroke="currentColor" strokeWidth="1" opacity="0.32" />
        <path
          d="M88 168c22 14 66 14 88 0"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.45"
        />
        <path
          d="M82 86c22-16 66-16 88 0"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.35"
        />
        <circle cx="178" cy="64" r="3" fill="currentColor" opacity="0.55" />
        <circle cx="198" cy="102" r="2" fill="currentColor" opacity="0.35" />
        <circle cx="156" cy="22" r="2" fill="currentColor" opacity="0.28" />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.6)] via-transparent to-transparent opacity-85" />
    </>
  );
}

function AgenciesBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(96,165,250,0.22),transparent_60%),radial-gradient(circle_at_85%_85%,rgba(34,211,238,0.10),transparent_60%),linear-gradient(135deg,rgba(11,16,35,0.90),rgba(7,9,19,0.96))]" />
      <svg
        viewBox="0 0 300 220"
        fill="none"
        className="absolute -right-10 -bottom-8 h-[230px] w-[360px] text-[rgba(234,240,255,0.10)]"
        aria-hidden="true"
      >
        {Array.from({ length: 11 }).map((_, index) => {
          const x = 34 + (index % 4) * 78;
          const y = 34 + Math.floor(index / 4) * 62;
          const r = 22 + ((index * 7) % 10);
          return (
            <g key={index} opacity={0.55}>
              <circle cx={x} cy={y} r={r} stroke="currentColor" strokeWidth="1" />
              <path
                d={`M${x - r * 0.4} ${y + r * 0.15}L${x} ${y - r * 0.55}L${x + r * 0.4} ${y + r * 0.15}Z`}
                stroke="currentColor"
                strokeWidth="1"
                strokeLinejoin="round"
                opacity="0.75"
              />
              <path
                d={`M${x - r * 0.55} ${y + r * 0.55}h${r * 1.1}`}
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                opacity="0.5"
              />
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.56)] via-transparent to-transparent opacity-80" />
    </>
  );
}

function AstronautsBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_40%_20%,rgba(255,77,219,0.18),transparent_60%),radial-gradient(circle_at_80%_75%,rgba(124,92,255,0.14),transparent_60%),linear-gradient(135deg,rgba(11,16,35,0.90),rgba(7,9,19,0.96))]" />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="absolute -right-12 -bottom-10 h-[260px] w-[260px] text-[rgba(234,240,255,0.11)]"
        aria-hidden="true"
      >
        <path
          d="M9 8.2c0-1.7 1.4-3.2 3-3.2s3 1.4 3 3.2v1.3c0 .8-.3 1.5-.8 2l-.7.7v1.1h1.3c1.3 0 2.4 1.1 2.4 2.4V21H6.8v-3.3c0-1.3 1.1-2.4 2.4-2.4h1.3v-1.1l-.7-.7c-.5-.5-.8-1.3-.8-2V8.2z"
          stroke="currentColor"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        <path d="M10 9.4h4" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" opacity="0.65" />
        <path d="M9.2 17.8h5.6" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" opacity="0.6" />
        <path d="M9.2 19.6h5.6" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" opacity="0.45" />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.56)] via-transparent to-transparent opacity-80" />
    </>
  );
}

function LocationsBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(34,211,238,0.22),transparent_60%),radial-gradient(circle_at_80%_10%,rgba(96,165,250,0.12),transparent_60%),linear-gradient(135deg,rgba(11,16,35,0.90),rgba(7,9,19,0.96))]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,rgba(234,240,255,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(234,240,255,0.14)_1px,transparent_1px)] [background-size:62px_62px]" />
      <svg
        viewBox="0 0 220 220"
        fill="none"
        className="absolute -right-12 -bottom-14 h-[270px] w-[270px] text-[rgba(234,240,255,0.11)] transition-transform duration-[1200ms] ease-out motion-safe:group-hover:rotate-[18deg] motion-reduce:transform-none"
        aria-hidden="true"
      >
        <circle cx="118" cy="118" r="70" stroke="currentColor" strokeWidth="1.1" opacity="0.65" />
        <path
          d="M48 118h140"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.3"
        />
        <path
          d="M118 48c22 18 36 44 36 70s-14 52-36 70"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.42"
        />
        <path
          d="M118 48c-22 18-36 44-36 70s14 52 36 70"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.42"
        />
        <path
          d="M78 70c18 10 46 10 72 0"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.3"
        />
        <path
          d="M78 166c18-10 46-10 72 0"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.3"
        />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.56)] via-transparent to-transparent opacity-82" />
    </>
  );
}

function CatalogBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_25%,rgba(96,165,250,0.18),transparent_62%),radial-gradient(circle_at_80%_10%,rgba(34,211,238,0.16),transparent_60%),linear-gradient(135deg,rgba(11,16,35,0.90),rgba(7,9,19,0.96))]" />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="absolute -right-10 -bottom-10 h-[260px] w-[260px] text-[rgba(234,240,255,0.10)]"
        aria-hidden="true"
      >
        <ellipse cx="12" cy="6" rx="6.6" ry="3.3" stroke="currentColor" strokeWidth="0.7" opacity="0.55" />
        <path
          d="M5.4 6v7.5c0 1.8 3 3.3 6.6 3.3s6.6-1.5 6.6-3.3V6"
          stroke="currentColor"
          strokeWidth="0.7"
          opacity="0.5"
        />
        <path
          d="M5.4 10.2c0 1.8 3 3.3 6.6 3.3s6.6-1.5 6.6-3.3"
          stroke="currentColor"
          strokeWidth="0.7"
          opacity="0.35"
        />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.56)] via-transparent to-transparent opacity-80" />
    </>
  );
}

function StarshipBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,77,219,0.20),transparent_62%),radial-gradient(circle_at_80%_85%,rgba(34,211,238,0.10),transparent_64%),linear-gradient(135deg,rgba(11,16,35,0.90),rgba(7,9,19,0.96))]" />
      <svg
        viewBox="0 0 240 220"
        fill="none"
        className="absolute -right-12 -bottom-10 h-[220px] w-[320px] text-[rgba(234,240,255,0.11)]"
        aria-hidden="true"
      >
        <path
          d="M160 26c-18 22-28 48-30 78v78l30-10 30 10v-78c-2-30-12-56-30-78z"
          stroke="currentColor"
          strokeWidth="1.1"
          opacity="0.65"
        />
        <path d="M160 44v138" stroke="currentColor" strokeWidth="1.1" opacity="0.22" />
        <path
          d="M136 144c8 10 12 18 12 26"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.35"
        />
        <path
          d="M184 144c-8 10-12 18-12 26"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.35"
        />
        <path
          d="M44 178h106"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.28"
        />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.56)] via-transparent to-transparent opacity-82" />
    </>
  );
}

function SystemBackdrop({ tone }: { tone: AccentTone }) {
  const accent = (() => {
    switch (tone) {
      case 'primary':
        return 'rgba(34,211,238,0.12)';
      case 'secondary':
        return 'rgba(124,92,255,0.12)';
      case 'accent':
        return 'rgba(255,77,219,0.12)';
      case 'info':
        return 'rgba(96,165,250,0.12)';
      case 'success':
        return 'rgba(52,211,153,0.12)';
    }
  })();

  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at 20% 25%, ${accent}, transparent 60%), linear-gradient(135deg, rgba(11,16,35,0.92), rgba(7,9,19,0.96))`
        }}
      />
      <div className="absolute inset-0 opacity-[0.08] [background-image:repeating-linear-gradient(90deg,rgba(234,240,255,0.18)_0px,rgba(234,240,255,0.18)_1px,transparent_1px,transparent_16px)]" />
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.62)] via-transparent to-transparent opacity-85" />
    </>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M10 7l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RocketIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3c-3 2.6-5 6.7-5 10.7V20l5-2 5 2v-6.3C17 9.7 15 5.6 12 3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9.5 12h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="10.2" r="1.3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function CapsuleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3c3.5 0 6.3 2.8 6.3 6.3v5.2c0 3.6-2.9 6.5-6.5 6.5H12c-3.6 0-6.5-2.9-6.5-6.5V9.3C5.5 5.8 8.5 3 12 3z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M8 11.2h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      <path d="M9 7.8h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

function StarshipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 2.8c2 2.4 3.1 5.3 3.2 8.5V20l-3.2-1.2L8.8 20v-8.7c.1-3.2 1.2-6.1 3.2-8.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 6.2v12.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

function DroneShipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M3 16.2h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M5 16.2 7.8 9.8h8.8l2.4 6.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 9.8h8.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.65" />
      <path d="M11.4 9.8V6.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.65" />
      <path d="M12.9 6.2h2.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.65" />
    </svg>
  );
}

function CatalogIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <ellipse cx="12" cy="6.2" rx="7.2" ry="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4.8 6.2V14c0 1.8 3.2 3.2 7.2 3.2s7.2-1.4 7.2-3.2V6.2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M4.8 10c0 1.8 3.2 3.2 7.2 3.2s7.2-1.4 7.2-3.2" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
    </svg>
  );
}

function AgencyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3l7 4v6c0 5-3.5 8.2-7 9-3.5-.8-7-4-7-9V7l7-4z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.5 12.2l2 2.2 3-4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SuitIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M9 8.4c0-1.9 1.4-3.4 3-3.4s3 1.5 3 3.4v1.2c0 .8-.3 1.6-.8 2.1l-.7.7v1.1h1.4c1.4 0 2.6 1.2 2.6 2.6V21H6.8v-3.1c0-1.4 1.2-2.6 2.6-2.6h1.4v-1.1l-.7-.7c-.5-.5-.8-1.3-.8-2.1V8.4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 9.6h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.8 12H20.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
      <path
        d="M12 3.8c2.7 2.2 4.4 5.1 4.4 8.2S14.7 18 12 20.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M12 3.8C9.3 6 7.6 8.9 7.6 12S9.3 18 12 20.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

function PadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 21s6-4.7 6-10.5C18 6.6 15.3 4 12 4S6 6.6 6 10.5C6 16.3 12 21 12 21z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10.5" r="1.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function BoosterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M9 3h6v10.5c0 2.6-1.3 5-3 6.5-1.7-1.5-3-3.9-3-6.5V3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 7h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      <path d="M10 21h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function StationIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 12h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
      <path d="M12 4v16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
      <path d="M7.2 7.2 4.7 4.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16.8 7.2 19.3 4.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.2 16.8 4.7 19.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16.8 16.8 19.3 19.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function PatchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3l7 4v6c0 5-3.5 8.2-7 9-3.5-.8-7-4-7-9V7l7-4z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M12 7.4l1.2 2.4 2.6.4-1.9 1.9.5 2.6L12 13.4l-2.4 1.3.5-2.6-1.9-1.9 2.6-.4L12 7.4z" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function DockingIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="8" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11.2 12h1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M5 12H3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      <path d="M20.5 12H21.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

function WaveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M3.5 13c2.5 0 2.5-6 5-6s2.5 10 5 10 2.5-6 5-6 2.5 2 5 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function JellyfishIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3c-4 0-7 3-7 6.5 0 2 .8 3.8 2 5l.5 6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 3c4 0 7 3 7 6.5 0 2-.8 3.8-2 5l-.5 6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 14.5l-.8 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      <path d="M15 14.5l.8 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      <path d="M12 14.5V21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      <path d="M5 9.5c3.5 0 7 2.5 7 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
      <path d="M19 9.5c-3.5 0-7 2.5-7 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

function JellyfishBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(255,77,219,0.22),transparent_55%),radial-gradient(circle_at_20%_80%,rgba(124,92,255,0.16),transparent_60%),radial-gradient(circle_at_85%_70%,rgba(34,211,238,0.12),transparent_55%),linear-gradient(135deg,rgba(11,16,35,0.90),rgba(7,9,19,0.96))]" />
      <svg
        viewBox="0 0 220 220"
        fill="none"
        className="absolute -right-8 -bottom-6 h-[200px] w-[200px] text-[rgba(234,240,255,0.10)]"
        aria-hidden="true"
      >
        <path
          d="M110 30c-40 0-70 28-70 62 0 20 8 38 22 50l6 58"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.6"
        />
        <path
          d="M110 30c40 0 70 28 70 62 0 20-8 38-22 50l-6 58"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.6"
        />
        <path d="M80 142l-10 58" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
        <path d="M140 142l10 58" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
        <path d="M110 142v58" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
        <ellipse cx="110" cy="92" rx="50" ry="30" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.58)] via-transparent to-transparent opacity-85" />
    </>
  );
}
