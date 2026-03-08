import type { AdminSummaryMode, AdminSummaryPayload, AdminSummaryResponse, SchedulerSummary } from './types';

export type AdminSummaryState = AdminSummaryPayload & { mode: AdminSummaryMode };

const FALLBACK_SCHEDULER: SchedulerSummary = {
  jobsEnabled: false,
  jobsBaseUrlSet: false,
  jobsApiKeySet: false,
  jobsAuthTokenSet: false,
  cronJobs: [],
  cronError: null
};

export const FALLBACK_ADMIN_SUMMARY: AdminSummaryState = {
  mode: 'stub',
  ingestionRuns: [],
  jobs: [],
  outboxCounts: { queued: 0, failed: 0, sentToday: 0 },
  trajectoryPipeline: null,
  alerts: [],
  scheduler: FALLBACK_SCHEDULER
};

function isAdminSummaryResponse(value: unknown): value is AdminSummaryResponse {
  if (!value || typeof value !== 'object') return false;
  return 'mode' in value && 'summary' in value;
}

export function parseAdminSummary(value: unknown): AdminSummaryState {
  if (!isAdminSummaryResponse(value)) return FALLBACK_ADMIN_SUMMARY;
  const mode = value.mode === 'db' ? 'db' : 'stub';
  const summary = value.summary && typeof value.summary === 'object' ? (value.summary as AdminSummaryPayload) : FALLBACK_ADMIN_SUMMARY;
  return {
    ...FALLBACK_ADMIN_SUMMARY,
    ...summary,
    scheduler: (summary as any)?.scheduler ?? FALLBACK_SCHEDULER,
    mode
  };
}

