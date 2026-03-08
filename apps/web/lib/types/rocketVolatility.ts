export type RocketVolatilityLaunch = {
  id: string;
  name: string;
};

export type RocketVolatilityPerLaunch = {
  launchId: string;
  name: string;
  timingUpdates: number;
  statusUpdates: number;
  totalUpdates: number;
  lastDetectedAt: string | null;
};

export type RocketVolatilitySummary = {
  lookbackDays: number;
  launchesAnalyzed: number;
  totalUpdates: number;
  timingUpdates: number;
  statusUpdates: number;
  medianNetSlipHours: number | null;
  avgTimingUpdatesPerLaunch: number;
  lastDetectedAt: string | null;
  mostVolatile: { launchId: string; name: string; timingUpdates: number } | null;
  perLaunch: RocketVolatilityPerLaunch[];
};

export type RocketVolatilityRequest = {
  lookbackDays?: number;
  launches: RocketVolatilityLaunch[];
};

export type RocketVolatilityResponse = {
  volatility: RocketVolatilitySummary;
};

