import type { TrajectoryContract } from '@/lib/server/trajectoryContract';
import {
  deriveJepGuidanceTrackSamples,
  type JepGuidanceObserver,
  type JepGuidanceTrackSample
} from '@/lib/jep/guidance';

export type JepWeatherSamplingMode = 'visible_path' | 'sunlit_path' | 'modeled_path';
export type JepWeatherSampleRole = 'observer' | 'path_start' | 'path_mid' | 'path_end';

export type JepWeatherSamplePoint = {
  role: JepWeatherSampleRole;
  latDeg: number;
  lonDeg: number;
  tPlusSec: number | null;
  altitudeM: number | null;
  azimuthDeg: number | null;
  elevationDeg: number | null;
};

export type JepWeatherSamplingPlan = {
  mode: JepWeatherSamplingMode;
  note: string;
  points: JepWeatherSamplePoint[];
};

export function deriveJepWeatherSamplingPlan({
  trajectory,
  observer,
  launchNetIso
}: {
  trajectory: TrajectoryContract | null;
  observer: JepGuidanceObserver | null;
  launchNetIso: string | null;
}): JepWeatherSamplingPlan | null {
  if (!trajectory || !observer) return null;

  const samples = deriveJepGuidanceTrackSamples({
    trajectory,
    observer,
    launchNetIso
  });
  if (!samples.length) return null;

  const visibleSamples = samples.filter((sample) => sample.visible);
  const sunlitSamples = samples.filter((sample) => sample.sunlit);
  const selected =
    visibleSamples.length > 0
      ? visibleSamples
      : sunlitSamples.length > 0
        ? sunlitSamples
        : samples;
  const mode: JepWeatherSamplingMode =
    visibleSamples.length > 0 ? 'visible_path' : sunlitSamples.length > 0 ? 'sunlit_path' : 'modeled_path';

  const pointSamples = selectPathSamples(selected);
  return {
    mode,
    note: samplingNote(mode),
    points: [
      {
        role: 'observer',
        latDeg: observer.latDeg,
        lonDeg: observer.lonDeg,
        tPlusSec: null,
        altitudeM: null,
        azimuthDeg: null,
        elevationDeg: null
      },
      ...pointSamples.map((sample, index) => mapSamplePoint(sample, index))
    ]
  };
}

function selectPathSamples(samples: JepGuidanceTrackSample[]) {
  if (samples.length === 1) return [samples[0]];
  if (samples.length === 2) return [samples[0], samples[1]];
  const midIndex = Math.floor((samples.length - 1) / 2);
  return [samples[0], samples[midIndex], samples[samples.length - 1]];
}

function mapSamplePoint(sample: JepGuidanceTrackSample, index: number): JepWeatherSamplePoint {
  const role: JepWeatherSampleRole = index === 0 ? 'path_start' : index === 1 ? 'path_mid' : 'path_end';
  return {
    role,
    latDeg: sample.latDeg,
    lonDeg: sample.lonDeg,
    tPlusSec: Math.round(sample.tPlusSec),
    altitudeM: Math.round(sample.altM),
    azimuthDeg: round(sample.azDeg, 1),
    elevationDeg: round(sample.elDeg, 1)
  };
}

function samplingNote(mode: JepWeatherSamplingMode) {
  if (mode === 'visible_path') {
    return 'Sample the observer plus the start, middle, and end of the visible plume path.';
  }
  if (mode === 'sunlit_path') {
    return 'No clearly visible plume segment is modeled, so sample the strongest sunlit path instead.';
  }
  return 'No visible or sunlit plume segment is modeled, so sample the broader modeled path for planning only.';
}

function round(value: number, digits: number) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
