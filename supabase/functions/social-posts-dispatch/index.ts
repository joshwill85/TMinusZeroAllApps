import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringArraySetting, readStringSetting } from '../_shared/settings.ts';

const UPLOAD_POST_BASE = 'https://api.upload-post.com/api';
const DEFAULT_TIMEZONE = 'America/New_York';
const PACIFIC_TIMEZONE = 'America/Los_Angeles';
const US_PAD_COUNTRY_CODES = ['USA', 'US'];
const DEFAULT_OG_IMAGE_TIMEOUT_MS = 12_000;
const MIN_OG_IMAGE_TIMEOUT_MS = 2_000;
const MAX_OG_IMAGE_TIMEOUT_MS = 25_000;
const MAX_SOCIAL_IMAGE_BYTES = 12_000_000;
const LAUNCH_DAY_OG_VERSION_PREFIX = 'social';
const LAUNCH_DAY_POST_WINDOW_MS = 60 * 60 * 1000;
const LAUNCH_DAY_POST_GRACE_MS = 15 * 60 * 1000;
const LAUNCH_DAY_POST_TOTAL_WINDOW_MS = 3 * LAUNCH_DAY_POST_WINDOW_MS;
const LAUNCH_DAY_RETRY_SLOT_MINUTES = [10, 40] as const;
const MAX_TEMPLATE_RENDER_LEN = 100_000;
const DEFAULT_X_MAX_CHARS = 25_000;
const MIN_X_MAX_CHARS = 280;
const MAX_X_MAX_CHARS = 25_000;
const FACEBOOK_MAX_CHARS = 280;
const DEFAULT_DISPATCH_RUNTIME_BUDGET_MS = 50_000;
const MIN_DISPATCH_RUNTIME_BUDGET_MS = 10_000;
const MAX_DISPATCH_RUNTIME_BUDGET_MS = 240_000;
const DEFAULT_DISPATCH_CLAIM_BATCH_SIZE = 200;
const MIN_DISPATCH_CLAIM_BATCH_SIZE = 1;
const MAX_DISPATCH_CLAIM_BATCH_SIZE = 500;
const DEFAULT_SOCIAL_POST_SEND_LOCK_STALE_MINUTES = 15;
const MIN_SOCIAL_POST_SEND_LOCK_STALE_MINUTES = 1;
const MAX_SOCIAL_POST_SEND_LOCK_STALE_MINUTES = 240;
const SOCIAL_POSTS_DISPATCH_LOCK_NAME = 'social_posts_dispatch';
const RUNTIME_GUARD_MS = 1_000;
const DEFAULTS = {
  enabled: true,
  dryRun: false,
  horizonHours: 48,
  windowMinutes: 20,
  maxPerRun: 6,
  maxAttempts: 3,
  retryWindowHours: 6,
  utmSource: 'x',
  utmMedium: 'organic_social',
  utmCampaign: 'launch-day',
  utmContent: 'launch-day'
};

const SUPPORTED_PLATFORMS = ['x', 'facebook'] as const;
type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

function normalizePlatforms(values: string[]): SupportedPlatform[] {
  const out: SupportedPlatform[] = [];
  for (const value of values) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (!normalized) continue;
    if (!SUPPORTED_PLATFORMS.includes(normalized as SupportedPlatform)) continue;
    if (!out.includes(normalized as SupportedPlatform)) out.push(normalized as SupportedPlatform);
  }
  return out;
}

function resolveUtmSourceForPlatform({
  utmSource,
  platform,
  enabledPlatforms
}: {
  utmSource: string;
  platform: SupportedPlatform;
  enabledPlatforms: SupportedPlatform[];
}) {
  if (!utmSource) return platform;
  if (enabledPlatforms.length > 1 && utmSource === DEFAULTS.utmSource) return platform;
  return utmSource;
}

function normalizeLaunchDayMainTextForPlatform(text: string, platform: SupportedPlatform) {
  if (platform === 'facebook') return text.replaceAll('Link in reply', 'Link in comments');
  return text;
}

// ============================================================================
// HUMANIZED TEMPLATE SYSTEM v2
// ============================================================================
// Design principles:
// 1. VARY DRAMATICALLY - short punchy posts AND longer narrative ones
// 2. CONVERSATIONAL - write like texting a friend who loves space
// 3. IMPERFECT - not every post needs all data points
// 4. NATURAL TIMING WORDS - "tonight", "this morning" vs formal times
// 5. EMOJI RESTRAINT - use sparingly, not as bullet points
// 6. AUTHENTIC EXCITEMENT - not corporate enthusiasm
// ============================================================================

const LAUNCH_DAY_PREFACE_TEMPLATES_BY_PAD_STATE: Record<string, string[]> = {
  FL: [
    // Casual morning greetings
    'Space Coast, rise and shine.',
    'Morning from the Cape.',
    'Florida launch day.',
    'Cape Canaveral checking in.',
    'Woke up to a rocket on the pad.',
    'Coffee and countdown kind of morning.',
    'The Cape is ready.',
    'Another day at the office. (The office is a launchpad.)',
    'KSC area, you know the drill.',
    'Good morning to the Brevard crew.',
    // Regional/local flavor
    'Hope A1A traffic is treating you well.',
    'Titusville, eyes up.',
    'Cocoa Beach starting the day right.',
    'The pelicans are circling. They know something.',
    'Space Coast weather is looking cooperative.',
    // Short and punchy
    'Here we go, Florida.',
    'Launch day vibes.',
    'Pad is hot.',
    'The Cape never gets old.',
    'Let\'s do this.'
  ],
  TX: [
    // Casual morning greetings
    'South Texas, let\'s go.',
    'Morning from Starbase.',
    'Boca Chica waking up.',
    'Texas launch day.',
    'The Gulf Coast is ready.',
    'Starbase checking in.',
    'Another day in rocket country.',
    'Coffee\'s strong, steel\'s stronger.',
    'Brownsville, you\'re up.',
    'South Padre neighbors, good morning.',
    // Regional/local flavor
    'The beach is calm. That\'ll change.',
    'Starship weather check looking good.',
    'Dust settling before liftoff.',
    'The road closure is in effect.',
    'Can see the stack from here.',
    // Short and punchy
    'Here we go, Texas.',
    'Launch day.',
    'Pad is active.',
    'Starbase never sleeps.',
    'Let\'s make some noise.'
  ],
  CA: [
    // Casual morning greetings
    'West Coast, rise and shine.',
    'Morning from Vandenberg.',
    'California launch day.',
    'Central Coast checking in.',
    'Fog\'s clearing. Pad\'s ready.',
    'Lompoc waking up to rocket day.',
    'Another polar orbit loading.',
    'Pacific views and launchpads.',
    'Vandenberg reporting in.',
    'The coast with the rockets.',
    // Regional/local flavor
    'Marine layer cooperating today.',
    'Coastal quiet before the rumble.',
    'SLC-4 is looking good.',
    'West Coast launch vibes.',
    'The cliffs have the best seats.',
    // Short and punchy
    'Here we go, California.',
    'Launch day on the coast.',
    'Pad is ready.',
    'Vandenberg never disappoints.',
    'Time to light it up.'
  ]
};

function normalizePadState(value: string | null) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (!raw) return null;
  if (raw === 'FLORIDA') return 'FL';
  if (raw === 'TEXAS') return 'TX';
  if (raw === 'CALIFORNIA') return 'CA';
  if (raw.length === 2) return raw;
  return raw;
}

function resolveLaunchDayPrefaceTemplates(launch: LaunchRow) {
  const state = normalizePadState(launch.pad_state);
  if (!state) return null;
  const templates = LAUNCH_DAY_PREFACE_TEMPLATES_BY_PAD_STATE[state];
  if (!templates?.length) return null;
  return { state, templates };
}

function hasLaunchDayLinkLine(value: string) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.startsWith('link in ');
}

function stripLaunchDayLinkLine(text: string) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const lines = trimmed.split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (!lines.length) return '';
  const lastLine = String(lines[lines.length - 1] || '').trim();
  if (!hasLaunchDayLinkLine(lastLine)) return trimmed;
  lines.pop();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n').trim();
}

function prefixLaunchDayText({ preface, mainText, maxLen = 280 }: { preface: string; mainText: string; maxLen?: number }) {
  const prefix = String(preface || '').trim();
  if (!prefix) return mainText;
  const base = String(mainText || '').trim();
  if (!base) return truncateText(prefix, maxLen);

  const candidate = `${prefix}\n${base}`;
  if (candidate.length <= maxLen) return candidate;

  const lines = base
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return truncateText(prefix, maxLen);

  const lastLine = lines[lines.length - 1] || '';
  if (!hasLaunchDayLinkLine(lastLine)) return truncateText(candidate, maxLen);

  const body = lines.slice(0, -1).join('\n');
  const tail = lastLine;
  const overhead = prefix.length + 1 + tail.length + 1;
  const remaining = maxLen - overhead;
  if (remaining <= 0) return truncateText(`${prefix}\n${tail}`, maxLen);

  const bodyTrimmed = body.trim();
  if (!bodyTrimmed) return truncateText(`${prefix}\n${tail}`, maxLen);

  const bodyTruncated = truncateText(bodyTrimmed, remaining);
  return `${prefix}\n${bodyTruncated}\n${tail}`;
}

const NO_LAUNCH_DAY_PREFACE_TEMPLATES = [
  // Simple and direct
  'No US launches today.',
  'Quiet day on the pads.',
  'Nothing launching stateside today.',
  'US pads are dark today.',
  'No rockets going up in the US today.',
  'Rest day for the launch pads.',
  // Casual observations
  'The Cape is quiet. Weird feeling.',
  'No countdowns today. Feels strange.',
  'Pads are standing by.',
  'Nothing on the US schedule today.',
  'All quiet on the launch front.',
  'No fire, no fury. Just waiting.',
  // Looking ahead
  'Taking a breather before the next one.',
  'Catch up day. Next launch coming soon.',
  'Good day to review the upcoming schedule.',
  'No launch, but plenty coming.',
  // With a touch of personality
  'The rockets are resting.',
  'Even launchpads need days off.',
  'Suspiciously calm skies.',
  'No launches. Time to hydrate.'
];

const ON_THIS_DAY_TEMPLATES = [
  // Story-style
  'But on this day in {on_this_day_date_local}, {provider} launched {mission} from {launch_site_short}.\n\n{on_this_day_mission_brief}',
  'On this day ({on_this_day_date_local}): {mission} lifted off on a {rocket}.\n\n{on_this_day_mission_brief}',
  'Throwback: {on_this_day_date_local}. {provider} sent {mission} to orbit from {pad_short}.\n\n{on_this_day_mission_brief}',
  // Conversational
  '{on_this_day_date_local} saw {provider} launch {mission}. {on_this_day_mission_brief}',
  'Years ago today, a {rocket} carried {mission} from {launch_site_short}. {on_this_day_mission_brief}',
  // Minimal
  'On this day: {mission} ({provider}, {on_this_day_date_local})\n{on_this_day_mission_brief}',
  'This day in space history: {mission}. {on_this_day_mission_brief}',
  // With context
  'While the pads rest today, we look back. {on_this_day_date_local}: {mission} launched on {rocket}. {on_this_day_mission_brief}'
];

const MAIN_TEMPLATES_TODAY = [
  // === ULTRA SHORT (71-100 chars optimal for engagement) ===
  '{provider} going up today. {rocket}. {launch_time_local}.',
  '{rocket} launching today from {pad_short}. {launch_time_local}.',
  '{provider} {rocket} today. {mission}. {launch_time_local}.',
  'Launch day. {provider} {rocket}. {pad_short}. {launch_time_local}.',
  '{mission} is up today. {provider}. {launch_time_local}.',
  '{provider} launch today. {rocket} from {pad_short}. {launch_time_local}.',
  '{rocket} today. {mission}. Target: {launch_time_local}.',

  // === CONVERSATIONAL (compact, ~80-110 chars) ===
  '{provider} is launching today from {pad_short}. Target: {launch_time_local}.',
  'Today: {provider} {rocket} carrying {mission}. {launch_time_local}.',
  '{rocket} on the pad at {pad_short}. {provider} targeting {launch_time_local}.',
  'Heads up: {provider} {mission} today. {launch_time_local} from {pad_short}.',
  '{provider} {rocket} ready at {pad_short}. Mission: {mission}. {launch_time_local}.',

  // === WITH WEATHER (keeps it tight) ===
  '{provider} {rocket} today. {launch_time_local}. {weather_short}.',
  '{rocket} from {pad_short} at {launch_time_local}. Weather: {weather_short}.',
  '{mission} today. {provider}. {launch_time_local}. {weather_short}, {temp_f}.',

  // === INFO-FORWARD (multi-line, ~100-140 chars) ===
  '{provider} {rocket}\n{mission}\n{pad_short} at {launch_time_local}',
  'Today from {pad_short}:\n{provider} {rocket}\n{mission}\nTarget: {launch_time_local}',
  '{mission}\n{provider} {rocket}\n{launch_time_local}\n{weather_short}, {temp_f}',

  // === NARRATIVE (story-style, varied lengths) ===
  'A {rocket} sits on {pad_short}. {provider} targeting {launch_time_local}.',
  '{provider} is ready. {rocket} goes up from {pad_short} at {launch_time_local}.',
  'Pad is hot. {provider} {rocket}. {launch_time_local}. {mission}.',

  // === MINIMAL (40-60 chars, punchy) ===
  '{provider} {rocket} today. {launch_time_local}.',
  '{mission}. {provider}. {launch_time_local}.',
  '{provider}. {rocket}. {pad_short}. {launch_time_local}.',

  // === WITH HASHTAG (1-2 hashtags = 21% more engagement) ===
  '{provider} {rocket} today. {launch_time_local}. {provider_hashtag}',
  '{mission}. {provider}. {launch_time_local}. {provider_hashtag}',
  '{rocket} from {pad_short}. {launch_time_local}. {provider_hashtag}',
  'Launch day. {provider} {rocket}. {launch_time_local}. {provider_hashtag}'
];

const MAIN_TEMPLATES_TOMORROW = [
  // === ULTRA SHORT (71-100 chars optimal) ===
  '{provider} launching tomorrow. {rocket}. {launch_time_local}.',
  '{rocket} going up tomorrow from {pad_short}. {launch_time_local}.',
  '{provider} {rocket} tomorrow. {mission}. {launch_time_local}.',
  'Tomorrow: {provider} {rocket}. {pad_short}. {launch_time_local}.',
  '{mission} launches tomorrow. {provider}. {launch_time_local}.',
  '{provider} launch tomorrow. {rocket} from {pad_short}. {launch_time_local}.',
  '{rocket} tomorrow. {mission}. Target: {launch_time_local}.',

  // === CONVERSATIONAL (compact) ===
  '{provider} is launching tomorrow from {pad_short}. Target: {launch_time_local}.',
  'Tomorrow: {provider} {rocket} carrying {mission}. {launch_time_local}.',
  '{rocket} on the pad at {pad_short}. {provider} targeting {launch_time_local} tomorrow.',
  'Heads up: {provider} {mission} tomorrow. {launch_time_local} from {pad_short}.',
  '{provider} {rocket} ready. Mission: {mission}. Tomorrow at {launch_time_local}.',

  // === WITH WEATHER ===
  '{provider} {rocket} tomorrow. {launch_time_local}. Forecast: {weather_short}.',
  '{rocket} from {pad_short} tomorrow at {launch_time_local}. {weather_short}.',
  '{mission} tomorrow. {provider}. {launch_time_local}. {weather_short} expected.',

  // === INFO-FORWARD (multi-line) ===
  '{provider} {rocket}\n{mission}\n{pad_short} tomorrow at {launch_time_local}',
  'Tomorrow from {pad_short}:\n{provider} {rocket}\n{mission}\nTarget: {launch_time_local}',
  '{mission}\n{provider} {rocket}\nTomorrow {launch_time_local}\n{weather_short}',

  // === NARRATIVE ===
  'A {rocket} is prepped at {pad_short}. {provider} targets {launch_time_local} tomorrow.',
  '{provider} getting ready. {rocket} goes up tomorrow at {launch_time_local}.',

  // === MINIMAL ===
  '{provider} {rocket} tomorrow. {launch_time_local}.',
  '{mission}. {provider}. Tomorrow {launch_time_local}.',
  '{provider}. {rocket}. Tomorrow. {launch_time_local}.',

  // === WITH HASHTAG ===
  '{provider} {rocket} tomorrow. {launch_time_local}. {provider_hashtag}',
  '{mission}. {provider}. Tomorrow {launch_time_local}. {provider_hashtag}',
  '{rocket} from {pad_short} tomorrow. {launch_time_local}. {provider_hashtag}'
];

const MISSION_CALLOUT_TEMPLATES = [
  // Direct and simple
  '{mission}: {mission_blurb}',
  'About this mission: {mission_blurb}',
  'What\'s going up: {mission_blurb}',
  '{mission_blurb}',

  // Conversational
  'So what\'s the payload? {mission_blurb}',
  'Here\'s what {provider} is launching: {mission_blurb}',
  'Quick rundown on {mission}: {mission_blurb}',
  'If you\'re wondering what\'s flying: {mission_blurb}',

  // Context-setting
  'The payload on this one: {mission_blurb}',
  'Today\'s cargo: {mission_blurb}',
  '{provider} is sending up: {mission_blurb}',

  // Minimal
  'Payload: {mission_blurb}',
  '{mission}. {mission_blurb}',
  'On board: {mission_blurb}'
];

const STATUS_UPDATE_TEMPLATES = [
  // Ultra short
  '{mission} now {status_new}.',
  'Status: {status_new}.',
  '{provider} {rocket}: {status_new}.',
  '{status_new} for {mission}.',

  // Conversational
  '{mission} just moved to {status_new}.',
  'Status change: {mission} is now {status_new}.',
  '{provider} launch is {status_new}.',
  'Update on {mission}: status is {status_new}.',
  '{mission} status changed. Now showing {status_new}.',

  // With context
  'Was {status_old}, now {status_new}. {mission}.',
  '{mission}: {status_old} to {status_new}.',
  'Moved from {status_old} to {status_new}.',

  // Situational
  '{provider} {rocket} showing {status_new}.',
  'Change at {pad_short}: {status_new}.',
  '{launch_site_short} update: {mission} is {status_new}.',

  // Minimal
  '{status_new}. {mission}.',
  '{provider}: {status_new}.'
];

const NET_UPDATE_TEMPLATES = [
  // Ultra short
  'New target: {net_new_local}.',
  '{mission} now targeting {net_new_local}.',
  'Time moved to {net_new_local}.',
  '{provider}: {net_new_local} now.',

  // Conversational
  'Timing update. {mission} now targeting {net_new_local}.',
  '{provider} pushed to {net_new_local}.',
  'Target time changed. Now looking at {net_new_local}.',
  'Clock moved. {mission} targeting {net_new_local}.',
  'They\'ve updated the target time to {net_new_local}.',

  // With change context
  'Was {net_old_local}, now {net_new_local}.',
  'Moved from {net_old_local} to {net_new_local}. {mission}.',
  '{net_old_local} shifted to {net_new_local}.',
  '{mission}: {net_old_local} to {net_new_local}.',

  // Situational
  '{pad_short} update: targeting {net_new_local}.',
  '{provider} {rocket} now targeting {net_new_local}.',

  // Minimal
  '{net_new_local}. {mission}.',
  'Updated: {net_new_local}.'
];

const WINDOW_UPDATE_TEMPLATES = [
  // Ultra short
  'Window changed: {window_new}.',
  'New window: {window_new}.',
  '{mission} window is now {window_new}.',

  // Conversational
  'Window update for {mission}. Now {window_new}.',
  '{provider} updated their window to {window_new}.',
  'Launch window moved to {window_new}.',
  'They\'ve updated the window. Now {window_new}.',
  'Window shifted to {window_new}.',

  // With context
  'Was {window_old}, now {window_new}.',
  'Window moved from {window_old} to {window_new}.',
  '{mission}: window changed to {window_new}.',

  // Situational
  '{pad_short} window update: {window_new}.',
  '{provider} {rocket}: window is {window_new}.',
  'At {launch_site_short}: window now {window_new}.',

  // Minimal
  'Window: {window_new}.',
  '{window_new}. {mission}.'
];

const FOLLOWUP_QUESTIONS_STATUS = [
  // Simple engagement
  'Think we launch today?',
  'Watching this one?',
  'Feeling confident?',
  'Good sign or bad sign?',
  'Anyone else refreshing constantly?',

  // Casual polls
  'Launch or scrub today?',
  'Who\'s watching live?',
  'Predictions?',

  // Situational
  'How are you feeling about this one?',
  'Does this change your plans?',
  'Still tuning in?',
  'What\'s your read on this?',

  // Community-focused
  'Where are you watching from?',
  'Anyone at the viewing site?',
  'Stream link in the app if you need it.'
];

const FOLLOWUP_QUESTIONS_NET = [
  // Simple engagement
  'Think this one sticks?',
  'Does this time work for you?',
  'Still watching?',
  'Better or worse for your schedule?',

  // Casual
  'How many slips until you give up?',
  'Anyone else been refreshing all day?',
  'Predictions on whether this holds?',
  'Setting a new alarm?',

  // Situational
  'Does this change your plans?',
  'Still tuning in at the new time?',
  'What\'s your read?',

  // Community
  'Who\'s still here?',
  'Worth staying up for?',
  'Watching live or catching the replay?'
];

const FOLLOWUP_QUESTIONS_WINDOW = [
  // Simple engagement
  'Wider or tighter than expected?',
  'Does this work for you?',
  'Still planning to watch?',

  // Casual
  'Think they launch early or late in the window?',
  'Good sign or bad sign?',
  'Better or worse?',
  'Adjusting your plans?',

  // Situational
  'What\'s your read on this change?',
  'Still tuning in?',
  'Does this change things for you?',

  // Community
  'Who\'s watching the whole window?',
  'Stream link in the app.',
  'Watching for launch or staying for landing too?'
];

type LaunchRow = {
  id: string;
  name: string | null;
  slug: string | null;
  net: string | null;
  net_precision: string | null;
  window_start: string | null;
  window_end: string | null;
  provider: string | null;
  vehicle: string | null;
  mission_name: string | null;
  mission_description: string | null;
  rocket_full_name: string | null;
  pad_name: string | null;
  pad_short_code: string | null;
  pad_location_name: string | null;
  pad_timezone: string | null;
  pad_state: string | null;
  pad_country_code: string | null;
  rocket_image_url?: string | null;
  image_url?: string | null;
  image_thumbnail_url?: string | null;
  status_name: string | null;
  status_abbrev: string | null;
  hidden: boolean | null;
};

type WeatherRow = {
  launch_id: string;
  issued_at: string | null;
  valid_start: string | null;
  valid_end: string | null;
  summary: string | null;
  data: Record<string, unknown> | null;
};

type SocialPlatformResult = Record<string, unknown>;
type SocialPlatformResults = SocialPlatformResult | SocialPlatformResult[] | null;

type SocialPostRow = {
  id: string;
  launch_id: string;
  launch_update_id?: number | null;
  platform: string;
  post_type: string;
  base_day?: string | null;
  status: string;
  template_id: string | null;
  reply_template_id: string | null;
  question_id: string | null;
  post_text: string | null;
  reply_text: string | null;
  thread_segment_index?: number | null;
  reply_to_social_post_id?: string | null;
  request_id: string | null;
  external_id: string | null;
  platform_results?: SocialPlatformResults;
  attempts: number | null;
  scheduled_for: string | null;
  posted_at: string | null;
  send_lock_id?: string | null;
  send_locked_at?: string | null;
  created_at?: string | null;
};

type LaunchUpdateRow = {
  id: number;
  launch_id: string;
  changed_fields: string[] | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  detected_at: string | null;
};

serve(async (req) => {
  const startedAt = Date.now();
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const { runId } = await startIngestionRun(supabase, 'social_posts_dispatch');

	  const stats: Record<string, unknown> = {
	    processed: 0,
	    posted: 0,
	    skipped: 0,
	    failed: 0,
	    asyncPending: 0,
	    asyncResolved: 0,
	    retriesAttempted: 0,
	    updatesQueued: 0,
	    updatesSent: 0,
	    updatesSkipped: 0,
	    updatesDeferred: 0,
	    updatesFailed: 0,
	    missionRepliesQueued: 0,
	    missionRepliesSent: 0,
	    missionRepliesSkipped: 0,
	    missionRepliesDeferred: 0,
	    missionRepliesFailed: 0,
	    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
	  };

  let dispatchLockId: string | null = null;

  try {
    const settings = await getSettings(supabase, [
      'social_posts_enabled',
      'social_posts_dry_run',
      'social_posts_platforms',
      'social_posts_x_user',
      'social_posts_x_max_chars',
      'social_posts_facebook_page_id',
      'social_posts_site_url',
      'social_posts_launch_day_images_enabled',
      'social_posts_launch_day_image_timeout_ms',
      'social_posts_no_launch_day_enabled',
      'social_posts_no_launch_day_window_start_hour_pt',
      'social_posts_no_launch_day_window_end_hour_pt',
      'social_posts_horizon_hours',
      'social_posts_window_minutes',
      'social_posts_max_per_run',
      'social_posts_max_attempts',
      'social_posts_retry_window_hours',
      'social_posts_utm_source',
      'social_posts_utm_medium',
      'social_posts_utm_campaign',
      'social_posts_utm_content',
      'social_posts_mission_drop_enabled',
      'social_posts_mission_drop_min_after_8_minutes',
      'social_posts_mission_drop_min_before_launch_minutes',
      'social_posts_mission_brief_enabled',
      'social_posts_mission_brief_start_hour_local',
      'social_posts_mission_brief_min_before_launch_minutes',
      'social_posts_questions_enabled',
      'social_posts_questions_probability',
      'social_posts_no_repeat_depth',
      'social_posts_updates_enabled',
      'social_posts_updates_max_per_run',
      'social_posts_updates_min_gap_minutes',
      'social_posts_updates_cursor',
      'social_posts_dispatch_runtime_budget_ms',
      'social_posts_dispatch_claim_batch_size',
      'social_posts_send_lock_stale_minutes'
    ]);

    const enabled = readBooleanSetting(settings.social_posts_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled' });
    }

    const dryRun = readBooleanSetting(settings.social_posts_dry_run, DEFAULTS.dryRun);
    const requestedPlatforms = readStringArraySetting(settings.social_posts_platforms, ['x']);
    let enabledPlatforms = normalizePlatforms(requestedPlatforms);
    const uploadPostUser = readStringSetting(settings.social_posts_x_user, '').trim();
    const xMaxChars = clampInt(readNumberSetting(settings.social_posts_x_max_chars, DEFAULT_X_MAX_CHARS), MIN_X_MAX_CHARS, MAX_X_MAX_CHARS);
    const facebookPageId = readStringSetting(settings.social_posts_facebook_page_id, '').trim();
    const siteUrl = readStringSetting(settings.social_posts_site_url, 'https://www.tminuszero.app').replace(/\/+$/, '');
    const horizonHours = clampInt(readNumberSetting(settings.social_posts_horizon_hours, DEFAULTS.horizonHours), 1, 168);
    const windowMinutes = clampInt(readNumberSetting(settings.social_posts_window_minutes, DEFAULTS.windowMinutes), 1, 120);
    const maxPerRun = clampInt(readNumberSetting(settings.social_posts_max_per_run, DEFAULTS.maxPerRun), 1, 50);
    const maxAttempts = clampInt(readNumberSetting(settings.social_posts_max_attempts, DEFAULTS.maxAttempts), 1, 10);
    const retryWindowHours = clampInt(readNumberSetting(settings.social_posts_retry_window_hours, DEFAULTS.retryWindowHours), 1, 24);
    const utmSource = readStringSetting(settings.social_posts_utm_source, DEFAULTS.utmSource);
    const utmMedium = readStringSetting(settings.social_posts_utm_medium, DEFAULTS.utmMedium);
    const utmCampaign = readStringSetting(settings.social_posts_utm_campaign, DEFAULTS.utmCampaign);
    const utmContent = readStringSetting(settings.social_posts_utm_content, DEFAULTS.utmContent);

    const launchDayImagesEnabled = readBooleanSetting(settings.social_posts_launch_day_images_enabled, true);
    const launchDayImageTimeoutMs = clampInt(
      readNumberSetting(settings.social_posts_launch_day_image_timeout_ms, DEFAULT_OG_IMAGE_TIMEOUT_MS),
      MIN_OG_IMAGE_TIMEOUT_MS,
      MAX_OG_IMAGE_TIMEOUT_MS
    );

    const noLaunchDayEnabled = readBooleanSetting(settings.social_posts_no_launch_day_enabled, true);
    let noLaunchDayWindowStartHourPt = clampInt(
      readNumberSetting(settings.social_posts_no_launch_day_window_start_hour_pt, 5),
      0,
      23
    );
    let noLaunchDayWindowEndHourPt = clampInt(readNumberSetting(settings.social_posts_no_launch_day_window_end_hour_pt, 8), 0, 23);
    if (noLaunchDayWindowEndHourPt <= noLaunchDayWindowStartHourPt) {
      noLaunchDayWindowStartHourPt = clampInt(noLaunchDayWindowStartHourPt, 0, 22);
      noLaunchDayWindowEndHourPt = noLaunchDayWindowStartHourPt + 1;
    }

    const missionDropEnabled = readBooleanSetting(settings.social_posts_mission_drop_enabled, true);
    const missionDropMinAfter8Minutes = clampInt(
      readNumberSetting(settings.social_posts_mission_drop_min_after_8_minutes, 60),
      0,
      24 * 60
    );
    const missionDropMinBeforeLaunchMinutes = clampInt(
      readNumberSetting(settings.social_posts_mission_drop_min_before_launch_minutes, 60),
      0,
      24 * 60
    );

    const missionBriefEnabled = readBooleanSetting(settings.social_posts_mission_brief_enabled, true);
    const missionBriefStartHourLocal = clampInt(
      readNumberSetting(settings.social_posts_mission_brief_start_hour_local, 9),
      0,
      23
    );
    const missionBriefMinBeforeLaunchMinutes = clampInt(
      readNumberSetting(settings.social_posts_mission_brief_min_before_launch_minutes, 60),
      0,
      24 * 60
    );

    const questionsEnabled = readBooleanSetting(settings.social_posts_questions_enabled, true);
    const questionsProbability = clampNumber(readNumberSetting(settings.social_posts_questions_probability, 0.333), 0, 1);
    const noRepeatDepth = clampInt(readNumberSetting(settings.social_posts_no_repeat_depth, 12), 0, 100);
    const dispatchRuntimeBudgetMs = clampInt(
      readNumberSetting(settings.social_posts_dispatch_runtime_budget_ms, DEFAULT_DISPATCH_RUNTIME_BUDGET_MS),
      MIN_DISPATCH_RUNTIME_BUDGET_MS,
      MAX_DISPATCH_RUNTIME_BUDGET_MS
    );
    const dispatchClaimBatchSize = clampInt(
      readNumberSetting(settings.social_posts_dispatch_claim_batch_size, DEFAULT_DISPATCH_CLAIM_BATCH_SIZE),
      MIN_DISPATCH_CLAIM_BATCH_SIZE,
      MAX_DISPATCH_CLAIM_BATCH_SIZE
    );
    const sendLockStaleMinutes = clampInt(
      readNumberSetting(settings.social_posts_send_lock_stale_minutes, DEFAULT_SOCIAL_POST_SEND_LOCK_STALE_MINUTES),
      MIN_SOCIAL_POST_SEND_LOCK_STALE_MINUTES,
      MAX_SOCIAL_POST_SEND_LOCK_STALE_MINUTES
    );
    const dispatchDeadlineMs = Date.now() + dispatchRuntimeBudgetMs;

    const updatesEnabled = readBooleanSetting(settings.social_posts_updates_enabled, true);
    const updatesMaxPerRun = clampInt(readNumberSetting(settings.social_posts_updates_max_per_run, 10), 1, 50);
    const updatesMinGapMinutes = clampInt(readNumberSetting(settings.social_posts_updates_min_gap_minutes, 10), 0, 120);
    const updatesCursor = readNumberSetting(settings.social_posts_updates_cursor, 0);

    if (!enabledPlatforms.length) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'no_platforms' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_platforms' });
    }

    if (enabledPlatforms.includes('facebook') && !facebookPageId) {
      await upsertOpsAlert(supabase, {
        key: 'social_posts_facebook_page_id_missing',
        severity: 'critical',
        message: 'Facebook Page ID is not configured (social_posts_facebook_page_id).'
      });
      enabledPlatforms = enabledPlatforms.filter((platform) => platform !== 'facebook');
    } else {
      await resolveOpsAlert(supabase, 'social_posts_facebook_page_id_missing');
    }

    if (!enabledPlatforms.length) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'no_platforms' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_platforms' });
    }

    if (!uploadPostUser) {
      await upsertOpsAlert(supabase, {
        key: 'social_posts_x_user_missing',
        severity: 'critical',
        message: 'UploadPost user is not configured (social_posts_x_user).'
      });
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'x_user_missing' });
      return jsonResponse({ ok: true, skipped: true, reason: 'x_user_missing' });
    }

    const apiKey = (Deno.env.get('UPLOAD_POST_API_KEY') || Deno.env.get('UPLOADPOST_API_KEY') || '').trim();
    if (!apiKey) {
      await upsertOpsAlert(supabase, {
        key: 'social_posts_api_key_missing',
        severity: 'critical',
        message: 'UploadPost API key missing from Edge Function env (UPLOAD_POST_API_KEY).'
      });
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'api_key_missing' });
      return jsonResponse({ ok: true, skipped: true, reason: 'api_key_missing' });
    }

    await resolveOpsAlert(supabase, 'social_posts_x_user_missing');
    await resolveOpsAlert(supabase, 'social_posts_api_key_missing');

    dispatchLockId = crypto.randomUUID();
    const lockTtlSeconds = clampInt(Math.ceil(dispatchRuntimeBudgetMs / 1000) + 30, 60, 3600);
    const { data: acquired, error: lockError } = await supabase.rpc('try_acquire_job_lock', {
      lock_name_in: SOCIAL_POSTS_DISPATCH_LOCK_NAME,
      ttl_seconds_in: lockTtlSeconds,
      locked_by_in: dispatchLockId
    });
    if (lockError) throw lockError;
    if (!acquired) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'locked' });
      return jsonResponse({ ok: true, skipped: true, reason: 'locked' });
    }

    const now = new Date();

    const asyncPending = await processAsyncPosts({
      supabase,
      apiKey,
      maxPerRun: Math.max(maxPerRun, dispatchClaimBatchSize)
    });
    stats.asyncPending = asyncPending.pending;
    stats.asyncResolved = asyncPending.resolved;

	    const retryStats = await processRetryPosts({
	      supabase,
	      apiKey,
	      uploadPostUser,
	      enabledPlatforms,
	      facebookPageId,
	      siteUrl,
	      launchDayImagesEnabled,
	      launchDayImageTimeoutMs,
	      retryWindowHours,
	      dryRun,
	      now,
        lockId: dispatchLockId,
        claimBatchSize: dispatchClaimBatchSize,
        sendLockStaleMinutes,
        deadlineMs: dispatchDeadlineMs
	    });
    stats.retriesAttempted = retryStats.attempted;
    stats.posted = (stats.posted as number) + retryStats.posted;
    stats.failed = (stats.failed as number) + retryStats.failed;
    stats.skipped = (stats.skipped as number) + retryStats.skipped;

    if (updatesEnabled) {
      const updateStats = await processLaunchUpdates({
        supabase,
        apiKey,
        uploadPostUser,
        enabledPlatforms,
        facebookPageId,
        now,
        horizonHours,
        retryWindowHours,
        updatesMaxPerRun,
        updatesMinGapMinutes,
        updatesCursor,
        siteUrl,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        xMaxChars,
        questionsEnabled,
	        questionsProbability,
	        noRepeatDepth,
	        dryRun,
          lockId: dispatchLockId,
          claimBatchSize: dispatchClaimBatchSize,
          sendLockStaleMinutes,
          deadlineMs: dispatchDeadlineMs
	      });
      stats.updatesQueued = updateStats.queued;
      stats.updatesSent = updateStats.sent;
      stats.updatesSkipped = updateStats.skipped;
      stats.updatesDeferred = updateStats.deferred;
      stats.updatesFailed = updateStats.failed;
    }

	    const launches = await loadCandidateLaunches(supabase, {
	      fromIso: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
	      horizonIso: new Date(now.getTime() + horizonHours * 60 * 60 * 1000).toISOString()
	    });

	    const noLaunchDaySchedule =
	      noLaunchDayEnabled && !hasUsLaunchesTodayPt(launches, now)
	        ? resolveNoLaunchDaySchedule(now, noLaunchDayWindowStartHourPt, noLaunchDayWindowEndHourPt)
	        : null;
	    let noLaunchDayPlatformsToSchedule: SupportedPlatform[] = [];
		    if (noLaunchDaySchedule) {
		      const { data, error } = await supabase
		        .from('social_posts')
		        .select('platform')
		        .eq('post_type', 'no_launch_day')
		        .eq('base_day', noLaunchDaySchedule.baseDay)
		        .in('platform', enabledPlatforms);
	      if (error) throw error;
	      const existingPlatforms = new Set<string>();
	      for (const row of (data || []) as Array<{ platform: string | null }>) {
	        if (row.platform) existingPlatforms.add(String(row.platform));
		      }
		      noLaunchDayPlatformsToSchedule = enabledPlatforms.filter((platform) => !existingPlatforms.has(platform));
		    }

		    const scheduledLaunches = launches.flatMap((launch) => {
		      const schedule = resolveLaunchDaySchedule(launch, now, windowMinutes);
		      if (!schedule) return [];
		      return [{ launch, scheduledFor: schedule.scheduledFor, baseDay: schedule.baseDay }];
	    });

	    const scheduledLaunchIds = scheduledLaunches.map((entry) => entry.launch.id);
	    const existingLaunchDayPosts = scheduledLaunchIds.length
	      ? await loadLaunchDayPosts(supabase, scheduledLaunchIds, enabledPlatforms)
	      : [];
	    const existingLaunchDayKeys = new Set<string>();
	    for (const row of existingLaunchDayPosts) {
	      const baseDay = resolveLaunchDayBaseDayFromRow(row);
	      if (!baseDay) continue;
	      existingLaunchDayKeys.add(`${row.launch_id}:${row.platform}:${baseDay}`);
	    }
	    const queuePlan = scheduledLaunches
	      .map((entry) => ({
	        entry,
	        missingPlatforms: enabledPlatforms.filter(
	          (platform) => !existingLaunchDayKeys.has(`${entry.launch.id}:${platform}:${entry.baseDay}`)
		        )
		      }))
		      .filter((plan) => plan.missingPlatforms.length);
		    const toProcess = queuePlan;

		    if (toProcess.length) {
		      const weatherRows = await loadWeatherRows(supabase, toProcess.map((plan) => plan.entry.launch.id));
		      const weatherByLaunch = groupWeatherByLaunch(weatherRows);
	      const usedMainTemplateIndices = new Set<number>();
	      const usedPrefaceTemplateIndicesByState = new Map<string, Set<number>>();

	      for (const plan of toProcess) {
	        if (!plan.entry.scheduledFor) continue;
	        const launch = plan.entry.launch;
	        stats.processed = (stats.processed as number) + 1;
	        const tz = resolveTimeZone(launch.pad_timezone);
	        const context = buildPostContext({
	          launch,
	          tz,
	          weatherRows: weatherByLaunch.get(launch.id) || []
	        });

	        const templateSet = context.whenKey === 'tomorrow' ? MAIN_TEMPLATES_TOMORROW : MAIN_TEMPLATES_TODAY;
	        const mainTemplateIndex = pickTemplateIndexAvoiding(templateSet.length, usedMainTemplateIndices);
	        usedMainTemplateIndices.add(mainTemplateIndex);

	        const prefaceSet = resolveLaunchDayPrefaceTemplates(launch);
	        let launchDayPreface: string | null = null;
	        if (prefaceSet) {
	          const excluded = usedPrefaceTemplateIndicesByState.get(prefaceSet.state) || new Set<number>();
	          const prefaceIndex = pickTemplateIndexAvoiding(prefaceSet.templates.length, excluded);
	          excluded.add(prefaceIndex);
	          usedPrefaceTemplateIndicesByState.set(prefaceSet.state, excluded);
	          launchDayPreface = prefaceSet.templates[prefaceIndex] || null;
	        }

	        for (const platform of plan.missingPlatforms) {
	          const tokens = context.tokens;
	          const rawMainText = renderTemplate(
	            templateSet[mainTemplateIndex],
	            tokens,
	            MAX_TEMPLATE_RENDER_LEN
	          );
	          let mainText = rawMainText;
	          mainText = stripLaunchDayLinkLine(mainText);
	          mainText = normalizeLaunchDayMainTextForPlatform(mainText, platform);
	          const mainTextWithPreface = launchDayPreface
	            ? prefixLaunchDayText({ preface: launchDayPreface, mainText, maxLen: MAX_TEMPLATE_RENDER_LEN })
	            : mainText;

	          const payload = {
	            launch_id: launch.id,
	            platform,
	            post_type: 'launch_day',
	            base_day: plan.entry.baseDay,
	            status: 'pending',
	            template_id: String(mainTemplateIndex),
	            reply_template_id: null,
	            post_text: mainTextWithPreface,
	            reply_text: null,
	            scheduled_for: plan.entry.scheduledFor
	          };

	          const insertResult = await claimSocialPost(supabase, payload, xMaxChars);
	          if (!insertResult.ids.length) {
	            stats.skipped = (stats.skipped as number) + 1;
	            continue;
	          }

	          if (dryRun) {
	            for (const id of insertResult.insertedIds) {
	              await markPostSkipped(supabase, id, 'dry_run');
	            }
	            stats.skipped = (stats.skipped as number) + Math.max(1, insertResult.insertedIds.length);
	            continue;
	          }
	        }
	      }
	    }

	    if (noLaunchDaySchedule && noLaunchDayPlatformsToSchedule.length) {
	      const excludedPrefaceTemplateIndices = new Set<number>();
	      const excludedOnThisDayTemplateIndices = new Set<number>();
	      if (noRepeatDepth) {
	        for (const platform of enabledPlatforms) {
	          const recent = await loadRecentSocialPostMeta(supabase, {
	            platform,
	            postType: 'no_launch_day',
	            limit: noRepeatDepth
	          });
	          for (const idx of recent.templateIndices) excludedPrefaceTemplateIndices.add(idx);
	          for (const idx of recent.replyTemplateIndices) excludedOnThisDayTemplateIndices.add(idx);
	        }
	      }

	      const prefaceIndex = pickTemplateIndexAvoiding(NO_LAUNCH_DAY_PREFACE_TEMPLATES.length, excludedPrefaceTemplateIndices);
	      const preface = NO_LAUNCH_DAY_PREFACE_TEMPLATES[prefaceIndex] || 'No US launches today.';

	      let onThisDay = await pickLaunchOnThisDay(supabase, now);
	      if (onThisDay && shouldExcludeOnThisDayLaunchForNoLaunchDay(onThisDay, now)) onThisDay = null;
	      let anchorLaunch: LaunchRow | null = onThisDay;
	      let onThisDayTemplateIndex: number | null = null;

	      let postText = renderTemplate(preface, {}, MAX_TEMPLATE_RENDER_LEN);
	      if (onThisDay) {
	        const tokens = buildOnThisDayTokens(onThisDay);
	        const brief = String(tokens.on_this_day_mission_brief || '').trim();
	        if (brief) {
	          onThisDayTemplateIndex = pickTemplateIndexAvoiding(ON_THIS_DAY_TEMPLATES.length, excludedOnThisDayTemplateIndices);
	          const template = ON_THIS_DAY_TEMPLATES[onThisDayTemplateIndex] || '';
	          postText = renderTemplate(`${preface}\n\n${template}`, tokens, MAX_TEMPLATE_RENDER_LEN);
	        }
	      }

	      if (!anchorLaunch) {
	        anchorLaunch = await loadFallbackHistoricalLaunch(supabase, now);
	      }

	      if (anchorLaunch) {
	        for (const platform of noLaunchDayPlatformsToSchedule) {
	          const payload = {
	            launch_id: anchorLaunch.id,
	            platform,
	            post_type: 'no_launch_day',
	            base_day: noLaunchDaySchedule.baseDay,
	            status: 'pending',
	            template_id: String(prefaceIndex),
	            reply_template_id: onThisDayTemplateIndex != null ? String(onThisDayTemplateIndex) : null,
	            post_text: postText,
	            reply_text: null,
	            scheduled_for: noLaunchDaySchedule.scheduledFor
	          };

	          const insertResult = await claimSocialPost(supabase, payload, xMaxChars);
	          if (!insertResult.ids.length) {
	            stats.skipped = (stats.skipped as number) + 1;
	            continue;
	          }

	          stats.processed = (stats.processed as number) + 1;
	          if (dryRun) {
	            for (const id of insertResult.insertedIds) {
	              await markPostSkipped(supabase, id, 'dry_run');
	            }
	            stats.skipped = (stats.skipped as number) + Math.max(1, insertResult.insertedIds.length);
	          }
	        }
	      }
	    }

	    const scheduledReplies = await scheduleThreadReplies({
	      supabase,
	      launches,
	      now,
	      enabledPlatforms,
	      missionDropEnabled,
	      missionDropMinAfter8Minutes,
	      missionDropMinBeforeLaunchMinutes,
	      missionBriefEnabled,
	      missionBriefStartHourLocal,
	      missionBriefMinBeforeLaunchMinutes,
	      xMaxChars,
	      noRepeatDepth
	    });
	    stats.missionRepliesQueued = scheduledReplies.queued;

      const coreBacklog = await countDueCorePosts(supabase, {
        platforms: enabledPlatforms,
        nowIso: now.toISOString()
      });
      stats.coreBacklog = coreBacklog;

      if (coreBacklog === 0 && hasRuntimeBudgetRemaining(dispatchDeadlineMs)) {
	      const sentReplies = await processThreadReplyQueue({
	        supabase,
	        apiKey,
	        uploadPostUser,
	        enabledPlatforms,
	        facebookPageId,
	        maxAttempts,
	        retryWindowHours,
	        maxPerRun: Math.max(maxPerRun, dispatchClaimBatchSize),
	        dryRun,
	        now,
          lockId: dispatchLockId,
          claimBatchSize: dispatchClaimBatchSize,
          sendLockStaleMinutes,
          deadlineMs: dispatchDeadlineMs
	      });
		      stats.missionRepliesSent = sentReplies.sent;
		      stats.missionRepliesSkipped = sentReplies.skipped;
		      stats.missionRepliesDeferred = sentReplies.deferred;
		      stats.missionRepliesFailed = sentReplies.failed;
      } else {
        stats.missionRepliesDeferred = (stats.missionRepliesDeferred as number) + (coreBacklog > 0 ? coreBacklog : 0);
      }

		    if (!dryRun) {
		      try {
		        const missStats = await detectMissedLaunchDayPosts({
		          supabase,
		          launches,
		          enabledPlatforms,
		          now,
              xMaxChars
		        });
		        stats.launchDayMissesChecked = missStats.checked;
		        stats.launchDayMissesDetected = missStats.missed;
		        stats.launchDayMissesResolved = missStats.resolved;
            stats.launchDayMissesRecoveryQueued = missStats.recoveryQueued;
		      } catch (err) {
		        (stats.errors as Array<any>).push({ step: 'detect_missed_launch_day', error: stringifyError(err) });
		      }
		    }

			    await finishIngestionRun(supabase, runId, true, stats);
			    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
			  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
	    await finishIngestionRun(supabase, runId, false, stats, message);
	    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, error: message, stats }, 500);
	  } finally {
    if (dispatchLockId) {
      try {
        await supabase.rpc('release_job_lock', {
          lock_name_in: SOCIAL_POSTS_DISPATCH_LOCK_NAME,
          locked_by_in: dispatchLockId
        });
      } catch {
        // lock TTL is the fallback
      }
    }
  }
});

async function loadCandidateLaunches(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  { fromIso, horizonIso }: { fromIso: string; horizonIso: string }
) {
  const { data, error } = await supabase
    .from('launches')
    .select(
      'id,name,slug,net,net_precision,window_start,window_end,provider,vehicle,mission_name,mission_description,rocket_full_name,pad_name,pad_short_code,pad_location_name,pad_timezone,pad_state,pad_country_code,status_name,status_abbrev,hidden'
    )
    .eq('hidden', false)
    .in('pad_country_code', US_PAD_COUNTRY_CODES)
    .gte('net', fromIso)
    .lt('net', horizonIso)
    .order('net', { ascending: true });

  if (error) throw error;
  return (data || []) as LaunchRow[];
}

async function loadLaunchImageCandidatesByIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[]
): Promise<Map<string, { rocketImageUrl: string | null; launchImageUrl: string | null; thumbnailUrl: string | null }>> {
  const map = new Map<string, { rocketImageUrl: string | null; launchImageUrl: string | null; thumbnailUrl: string | null }>();
  const unique = [...new Set((launchIds || []).filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase
    .from('launches')
    .select('id,rocket_image_url,image_url,image_thumbnail_url')
    .in('id', unique);
  if (error) throw error;

  for (const row of (data || []) as Array<{
    id: string;
    rocket_image_url: string | null;
    image_url: string | null;
    image_thumbnail_url: string | null;
  }>) {
    if (!row.id) continue;
    map.set(row.id, {
      rocketImageUrl: row.rocket_image_url ? String(row.rocket_image_url).trim() : null,
      launchImageUrl: row.image_url ? String(row.image_url).trim() : null,
      thumbnailUrl: row.image_thumbnail_url ? String(row.image_thumbnail_url).trim() : null
    });
  }

  return map;
}

async function pickLaunchOnThisDay(supabase: ReturnType<typeof createSupabaseAdminClient>, now: Date): Promise<LaunchRow | null> {
  const pt = getZonedParts(now, PACIFIC_TIMEZONE);
  const { data, error } = await supabase.rpc('pick_launch_on_this_day', { p_month: pt.month, p_day: pt.day });
  if (error) {
    console.warn('pick_launch_on_this_day RPC error', { message: error.message });
    return null;
  }
  if (Array.isArray(data)) return (data[0] as LaunchRow) || null;
  return (data as LaunchRow) || null;
}

async function loadFallbackHistoricalLaunch(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  now: Date
): Promise<LaunchRow | null> {
  const { data, error } = await supabase
    .from('launches')
    .select(
      'id,name,slug,net,net_precision,window_start,window_end,provider,vehicle,mission_name,mission_description,rocket_full_name,pad_name,pad_short_code,pad_location_name,pad_timezone,pad_state,pad_country_code,status_name,status_abbrev,hidden'
    )
    .eq('hidden', false)
    .in('pad_country_code', US_PAD_COUNTRY_CODES)
    .not('mission_description', 'is', null)
    .lt('net', now.toISOString())
    .order('net', { ascending: false })
    .limit(10);

  if (error) throw error;
  for (const row of (data || []) as LaunchRow[]) {
    const brief = String(row.mission_description || '').trim();
    if (brief) return row;
  }
  return null;
}

async function loadWeatherRows(supabase: ReturnType<typeof createSupabaseAdminClient>, launchIds: string[]) {
  if (!launchIds.length) return [] as WeatherRow[];
  const { data, error } = await supabase
    .from('launch_weather')
    .select('launch_id,issued_at,valid_start,valid_end,summary,data')
    .in('launch_id', launchIds)
    .order('issued_at', { ascending: false });
  if (error) throw error;
  return (data || []) as WeatherRow[];
}

function groupWeatherByLaunch(rows: WeatherRow[]) {
  const map = new Map<string, WeatherRow[]>();
  for (const row of rows) {
    if (!map.has(row.launch_id)) map.set(row.launch_id, []);
    map.get(row.launch_id)?.push(row);
  }
  return map;
}

function resolveLaunchDaySchedule(launch: LaunchRow, now: Date, windowMinutes: number) {
  if (!launch.net) return null;
  const status = `${launch.status_name || ''} ${launch.status_abbrev || ''}`.toLowerCase();
  if (status.includes('scrub') || status.includes('cancel')) return null;
  const tz = resolveTimeZone(launch.pad_timezone);
  const launchDate = new Date(launch.net);
  if (!Number.isFinite(launchDate.getTime())) return null;

  const basePostMs = resolveBaseLaunchPostMs(launch, tz);
  if (basePostMs == null || !Number.isFinite(basePostMs)) return null;
  const baseDay = formatYmd(getZonedParts(new Date(basePostMs), tz));

  const nowMs = now.getTime();
  const lastWindowEndExclusiveMs = basePostMs + LAUNCH_DAY_POST_TOTAL_WINDOW_MS;
  if (nowMs >= lastWindowEndExclusiveMs) return null;

  const startMs = Math.max(nowMs, basePostMs);
  const elapsedMs = startMs - basePostMs;
  const windowIndex = clampInt(Math.floor(elapsedMs / LAUNCH_DAY_POST_WINDOW_MS), 0, 2);
  const windowEndExclusiveMs = basePostMs + (windowIndex + 1) * LAUNCH_DAY_POST_WINDOW_MS;
  const scheduledMs = pickRandomMinuteMs(startMs, windowEndExclusiveMs - 1);
  return { scheduledFor: new Date(scheduledMs).toISOString(), baseDay };
}

function resolveNoLaunchDaySchedule(now: Date, startHourPt: number, endHourPt: number) {
  const tz = PACIFIC_TIMEZONE;
  const nowMs = now.getTime();
  const todayParts = getZonedParts(now, tz);
  const baseDay = formatYmd(todayParts);

  const windowStartMs = zonedLocalToUtcMs({
    tz,
    year: todayParts.year,
    month: todayParts.month,
    day: todayParts.day,
    hour: clampInt(startHourPt, 0, 23),
    minute: 0
  });
  const windowEndExclusiveMs = zonedLocalToUtcMs({
    tz,
    year: todayParts.year,
    month: todayParts.month,
    day: todayParts.day,
    hour: clampInt(endHourPt, 0, 23),
    minute: 0
  });

  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndExclusiveMs)) return null;
  if (windowEndExclusiveMs <= windowStartMs) return null;
  if (nowMs >= windowEndExclusiveMs) return null;

  const startMs = Math.max(nowMs, windowStartMs);
  const scheduledMs = pickRandomMinuteMs(startMs, windowEndExclusiveMs - 1);
  return { scheduledFor: new Date(scheduledMs).toISOString(), baseDay };
}

function hasUsLaunchesTodayPt(launches: LaunchRow[], now: Date) {
  const tz = PACIFIC_TIMEZONE;
  const todayParts = getZonedParts(now, tz);
  const startOfDayMs = zonedLocalToUtcMs({
    tz,
    year: todayParts.year,
    month: todayParts.month,
    day: todayParts.day,
    hour: 0,
    minute: 0
  });

  const todayDayNumber = toDayNumber(todayParts);
  const tomorrowDate = new Date((todayDayNumber + 1) * 86400000);
  const endExclusiveMs = zonedLocalToUtcMs({
    tz,
    year: tomorrowDate.getUTCFullYear(),
    month: tomorrowDate.getUTCMonth() + 1,
    day: tomorrowDate.getUTCDate(),
    hour: 0,
    minute: 0
  });

  if (!Number.isFinite(startOfDayMs) || !Number.isFinite(endExclusiveMs) || endExclusiveMs <= startOfDayMs) return false;

  for (const launch of launches) {
    const netMs = launch.net ? Date.parse(launch.net) : NaN;
    if (!Number.isFinite(netMs)) continue;
    if (netMs < startOfDayMs || netMs >= endExclusiveMs) continue;
    const status = `${launch.status_name || ''} ${launch.status_abbrev || ''}`.toLowerCase();
    if (status.includes('scrub') || status.includes('cancel')) continue;
    return true;
  }

  return false;
}

function resolveBaseLaunchPostMs(launch: LaunchRow, tz: string) {
  if (!launch.net) return null;
  const netDate = parseIsoDate(launch.net);
  if (!netDate) return null;
  const precision = normalizeNetPrecision(launch.net_precision);
  const hasSpecificTime = precision === 'minute' || precision === 'hour';
  const launchParts = getZonedParts(netDate, tz);
  const isEarlyMorning = hasSpecificTime && launchParts.hour < 8;
  const baseDayNumber = toDayNumber(launchParts) - (isEarlyMorning ? 1 : 0);
  const baseDate = new Date(baseDayNumber * 86400000);
  return zonedLocalToUtcMs({
    tz,
    year: baseDate.getUTCFullYear(),
    month: baseDate.getUTCMonth() + 1,
    day: baseDate.getUTCDate(),
    hour: 8,
    minute: 0
  });
}

function normalizeMissionBlurb(value: string | null, fallback: string) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized) return truncateText(normalized, 200);
  return fallback;
}

function buildPostContext({
  launch,
  tz,
  weatherRows
}: {
  launch: LaunchRow;
  tz: string;
  weatherRows: WeatherRow[];
}) {
  const precision = normalizeNetPrecision(launch.net_precision);
  const hasSpecificTime = precision === 'minute' || precision === 'hour';

  const netDate = launch.net ? new Date(launch.net) : null;
  const windowStart = launch.window_start ? new Date(launch.window_start) : null;
  const windowEnd = launch.window_end ? new Date(launch.window_end) : null;

  const launchTimeLocal = netDate && hasSpecificTime ? formatTimeWithTz(netDate, tz) : 'TBD';
  const netRangeShort = formatNetRange({ netDate, windowStart, windowEnd, tz, hasSpecificTime });

  const weather = selectWeather({ rows: weatherRows, netDate: netDate || undefined });
  const weatherShort = weather.summary || 'Weather TBD';
  const tempF = weather.tempF != null ? `${Math.round(weather.tempF)}°F` : 'TBD';
  const windMph = weather.windMph != null ? `${Math.round(weather.windMph)} mph` : 'TBD';

  const launchSiteShort = resolveLaunchSiteShort(launch.pad_location_name, launch.pad_name);
  const padShort = resolvePadShort(launch.pad_short_code, launch.pad_name);
  // Truncate key tokens to keep posts within optimal 71-100 char range for engagement
  const providerRaw = (launch.provider || 'Unknown').trim() || 'Unknown';
  const provider = truncateText(providerRaw, 25);
  const rocketRaw = (launch.rocket_full_name || launch.vehicle || 'Rocket').trim() || 'Rocket';
  const rocket = truncateText(rocketRaw, 30);
  const missionRaw = (launch.mission_name || launch.name || 'Mission').trim() || 'Mission';
  const mission = truncateText(missionRaw, 45);
  const missionBlurb = normalizeMissionBlurb(launch.mission_description, missionRaw);
  const providerHashtag = buildProviderHashtag(providerRaw);

  const whenKey = resolveWhenKey({ launch: netDate, tz, hasSpecificTime });

  const tokens = {
    provider,
    rocket,
    mission,
    mission_blurb: missionBlurb,
    launch_site_short: launchSiteShort,
    pad_short: padShort,
    launch_time_local: launchTimeLocal,
    net_range_short: netRangeShort,
    weather_short: weatherShort,
    temp_f: tempF,
    wind_mph: windMph,
    provider_hashtag: providerHashtag
  };

  return { tokens, whenKey };
}

function buildOnThisDayTokens(launch: LaunchRow) {
  const tz = resolveTimeZone(launch.pad_timezone);
  const netDate = parseIsoDate(launch.net);
  const netParts = netDate ? getZonedParts(netDate, tz) : null;

  // Truncate tokens to keep posts within optimal engagement range
  const providerRaw = (launch.provider || 'Unknown').trim() || 'Unknown';
  const provider = truncateText(providerRaw, 25);
  const rocketRaw = (launch.rocket_full_name || launch.vehicle || 'Rocket').trim() || 'Rocket';
  const rocket = truncateText(rocketRaw, 30);
  const missionRaw = (launch.mission_name || launch.name || 'Mission').trim() || 'Mission';
  const mission = truncateText(missionRaw, 45);
  const launchSiteShort = resolveLaunchSiteShort(launch.pad_location_name, launch.pad_name);
  const padShort = resolvePadShort(launch.pad_short_code, launch.pad_name);

  const missionBriefRaw = String(launch.mission_description || '')
    .replace(/\s+/g, ' ')
    .trim();
  const missionBrief = missionBriefRaw ? truncateText(missionBriefRaw, 200) : '';

  const onThisDayDateLocal = netDate ? formatDateWithYear(netDate, tz) : '';
  const onThisDayTimeLocal = netDate ? formatTimeWithTz(netDate, tz) : 'TBD';
  const onThisDayYear = netParts ? String(netParts.year) : '';

  return {
    provider,
    rocket,
    mission,
    launch_site_short: launchSiteShort,
    pad_short: padShort,
    on_this_day_date_local: onThisDayDateLocal,
    on_this_day_year: onThisDayYear,
    on_this_day_time_local: onThisDayTimeLocal,
    on_this_day_mission_brief: missionBrief
  };
}

function shouldExcludeOnThisDayLaunchForNoLaunchDay(launch: LaunchRow, now: Date) {
  const tz = resolveTimeZone(launch.pad_timezone);
  const netDate = parseIsoDate(launch.net);
  if (!netDate) return false;

  const netParts = getZonedParts(netDate, tz);
  const nowParts = getZonedParts(now, tz);
  return netParts.year >= nowParts.year;
}

function resolveWhenKey({
  launch,
  tz,
  hasSpecificTime
}: {
  launch: Date | null;
  tz: string;
  hasSpecificTime: boolean;
}) {
  if (!launch || !hasSpecificTime) return 'today';
  const launchParts = getZonedParts(launch, tz);
  return launchParts.hour < 8 ? 'tomorrow' : 'today';
}

function buildLaunchUrl({
  launch,
  siteUrl,
  utmSource,
  utmMedium,
  utmCampaign,
  utmContent,
  whenKey
}: {
  launch: LaunchRow;
  siteUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  whenKey: string;
}) {
  const slugSource = (launch.slug || launch.mission_name || launch.name || '').trim();
  const slugId = buildSlugId(slugSource, launch.id);
  const params = new URLSearchParams();
  if (utmSource) params.set('utm_source', utmSource);
  if (utmMedium) params.set('utm_medium', utmMedium);
  if (utmCampaign) params.set('utm_campaign', utmCampaign);
  if (utmContent) params.set('utm_content', whenKey ? `${utmContent}-${whenKey}` : utmContent);
  const query = params.toString();
  return `${siteUrl}/launches/${encodeURIComponent(slugId)}${query ? `?${query}` : ''}`;
}

function selectWeather({ rows, netDate }: { rows: WeatherRow[]; netDate?: Date }) {
  if (!rows.length) return { summary: null as string | null, tempF: null as number | null, windMph: null as number | null };
  let match = rows[0];
  if (netDate) {
    const netMs = netDate.getTime();
    const ranged = rows.find((row) => {
      const startMs = row.valid_start ? Date.parse(row.valid_start) : NaN;
      const endMs = row.valid_end ? Date.parse(row.valid_end) : NaN;
      return Number.isFinite(startMs) && Number.isFinite(endMs) && netMs >= startMs && netMs <= endMs;
    });
    if (ranged) match = ranged;
  }

  const period = (match.data as any)?.period || null;
  const summary = match.summary || (typeof period?.shortForecast === 'string' ? period.shortForecast : null);
  const tempF = normalizeTempF(period?.temperature, period?.temperatureUnit);
  const windMph = parseWindMph(period?.windSpeed);
  return { summary, tempF, windMph };
}

function normalizeTempF(value: unknown, unit: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalizedUnit = String(unit || 'F').toUpperCase();
  if (normalizedUnit.startsWith('C')) return (value * 9) / 5 + 32;
  return value;
}

function parseWindMph(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const matches = value.match(/\d+/g);
  if (!matches) return null;
  const nums = matches.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return Math.max(...nums);
}

function formatNetRange({
  netDate,
  windowStart,
  windowEnd,
  tz,
  hasSpecificTime
}: {
  netDate: Date | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  tz: string;
  hasSpecificTime: boolean;
}) {
  if (!hasSpecificTime || !netDate) return 'TBD';
  if (windowStart && windowEnd && Number.isFinite(windowStart.getTime()) && Number.isFinite(windowEnd.getTime())) {
    const startLabel = formatTime(windowStart, tz);
    const endLabel = formatTime(windowEnd, tz);
    if (startLabel && endLabel) return `${startLabel}–${endLabel}`;
  }
  return formatTime(netDate, tz) || 'TBD';
}

function formatTime(date: Date, tz: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  } catch {
    return null;
  }
}

function formatTimeWithTz(date: Date, tz: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    }).formatToParts(date);
    const map = parts.reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    const time = `${map.hour || ''}:${map.minute || '00'} ${map.dayPeriod || ''}`.trim();
    const tzName = map.timeZoneName || '';
    return tzName ? `${time} ${tzName}` : time;
  } catch {
    return 'TBD';
  }
}

function getZonedParts(date: Date, tz: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    const map = parts.reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour),
      minute: Number(map.minute)
    };
  } catch {
    const fallback = new Date(date);
    return {
      year: fallback.getUTCFullYear(),
      month: fallback.getUTCMonth() + 1,
      day: fallback.getUTCDate(),
      hour: fallback.getUTCHours(),
      minute: fallback.getUTCMinutes()
    };
  }
}

function toDayNumber(parts: { year: number; month: number; day: number }) {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000;
}

function compareZonedParts(
  a: { year: number; month: number; day: number; hour: number; minute: number },
  b: { year: number; month: number; day: number; hour: number; minute: number }
) {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.hour !== b.hour) return a.hour < b.hour ? -1 : 1;
  if (a.minute !== b.minute) return a.minute < b.minute ? -1 : 1;
  return 0;
}

function zonedLocalToUtcMs({
  tz,
  year,
  month,
  day,
  hour,
  minute
}: {
  tz: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}) {
  const target = { year, month, day, hour, minute };
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let lo = guess - 36 * 60 * 60 * 1000;
  let hi = guess + 36 * 60 * 60 * 1000;
  let match: number | null = null;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midParts = getZonedParts(new Date(mid), tz);
    const cmp = compareZonedParts(midParts, target);
    if (cmp === 0) {
      match = mid;
      hi = mid - 1;
      continue;
    }
    if (cmp < 0) {
      lo = mid + 1;
      continue;
    }
    hi = mid - 1;
  }

  return match ?? guess;
}

function resolveTimeZone(value?: string | null) {
  const candidate = (value || '').trim();
  if (!candidate) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

// Build a hashtag from the provider name (e.g., "SpaceX" -> "#SpaceX")
// Research shows 1-2 hashtags increase engagement by 21%
function buildProviderHashtag(provider: string): string {
  const normalized = (provider || '').trim();
  if (!normalized || normalized.toLowerCase() === 'unknown') return '';

  // Common provider mappings for cleaner hashtags
  const providerMap: Record<string, string> = {
    'spacex': '#SpaceX',
    'space exploration technologies corp.': '#SpaceX',
    'rocket lab': '#RocketLab',
    'rocket lab usa': '#RocketLab',
    'united launch alliance': '#ULA',
    'ula': '#ULA',
    'blue origin': '#BlueOrigin',
    'northrop grumman': '#NorthropGrumman',
    'nasa': '#NASA',
    'isro': '#ISRO',
    'esa': '#ESA',
    'jaxa': '#JAXA',
    'roscosmos': '#Roscosmos',
    'china aerospace': '#CNSA',
    'relativity space': '#RelativitySpace',
    'firefly aerospace': '#Firefly',
    'astra': '#Astra',
    'virgin orbit': '#VirginOrbit',
    'virgin galactic': '#VirginGalactic',
    'arianespace': '#Arianespace'
  };

  const key = normalized.toLowerCase();
  if (providerMap[key]) return providerMap[key];

  // Fallback: create hashtag from provider name (remove spaces/special chars)
  const hashtag = normalized.replace(/[^a-zA-Z0-9]/g, '');
  return hashtag ? `#${hashtag}` : '';
}

function resolveLaunchSiteShort(locationName?: string | null, padName?: string | null) {
  const location = (locationName || '').trim();
  if (location && location.toLowerCase() !== 'unknown') {
    return location.split(',')[0].trim() || location;
  }
  const pad = (padName || '').trim();
  return pad || 'Launch Site';
}

function resolvePadShort(padShortCode?: string | null, padName?: string | null) {
  const code = (padShortCode || '').trim();
  if (code) return code;
  const name = (padName || '').trim();
  return name || 'Pad';
}

function buildSlugId(slugSource: string, id: string, maxLength = 64) {
  const slug = slugify(slugSource, maxLength);
  return slug ? `${slug}-${id}` : id;
}

function slugify(value: string, maxLength = 64) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, maxLength);
}

function normalizeNetPrecision(value: unknown) {
  if (value == null) return 'minute';
  let raw: unknown = value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 'minute';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        raw = JSON.parse(trimmed);
      } catch {
        raw = trimmed;
      }
    } else {
      raw = trimmed;
    }
  }

  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { abbrev?: string; name?: string; id?: number | string };
    raw = obj.abbrev || obj.name || obj.id || '';
  }

  const normalized = String(raw).toLowerCase();
  if (!normalized) return 'minute';
  if (normalized.includes('tbd') || normalized.includes('unknown')) return 'tbd';
  if (normalized.includes('sec')) return 'minute';
  if (normalized.includes('min')) return 'minute';
  if (normalized.includes('hour') || normalized === 'hr') return 'hour';
  if (normalized.includes('day')) return 'day';
  if (normalized.includes('month') || normalized === 'm') return 'month';
  if (normalized.startsWith('q') || normalized.includes('quarter')) return 'month';
  if (normalized.includes('year') || normalized === 'y') return 'month';
  return 'minute';
}

function normalizePostText(text: string, maxLen = 280) {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return truncateText(lines.join('\n'), maxLen);
}

function renderTemplate(template: string, tokens: Record<string, string>, maxLen = 280) {
  let output = template;
  for (const [key, value] of Object.entries(tokens)) {
    output = output.replaceAll(`{${key}}`, value ?? '');
  }
  output = output.replace(/\{[^}]+\}/g, '').trim();
  return normalizePostText(output, maxLen);
}

function truncateText(value: string, maxLen: number) {
  if (value.length <= maxLen) return value;
  if (maxLen <= 3) return value.slice(0, maxLen);

  const sliceLen = maxLen - 3;
  const sliced = value.slice(0, sliceLen);
  let trimmed = sliced.trimEnd();
  if (!trimmed) return '...';

  const lastWhitespace = Math.max(trimmed.lastIndexOf(' '), trimmed.lastIndexOf('\n'), trimmed.lastIndexOf('\t'));
  if (lastWhitespace >= 0) {
    const candidate = trimmed.slice(0, lastWhitespace).trimEnd();
    const minKeep = Math.floor(sliceLen * 0.6);
    if (candidate.length >= minKeep) trimmed = candidate;
  }

  return trimmed + '...';
}

function pickTemplateIndex(length: number) {
  if (length <= 1) return 0;
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % length;
}

function randomUint32() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0]!;
}

function randomFloat() {
  return randomUint32() / 2 ** 32;
}

function rollProbability(probability: number) {
  if (!Number.isFinite(probability) || probability <= 0) return false;
  if (probability >= 1) return true;
  return randomFloat() < probability;
}

function pickRandomMinuteMs(startMs: number, endMs: number) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return Date.now();
  if (endMs <= startMs) return startMs;

  const span = endMs - startMs;
  const offset = Math.floor(randomFloat() * (span + 1));
  const candidate = startMs + offset;
  const rounded = Math.floor(candidate / 60000) * 60000;
  return Math.max(startMs, Math.min(endMs, rounded));
}

function pickTemplateIndexAvoiding(length: number, excluded: Set<number>) {
  if (length <= 1) return 0;
  if (!excluded.size) return pickTemplateIndex(length);
  if (excluded.size >= length) return pickTemplateIndex(length);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = pickTemplateIndex(length);
    if (!excluded.has(candidate)) return candidate;
  }

  for (let candidate = 0; candidate < length; candidate += 1) {
    if (!excluded.has(candidate)) return candidate;
  }

  return 0;
}

function pickQuestion({
  kind,
  questionSet,
  tokens,
  baseText,
  recentQuestionIds,
  maxLen
}: {
  kind: 'status_change' | 'net_change' | 'window_change';
  questionSet: string[];
  tokens: Record<string, string>;
  baseText: string;
  recentQuestionIds: Set<string>;
  maxLen: number;
}): { id: string; text: string } | null {
  if (!questionSet.length) return null;
  const baseLower = baseText.toLowerCase();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const index = pickTemplateIndex(questionSet.length);
    const id = `${kind}-q${index + 1}`;
    if (recentQuestionIds.has(id)) continue;

    const text = renderTemplate(questionSet[index]!, tokens, 10_000);
    if (!text) continue;
    if (baseLower.includes(text.toLowerCase())) continue;

    const combinedLen = baseText.length + 2 + text.length;
    if (combinedLen > maxLen) return null;

    return { id, text };
  }

  return null;
}

function splitTextIntoChunks(text: string, maxLen: number) {
  const normalized = String(text || '').trim();
  if (!normalized) return [] as string[];
  if (!Number.isFinite(maxLen) || maxLen < 1) return [normalized];
  if (normalized.length <= maxLen) return [normalized];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    let end = Math.min(normalized.length, cursor + maxLen);
    if (end < normalized.length) {
      let breakAt = -1;
      for (let idx = end - 1; idx > cursor; idx -= 1) {
        const ch = normalized[idx];
        if (ch === ' ' || ch === '\n' || ch === '\t') {
          breakAt = idx;
          break;
        }
      }
      if (breakAt > cursor) end = breakAt;
    }

    const chunk = normalized.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    cursor = end;
    while (cursor < normalized.length && /\s/.test(normalized[cursor] || '')) cursor += 1;
  }

  return chunks.length ? chunks : [truncateText(normalized, maxLen)];
}

function splitXThreadChunksWithLabels(text: string, maxLen: number) {
  const normalized = normalizePostText(text, MAX_TEMPLATE_RENDER_LEN);
  if (!normalized) return [] as string[];
  if (normalized.length <= maxLen) return [normalized];

  let reserve = 12;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bodyMax = Math.max(1, maxLen - reserve);
    const bodies = splitTextIntoChunks(normalized, bodyMax);
    if (bodies.length <= 1) return [truncateText(normalized, maxLen)];
    const labeled = bodies.map((body, idx) => `(${idx + 1}/${bodies.length}) ${body}`);
    if (labeled.every((value) => value.length <= maxLen)) return labeled;
    const maxLabelLen = Math.max(...labeled.map((_, idx) => `(${idx + 1}/${bodies.length}) `.length));
    reserve = Math.max(reserve + 2, maxLabelLen + 2);
  }

  const bodies = splitTextIntoChunks(normalized, Math.max(1, maxLen - 20));
  if (bodies.length <= 1) return [truncateText(normalized, maxLen)];
  return bodies.map((body, idx) => truncateText(`(${idx + 1}/${bodies.length}) ${body}`, maxLen));
}

function buildPlatformPostSegments({
  platform,
  postText,
  xMaxChars
}: {
  platform: string;
  postText: string;
  xMaxChars: number;
}) {
  const normalized = normalizePostText(postText, MAX_TEMPLATE_RENDER_LEN);
  if (!normalized) return [] as string[];
  if (platform !== 'x') return [normalizePostText(normalized, FACEBOOK_MAX_CHARS)];
  const maxChars = clampInt(xMaxChars, MIN_X_MAX_CHARS, MAX_X_MAX_CHARS);
  return splitXThreadChunksWithLabels(normalized, maxChars);
}

function buildSocialPostUniqueLookup(payload: {
  launch_id: string;
  launch_update_id?: number | null;
  platform: string;
  post_type: string;
  base_day?: string | null;
  thread_segment_index: number;
}) {
  const postType = String(payload.post_type || '').trim();
  const segment = clampInt(payload.thread_segment_index || 1, 1, 100_000);
  if (payload.launch_update_id != null) {
    return {
      launch_update_id: payload.launch_update_id,
      platform: payload.platform,
      post_type: postType,
      thread_segment_index: segment
    } as Record<string, string | number | null>;
  }
  if (postType === 'no_launch_day') {
    return {
      platform: payload.platform,
      post_type: postType,
      base_day: payload.base_day ?? null,
      thread_segment_index: segment
    } as Record<string, string | number | null>;
  }
  return {
    launch_id: payload.launch_id,
    platform: payload.platform,
    post_type: postType,
    base_day: payload.base_day ?? null,
    thread_segment_index: segment
  } as Record<string, string | number | null>;
}

async function findSocialPostIdByUniqueLookup(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  uniqueLookup: Record<string, string | number | null>
) {
  let query = supabase.from('social_posts').select('id').limit(1);
  for (const [key, value] of Object.entries(uniqueLookup)) {
    if (value == null) query = query.is(key, null);
    else query = query.eq(key, value as any);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data?.id as string | undefined) || null;
}

async function insertSocialPostRow(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  payload: {
    launch_id: string;
    launch_update_id?: number | null;
    platform: string;
    post_type: string;
    base_day?: string | null;
    status: string;
    template_id: string | null;
    reply_template_id: string | null;
    question_id?: string | null;
    post_text: string;
    reply_text: string | null;
    scheduled_for: string;
    thread_segment_index: number;
    reply_to_social_post_id: string | null;
  }
) {
  const uniqueLookup = buildSocialPostUniqueLookup(payload);
  const existingBeforeInsert = await findSocialPostIdByUniqueLookup(supabase, uniqueLookup);
  if (existingBeforeInsert) {
    return { id: existingBeforeInsert, inserted: false };
  }

  const { data, error } = await supabase.from('social_posts').insert(payload).select('id').maybeSingle();
  if (!error && data) return { id: data.id as string, inserted: true };
  if (error?.code !== '23505') throw error;

  const existingId = await findSocialPostIdByUniqueLookup(supabase, uniqueLookup);
  if (!existingId) return null;
  return { id: existingId, inserted: false };
}

async function enqueueSegmentedSocialPost({
  supabase,
  payload,
  xMaxChars
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  payload: {
    launch_id: string;
    launch_update_id?: number | null;
    platform: string;
    post_type: string;
    base_day?: string | null;
    status: string;
    template_id: string | null;
    reply_template_id: string | null;
    question_id?: string | null;
    post_text: string;
    reply_text: string | null;
    scheduled_for: string;
  };
  xMaxChars: number;
}) {
  const segments = buildPlatformPostSegments({
    platform: payload.platform,
    postText: payload.post_text,
    xMaxChars
  });
  if (!segments.length) return { ids: [] as string[], insertedIds: [] as string[] };

  const ids: string[] = [];
  const insertedIds: string[] = [];
  let parentId: string | null = null;

  for (let idx = 0; idx < segments.length; idx += 1) {
    const segmentPayload = {
      ...payload,
      post_text: segments[idx]!,
      thread_segment_index: idx + 1,
      reply_to_social_post_id: idx === 0 ? null : parentId
    };
    const row = await insertSocialPostRow(supabase, segmentPayload);
    if (!row?.id) return { ids, insertedIds };
    ids.push(row.id);
    if (row.inserted) insertedIds.push(row.id);
    parentId = row.id;
  }

  return { ids, insertedIds };
}

async function claimSocialPost(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  payload: {
    launch_id: string;
    platform: string;
    post_type: string;
    base_day?: string;
    status: string;
    template_id: string | null;
    reply_template_id: string | null;
    post_text: string;
    reply_text: string | null;
    scheduled_for: string;
  },
  xMaxChars: number
) {
  return await enqueueSegmentedSocialPost({
    supabase,
    payload: { ...payload, question_id: null, launch_update_id: null },
    xMaxChars
  });
}

function hasRuntimeBudgetRemaining(deadlineMs: number) {
  return Date.now() + RUNTIME_GUARD_MS < deadlineMs;
}

async function countDueCorePosts(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  { platforms, nowIso }: { platforms: SupportedPlatform[]; nowIso: string }
) {
  if (!platforms.length) return 0;
  const coreTypes = ['launch_day', 'no_launch_day', 'status_change', 'net_change', 'window_change'];
  const nowMs = Date.parse(nowIso);
  const backlogFloorIso = Number.isFinite(nowMs)
    ? new Date(nowMs - 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [dueRes, inFlightRes] = await Promise.all([
    supabase
      .from('social_posts')
      .select('id', { count: 'exact', head: true })
      .in('platform', platforms)
      .in('post_type', coreTypes)
      .in('status', ['pending', 'failed'])
      .lte('scheduled_for', nowIso),
    supabase
      .from('social_posts')
      .select('id', { count: 'exact', head: true })
      .in('platform', platforms)
      .in('post_type', coreTypes)
      .in('status', ['sending', 'async'])
      .gte('scheduled_for', backlogFloorIso)
  ]);
  if (dueRes.error) throw dueRes.error;
  if (inFlightRes.error) throw inFlightRes.error;
  return Number(dueRes.count || 0) + Number(inFlightRes.count || 0);
}

async function claimDueSocialPosts({
  supabase,
  lockId,
  platforms,
  postTypes,
  scheduledBeforeIso,
  scheduledAfterIso,
  limit,
  maxAttempts,
  statuses,
  sendLockStaleMinutes
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  lockId: string;
  platforms: SupportedPlatform[];
  postTypes: string[];
  scheduledBeforeIso: string;
  scheduledAfterIso?: string | null;
  limit: number;
  maxAttempts?: number | null;
  statuses?: string[];
  sendLockStaleMinutes: number;
}) {
  if (!lockId || !platforms.length || !postTypes.length) return [] as SocialPostRow[];
  const { data, error } = await supabase.rpc('claim_social_posts_for_send', {
    p_lock_id: lockId,
    p_platforms: platforms,
    p_post_types: postTypes,
    p_statuses: statuses?.length ? statuses : ['pending', 'failed'],
    p_scheduled_before: scheduledBeforeIso,
    p_scheduled_after: scheduledAfterIso || null,
    p_limit: clampInt(limit, MIN_DISPATCH_CLAIM_BATCH_SIZE, MAX_DISPATCH_CLAIM_BATCH_SIZE),
    p_max_attempts: maxAttempts != null && Number.isFinite(maxAttempts) ? clampInt(maxAttempts, 1, 1_000_000) : null,
    p_send_lock_stale_minutes: clampInt(
      sendLockStaleMinutes,
      MIN_SOCIAL_POST_SEND_LOCK_STALE_MINUTES,
      MAX_SOCIAL_POST_SEND_LOCK_STALE_MINUTES
    )
  });
  if (error) throw error;
  const rows = ((data || []) as SocialPostRow[]).slice();
  rows.sort((a, b) => {
    const scheduledDelta = (parseTimestampMs(a.scheduled_for) ?? 0) - (parseTimestampMs(b.scheduled_for) ?? 0);
    if (scheduledDelta !== 0) return scheduledDelta;
    const segmentDelta = clampInt(Number(a.thread_segment_index || 1), 1, 100_000) - clampInt(Number(b.thread_segment_index || 1), 1, 100_000);
    if (segmentDelta !== 0) return segmentDelta;
    const createdDelta = (parseTimestampMs(a.created_at) ?? 0) - (parseTimestampMs(b.created_at) ?? 0);
    if (createdDelta !== 0) return createdDelta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  return rows;
}

async function processLaunchUpdates({
  supabase,
  apiKey,
  uploadPostUser,
  enabledPlatforms,
  facebookPageId,
  now,
  horizonHours,
  retryWindowHours,
  updatesMaxPerRun,
  updatesMinGapMinutes,
  updatesCursor,
  siteUrl,
  utmSource,
  utmMedium,
  utmCampaign,
  utmContent,
  xMaxChars,
  questionsEnabled,
  questionsProbability,
  noRepeatDepth,
  dryRun,
  lockId,
  claimBatchSize,
  sendLockStaleMinutes,
  deadlineMs
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  apiKey: string;
  uploadPostUser: string;
  enabledPlatforms: SupportedPlatform[];
  facebookPageId: string;
  now: Date;
  horizonHours: number;
  retryWindowHours: number;
  updatesMaxPerRun: number;
  updatesMinGapMinutes: number;
  updatesCursor: number;
  siteUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  xMaxChars: number;
  questionsEnabled: boolean;
  questionsProbability: number;
  noRepeatDepth: number;
  dryRun: boolean;
  lockId: string;
  claimBatchSize: number;
  sendLockStaleMinutes: number;
  deadlineMs: number;
}) {
  const stats = { queued: 0, sent: 0, skipped: 0, deferred: 0, failed: 0 };
  if (!hasRuntimeBudgetRemaining(deadlineMs)) return stats;
  const sinceIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const useCursor = Number.isFinite(updatesCursor) && updatesCursor > 0;
  const relevantUpdateFields = ['status_id', 'status_name', 'status_abbrev', 'net', 'window_start', 'window_end'];
  const updates = await loadLaunchUpdatesBatch(supabase, {
    cursor: useCursor ? updatesCursor : null,
    sinceIso: useCursor ? null : sinceIso,
    limit: Math.max(updatesMaxPerRun * 3, claimBatchSize * 2),
    relevantFields: relevantUpdateFields
  });

  if (!updates.length) {
    if (!useCursor) {
      const latestId = await fetchLatestLaunchUpdateId(supabase);
      if (latestId != null) await upsertSetting(supabase, 'social_posts_updates_cursor', latestId);
    }
    return stats;
  }

  const launchIds = [...new Set(updates.map((row) => row.launch_id))];
  const launches = await loadLaunchesByIds(supabase, launchIds);
  const launchById = new Map(launches.map((l) => [l.id, l]));
  const basePostMsByLaunchId = new Map<string, number | null>();
  const launchDayPosts = await loadLaunchDayPosts(supabase, launchIds, enabledPlatforms);
  const launchDayBaseMsByLaunchId = buildLaunchDayBaseMsByLaunchId(launchDayPosts);

  const recentTemplatesByKind = new Map<'status_change' | 'net_change' | 'window_change', Set<number>>();
  const recentQuestionsByKind = new Map<'status_change' | 'net_change' | 'window_change', Set<string>>();
  if (noRepeatDepth > 0) {
    for (const kind of ['status_change', 'net_change', 'window_change'] as const) {
      const templateIndices = new Set<number>();
      const questionIds = new Set<string>();

      for (const platform of enabledPlatforms) {
        const recent = await loadRecentSocialPostMeta(supabase, {
          platform,
          postType: kind,
          limit: noRepeatDepth
        });
        for (const idx of recent.templateIndices) templateIndices.add(idx);
        for (const id of recent.questionIds) questionIds.add(id);
      }

      recentTemplatesByKind.set(kind, templateIndices);
      recentQuestionsByKind.set(kind, questionIds);
    }
  }

  for (const update of updates) {
    const launch = launchById.get(update.launch_id);
    if (!launch || launch.hidden) continue;
    const netMs = launch.net ? Date.parse(launch.net) : NaN;
    const minNetMs = now.getTime() - 24 * 60 * 60 * 1000;
    const maxNetMs = now.getTime() + horizonHours * 60 * 60 * 1000;
    if (!Number.isFinite(netMs) || netMs < minNetMs || netMs > maxNetMs) continue;
    const tz = resolveTimeZone(launch.pad_timezone);
    if (!basePostMsByLaunchId.has(launch.id)) {
      const computedBasePostMs = resolveBaseLaunchPostMs(launch, tz);
      const launchDayBasePostMs = launchDayBaseMsByLaunchId.get(launch.id) ?? null;
      basePostMsByLaunchId.set(launch.id, minFiniteNumber(computedBasePostMs, launchDayBasePostMs));
    }
    const basePostMs = basePostMsByLaunchId.get(launch.id) ?? null;
    const detectedMs = update.detected_at ? Date.parse(update.detected_at) : NaN;
    if (!Number.isFinite(detectedMs) || basePostMs == null || !Number.isFinite(basePostMs) || detectedMs < basePostMs) {
      stats.skipped += 1;
      continue;
    }
    const kinds = resolveUpdateKinds(update);
    if (!kinds.length) continue;
    const baseContext = buildPostContext({ launch, tz, weatherRows: [] });
    const updateTokens = buildUpdateTokens({ launch, tz, update, baseContext });

    for (const kind of kinds) {
      const templateSet = pickUpdateTemplateSet(kind);
      const recentTemplates = recentTemplatesByKind.get(kind) || new Set<number>();
      const templateIndex = pickTemplateIndexAvoiding(templateSet.length, recentTemplates);
      recentTemplates.add(templateIndex);
      recentTemplatesByKind.set(kind, recentTemplates);
      const utmContentValue = `${utmContent}-${kind}-t${templateIndex + 1}`;
      const launchUrl = buildLaunchUrl({
        launch,
        siteUrl,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent: utmContentValue,
        whenKey: baseContext.whenKey
      });
      const tokens = { ...baseContext.tokens, ...updateTokens, launch_url_utm: launchUrl };

      const baseText = renderTemplate(templateSet[templateIndex], tokens, MAX_TEMPLATE_RENDER_LEN);
      let postText = baseText;
      let questionId: string | null = null;

      if (questionsEnabled && questionsProbability > 0 && rollProbability(questionsProbability)) {
        const questionSet = pickUpdateQuestionSet(kind);
        const recentQuestions = recentQuestionsByKind.get(kind) || new Set<string>();
        const picked = pickQuestion({
          kind,
          questionSet,
          tokens,
          baseText,
          recentQuestionIds: recentQuestions,
          maxLen: MAX_TEMPLATE_RENDER_LEN
        });
        if (picked) {
          postText = normalizePostText(`${baseText}\n\n${picked.text}`, MAX_TEMPLATE_RENDER_LEN);
          questionId = picked.id;
          recentQuestions.add(picked.id);
          recentQuestionsByKind.set(kind, recentQuestions);
        }
      }

      for (const platform of enabledPlatforms) {
        const queued = await enqueueUpdatePost(
          supabase,
          {
          launch_id: launch.id,
          launch_update_id: update.id,
          platform,
          post_type: kind,
          status: 'pending',
          template_id: String(templateIndex),
          question_id: questionId,
          post_text: postText,
          scheduled_for: update.detected_at || new Date().toISOString()
          },
          xMaxChars
        );
        stats.queued += queued.insertedIds.length;
      }
    }
  }

  const sendStats = await processUpdateQueue({
    supabase,
    apiKey,
    uploadPostUser,
    enabledPlatforms,
    facebookPageId,
    retryWindowHours,
    updatesMaxPerRun,
    updatesMinGapMinutes,
    dryRun,
    now,
    lockId,
    claimBatchSize,
    sendLockStaleMinutes,
    deadlineMs
  });

  stats.sent += sendStats.sent;
  stats.skipped += sendStats.skipped;
  stats.deferred += sendStats.deferred;
  stats.failed += sendStats.failed;

  const maxSeenId = updates.reduce((max, row) => (row.id > max ? row.id : max), updatesCursor);
  if (Number.isFinite(maxSeenId) && maxSeenId > 0) {
    await upsertSetting(supabase, 'social_posts_updates_cursor', maxSeenId);
  }

  return stats;
}

async function loadLaunchUpdatesBatch(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    cursor,
    sinceIso,
    limit,
    relevantFields
  }: {
    cursor: number | null;
    sinceIso: string | null;
    limit: number;
    relevantFields?: string[];
  }
) {
  let query = supabase
    .from('launch_updates')
    .select('id,launch_id,changed_fields,old_values,new_values,detected_at')
    .order('id', { ascending: true })
    .limit(limit);
  if (relevantFields?.length) {
    query = query.overlaps('changed_fields', relevantFields);
  }
  if (cursor != null && cursor > 0) {
    query = query.gt('id', cursor);
  } else if (sinceIso) {
    query = query.gte('detected_at', sinceIso);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as LaunchUpdateRow[];
}

async function fetchLatestLaunchUpdateId(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from('launch_updates')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id as number | undefined;
}

async function loadLaunchesByIds(supabase: ReturnType<typeof createSupabaseAdminClient>, launchIds: string[]) {
  if (!launchIds.length) return [] as LaunchRow[];
  const { data, error } = await supabase
    .from('launches')
    .select(
      'id,name,slug,net,net_precision,window_start,window_end,provider,vehicle,mission_name,mission_description,rocket_full_name,pad_name,pad_short_code,pad_location_name,pad_timezone,pad_state,pad_country_code,status_name,status_abbrev,hidden'
    )
    .in('id', launchIds)
    .in('pad_country_code', US_PAD_COUNTRY_CODES);
  if (error) throw error;
  return (data || []) as LaunchRow[];
}

function resolveUpdateKinds(update: LaunchUpdateRow) {
  const changed = new Set((update.changed_fields || []).map((value) => String(value)));
  const kinds: Array<'status_change' | 'net_change' | 'window_change'> = [];
  const statusChanged = changed.has('status_id') || changed.has('status_name') || changed.has('status_abbrev');
  const netChanged = changed.has('net') || changed.has('net_precision');
  const windowChanged = changed.has('window_start') || changed.has('window_end');
  if (statusChanged) kinds.push('status_change');
  if (netChanged) kinds.push('net_change');
  if (windowChanged) kinds.push('window_change');
  return kinds;
}

function pickUpdateTemplateSet(kind: 'status_change' | 'net_change' | 'window_change') {
  if (kind === 'status_change') return STATUS_UPDATE_TEMPLATES;
  if (kind === 'net_change') return NET_UPDATE_TEMPLATES;
  return WINDOW_UPDATE_TEMPLATES;
}

function pickUpdateQuestionSet(kind: 'status_change' | 'net_change' | 'window_change') {
  if (kind === 'status_change') return FOLLOWUP_QUESTIONS_STATUS;
  if (kind === 'net_change') return FOLLOWUP_QUESTIONS_NET;
  return FOLLOWUP_QUESTIONS_WINDOW;
}

function buildUpdateTokens({
  launch,
  tz,
  update,
  baseContext
}: {
  launch: LaunchRow;
  tz: string;
  update: LaunchUpdateRow;
  baseContext: ReturnType<typeof buildPostContext>;
}) {
  const oldValues = (update.old_values || {}) as Record<string, unknown>;
  const newValues = (update.new_values || {}) as Record<string, unknown>;

  const statusOld = pickFirstString(
    oldValues.status_abbrev,
    oldValues.status_name,
    launch.status_abbrev,
    launch.status_name,
    'Unknown'
  );
  const statusNew = pickFirstString(
    newValues.status_abbrev,
    newValues.status_name,
    launch.status_abbrev,
    launch.status_name,
    statusOld
  );

  const oldNetIso = pickFirstString(oldValues.net, launch.net);
  const newNetIso = pickFirstString(newValues.net, launch.net);
  const oldWindowStartIso = pickFirstString(oldValues.window_start, launch.window_start);
  const oldWindowEndIso = pickFirstString(oldValues.window_end, launch.window_end);
  const newWindowStartIso = pickFirstString(newValues.window_start, launch.window_start);
  const newWindowEndIso = pickFirstString(newValues.window_end, launch.window_end);

  const precisionOld = normalizeNetPrecision(pickFirstString(oldValues.net_precision, launch.net_precision));
  const precisionNew = normalizeNetPrecision(pickFirstString(newValues.net_precision, launch.net_precision));
  const hasSpecificOld = precisionOld === 'minute' || precisionOld === 'hour';
  const hasSpecificNew = precisionNew === 'minute' || precisionNew === 'hour';

  const netOldLocal = formatDateTimeValue(oldNetIso, tz);
  const netNewLocal = formatDateTimeValue(newNetIso, tz);
  const netRangeOld = formatNetRange({
    netDate: parseIsoDate(oldNetIso),
    windowStart: parseIsoDate(oldWindowStartIso),
    windowEnd: parseIsoDate(oldWindowEndIso),
    tz,
    hasSpecificTime: hasSpecificOld
  });
  const netRangeNew = formatNetRange({
    netDate: parseIsoDate(newNetIso),
    windowStart: parseIsoDate(newWindowStartIso),
    windowEnd: parseIsoDate(newWindowEndIso),
    tz,
    hasSpecificTime: hasSpecificNew
  });
  const windowOld = formatWindowRange(oldWindowStartIso, oldWindowEndIso, tz);
  const windowNew = formatWindowRange(newWindowStartIso, newWindowEndIso, tz);

  return {
    status_old: statusOld,
    status_new: statusNew,
    net_old_local: netOldLocal,
    net_new_local: netNewLocal,
    net_range_old: netRangeOld,
    net_range_new: netRangeNew,
    window_old: windowOld,
    window_new: windowNew,
    net_range_short: baseContext.tokens.net_range_short
  };
}

async function enqueueUpdatePost(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  payload: {
    launch_id: string;
    launch_update_id: number;
    platform: string;
    post_type: string;
    status: string;
    template_id: string;
    question_id: string | null;
    post_text: string;
    scheduled_for: string;
  },
  xMaxChars: number
) {
  return await enqueueSegmentedSocialPost({
    supabase,
    payload: {
      ...payload,
      launch_update_id: payload.launch_update_id,
      base_day: null,
      reply_template_id: null,
      question_id: payload.question_id,
      reply_text: null
    },
    xMaxChars
  });
}

async function processUpdateQueue({
  supabase,
  apiKey,
  uploadPostUser,
  enabledPlatforms,
  facebookPageId,
  retryWindowHours,
  updatesMaxPerRun,
  updatesMinGapMinutes,
  dryRun,
  now,
  lockId,
  claimBatchSize,
  sendLockStaleMinutes,
  deadlineMs
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  apiKey: string;
  uploadPostUser: string;
  enabledPlatforms: SupportedPlatform[];
  facebookPageId: string;
  retryWindowHours: number;
  updatesMaxPerRun: number;
  updatesMinGapMinutes: number;
  dryRun: boolean;
  now: Date;
  lockId: string;
  claimBatchSize: number;
  sendLockStaleMinutes: number;
  deadlineMs: number;
}) {
  const cutoffIso = new Date(now.getTime() - retryWindowHours * 60 * 60 * 1000).toISOString();
  const perClaimLimit = Math.max(updatesMaxPerRun, claimBatchSize);
  let sent = 0;
  let skipped = 0;
  let deferred = 0;
  let failed = 0;
  let missingRootSkipped = 0;
  const missingRootSamples: Array<{
    id: string;
    launch_id: string;
    platform: string;
    scheduled_for: string | null;
    reason: 'missing_root_post' | 'missing_root_reply_id';
  }> = [];

  while (hasRuntimeBudgetRemaining(deadlineMs)) {
    const rows = await claimDueSocialPosts({
      supabase,
      lockId,
      platforms: enabledPlatforms,
      postTypes: ['status_change', 'net_change', 'window_change'],
      statuses: ['pending', 'failed'],
      scheduledBeforeIso: new Date().toISOString(),
      scheduledAfterIso: cutoffIso,
      limit: perClaimLimit,
      maxAttempts: null,
      sendLockStaleMinutes
    });
    if (!rows.length) break;

    const launchIds = [...new Set(rows.map((row) => row.launch_id))];
    const launches = await loadLaunchesByIds(supabase, launchIds);
    const launchById = new Map(launches.map((launch) => [launch.id, launch]));
    const basePostMsByLaunchId = new Map<string, number | null>();
    const rootPosts = await loadRootPosts(supabase, launchIds, enabledPlatforms);
    const rootByLaunchPlatform = buildLatestSentRootByLaunchPlatform(rootPosts);
    const launchDayPosts = await loadLaunchDayPosts(supabase, launchIds, enabledPlatforms);
    const launchDayBaseMsByLaunchId = buildLaunchDayBaseMsByLaunchId(launchDayPosts);
    const lastSentByLaunchPlatform = await loadLastUpdateSent(supabase, launchIds, enabledPlatforms);
    const parentPostIds = [...new Set(rows.map((row) => row.reply_to_social_post_id).filter((id): id is string => Boolean(id)))];
    const parentPosts = await loadSocialPostsByIds(supabase, parentPostIds);
    const parentPostById = new Map(parentPosts.map((post) => [post.id, post]));

    for (const row of rows) {
      const platform = row.platform as SupportedPlatform;
      if (!hasRuntimeBudgetRemaining(deadlineMs)) {
        await markPostDeferred(supabase, row.id, 'runtime_budget_exhausted', { lockId });
        deferred += 1;
        continue;
      }
      if (!row.post_text) {
        await markPostFailed(supabase, row.id, 'missing_post_text', { lockId });
        failed += 1;
        continue;
      }
      if (dryRun) {
        await markPostSkipped(supabase, row.id, 'dry_run', { lockId });
        skipped += 1;
        continue;
      }

      const launch = launchById.get(row.launch_id);
      if (launch) {
        const tz = resolveTimeZone(launch.pad_timezone);
        if (!basePostMsByLaunchId.has(launch.id)) {
          const computedBasePostMs = resolveBaseLaunchPostMs(launch, tz);
          const launchDayBasePostMs = launchDayBaseMsByLaunchId.get(launch.id) ?? null;
          basePostMsByLaunchId.set(launch.id, minFiniteNumber(computedBasePostMs, launchDayBasePostMs));
        }
        const basePostMs = basePostMsByLaunchId.get(launch.id) ?? null;
        const scheduledMs = row.scheduled_for ? Date.parse(row.scheduled_for) : NaN;
        if (!Number.isFinite(scheduledMs) || basePostMs == null || !Number.isFinite(basePostMs) || scheduledMs < basePostMs) {
          await markPostSkipped(supabase, row.id, 'before_base_post', { lockId });
          skipped += 1;
          continue;
        }
      } else {
        await markPostSkipped(supabase, row.id, 'missing_launch', { lockId });
        skipped += 1;
        continue;
      }

      const basePostMs = basePostMsByLaunchId.get(row.launch_id) ?? null;
      const windowEndExclusiveMs = basePostMs != null ? basePostMs + LAUNCH_DAY_POST_TOTAL_WINDOW_MS : null;
      const sendDeadlineMs = windowEndExclusiveMs != null ? windowEndExclusiveMs + LAUNCH_DAY_POST_GRACE_MS : null;
      const windowOpen =
        basePostMs != null &&
        Number.isFinite(basePostMs) &&
        sendDeadlineMs != null &&
        Number.isFinite(sendDeadlineMs) &&
        now.getTime() < sendDeadlineMs;

      const segmentIndex = clampInt(Number(row.thread_segment_index || 1), 1, 100_000);
      const isContinuation = segmentIndex > 1;
      let replyToId: string | null = null;

      if (platform === 'x' && row.reply_to_social_post_id) {
        const parent = parentPostById.get(row.reply_to_social_post_id);
        if (!parent) {
          await markPostDeferred(supabase, row.id, 'missing_parent_segment', { lockId });
          deferred += 1;
          continue;
        }
        const resolvedParentId = resolveReplyToId(parent, platform);
        if (!resolvedParentId) {
          await markPostDeferred(supabase, row.id, 'parent_external_id_missing', { lockId });
          deferred += 1;
          continue;
        }
        replyToId = resolvedParentId;
      } else {
        const root = rootByLaunchPlatform.get(`${row.launch_id}:${platform}`);
        if (!root) {
          if (windowOpen) {
            await markPostDeferred(supabase, row.id, 'missing_root_post', { lockId });
            deferred += 1;
          } else {
            await markPostSkipped(supabase, row.id, 'missing_root_post', { lockId });
            skipped += 1;
            missingRootSkipped += 1;
            if (missingRootSamples.length < 5) {
              missingRootSamples.push({
                id: row.id,
                launch_id: row.launch_id,
                platform,
                scheduled_for: row.scheduled_for ?? null,
                reason: 'missing_root_post'
              });
            }
          }
          continue;
        }
        const resolvedRootId = platform === 'x' ? resolveReplyToId(root, platform) : null;
        if (platform === 'x' && !resolvedRootId) {
          if (windowOpen) {
            await markPostDeferred(supabase, row.id, 'missing_root_reply_id', { lockId });
            deferred += 1;
          } else {
            await markPostSkipped(supabase, row.id, 'missing_root_reply_id', { lockId });
            skipped += 1;
            missingRootSkipped += 1;
            if (missingRootSamples.length < 5) {
              missingRootSamples.push({
                id: row.id,
                launch_id: row.launch_id,
                platform,
                scheduled_for: row.scheduled_for ?? null,
                reason: 'missing_root_reply_id'
              });
            }
          }
          continue;
        }
        replyToId = resolvedRootId;
      }

      const lastSentAt = lastSentByLaunchPlatform.get(`${row.launch_id}:${platform}`);
      if (!isContinuation && updatesMinGapMinutes > 0 && lastSentAt) {
        const lastMs = Date.parse(lastSentAt);
        if (Number.isFinite(lastMs) && now.getTime() - lastMs < updatesMinGapMinutes * 60 * 1000) {
          await markPostDeferred(supabase, row.id, 'min_gap', { lockId });
          deferred += 1;
          continue;
        }
      }

      const sendResult = await sendUploadPost({
        apiKey,
        user: uploadPostUser,
        platform,
        facebookPageId,
        text: row.post_text,
        replyToId: replyToId || undefined
      });

      if (sendResult.status === 'async') {
        await markPostAsync(supabase, row.id, sendResult.requestId, { lockId });
        deferred += 1;
        continue;
      }
      if (sendResult.status === 'success') {
        await markPostSent(supabase, row.id, sendResult.externalId, sendResult.results, { lockId });
        parentPostById.set(row.id, {
          ...row,
          status: 'sent',
          external_id: sendResult.externalId,
          platform_results: sendResult.results || null
        });
        await resolveOpsAlert(supabase, 'social_posts_uploadpost_quota_exhausted');
        sent += 1;
        continue;
      }
      const errorMessage = sendResult.errorMessage || 'upload_failed';
      if (isUploadPostQuotaError(errorMessage)) {
        await upsertOpsAlert(supabase, {
          key: 'social_posts_uploadpost_quota_exhausted',
          severity: 'critical',
          message: 'UploadPost quota exhausted; social posts cannot be published.',
          details: {
            platform,
            post_type: row.post_type,
            launch_id: row.launch_id,
            social_post_id: row.id,
            scheduled_for: row.scheduled_for,
            attempts: row.attempts ?? 0,
            remaining_uploads: extractUploadPostRemainingUploads(errorMessage),
            error: errorMessage
          }
        });
      }

      await markPostFailed(supabase, row.id, errorMessage, { lockId });
      failed += 1;
    }
  }

	  if (missingRootSkipped > 0) {
	    await upsertOpsAlert(supabase, {
	      key: 'social_posts_updates_blocked_missing_root',
	      severity: 'warning',
	      message: 'Social post updates skipped because the launch-day root post or reply target was missing.',
	      details: { count: missingRootSkipped, samples: missingRootSamples }
	    });
	  } else {
	    await resolveOpsAlert(supabase, 'social_posts_updates_blocked_missing_root');
	  }

	  return { sent, skipped, deferred, failed };
}

async function loadLaunchDayPosts(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[],
  platforms: SupportedPlatform[]
) {
  if (!launchIds.length || !platforms.length) return [] as SocialPostRow[];
  const { data, error } = await supabase
    .from('social_posts')
    .select('id,launch_id,platform,post_type,base_day,status,thread_segment_index,scheduled_for,posted_at')
    .eq('post_type', 'launch_day')
    .eq('thread_segment_index', 1)
    .in('platform', platforms)
    .in('launch_id', launchIds);
  if (error) throw error;
  return (data || []) as SocialPostRow[];
}

async function loadRootPosts(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[],
  platforms: SupportedPlatform[]
) {
  if (!launchIds.length || !platforms.length) return [] as SocialPostRow[];
  const { data, error } = await supabase
    .from('social_posts')
    .select(
      'id,launch_id,platform,post_type,base_day,status,template_id,reply_template_id,question_id,post_text,reply_text,thread_segment_index,reply_to_social_post_id,request_id,external_id,attempts,scheduled_for,posted_at,platform_results'
    )
    .eq('post_type', 'launch_day')
    .eq('thread_segment_index', 1)
    .in('platform', platforms)
    .eq('status', 'sent')
    .in('launch_id', launchIds);
  if (error) throw error;
  return (data || []) as SocialPostRow[];
}

async function loadSocialPostsByIds(supabase: ReturnType<typeof createSupabaseAdminClient>, ids: string[]) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return [] as SocialPostRow[];
  const { data, error } = await supabase
    .from('social_posts')
    .select('id,platform,status,external_id,platform_results')
    .in('id', unique);
  if (error) throw error;
  return (data || []) as SocialPostRow[];
}

async function detectMissedLaunchDayPosts({
  supabase,
  launches,
  enabledPlatforms,
  now,
  xMaxChars
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launches: LaunchRow[];
  enabledPlatforms: SupportedPlatform[];
  now: Date;
  xMaxChars: number;
}): Promise<{ checked: number; missed: number; resolved: number; recoveryQueued: number }> {
  const nowMs = now.getTime();
  const launchIds = [...new Set((launches || []).map((launch) => launch.id).filter(Boolean))];
  if (!launchIds.length || !enabledPlatforms.length) return { checked: 0, missed: 0, resolved: 0, recoveryQueued: 0 };

  const launchDayPosts = await loadLaunchDayPosts(supabase, launchIds, enabledPlatforms);
  const weatherRows = await loadWeatherRows(supabase, launchIds);
  const weatherByLaunch = groupWeatherByLaunch(weatherRows);
  const okKeys = new Set<string>();
  for (const row of launchDayPosts) {
    const baseDay = resolveLaunchDayBaseDayFromRow(row);
    if (!baseDay) continue;
    const status = String(row.status || '').trim().toLowerCase();
    if (status === 'sent' || status === 'async' || status === 'sending') {
      okKeys.add(`${row.launch_id}:${row.platform}:${baseDay}`);
    }
  }

  let checked = 0;
  let missed = 0;
  let resolved = 0;
  let recoveryQueued = 0;

  for (const launch of launches) {
    if (!launch?.id) continue;
    const status = `${launch.status_name || ''} ${launch.status_abbrev || ''}`.toLowerCase();
    if (status.includes('scrub') || status.includes('cancel')) continue;

    const tz = resolveTimeZone(launch.pad_timezone);
    const basePostMs = resolveBaseLaunchPostMs(launch, tz);
    if (basePostMs == null || !Number.isFinite(basePostMs)) continue;

	    const windowEndExclusiveMs = basePostMs + LAUNCH_DAY_POST_TOTAL_WINDOW_MS;
	    const alertAfterMs = windowEndExclusiveMs + LAUNCH_DAY_POST_GRACE_MS;
	    if (!Number.isFinite(windowEndExclusiveMs) || !Number.isFinite(alertAfterMs) || nowMs < alertAfterMs) continue;

    const baseDay = formatYmd(getZonedParts(new Date(basePostMs), tz));
    checked += 1;

    const missingPlatforms: SupportedPlatform[] = [];
    for (const platform of enabledPlatforms) {
      const key = `${launch.id}:${platform}:${baseDay}`;
      if (!okKeys.has(key)) {
        missingPlatforms.push(platform);
      } else {
        await resolveOpsAlert(supabase, buildLaunchDayFailedAlertKey({ launchId: launch.id, platform, baseDay }));
      }
    }

    const missedKey = buildLaunchDayMissedAlertKey({ launchId: launch.id, baseDay });
    if (missingPlatforms.length) {
      missed += 1;
      const recoveryQueuedPlatforms: SupportedPlatform[] = [];
      const unrecoveredPlatforms: SupportedPlatform[] = [];
      for (const platform of missingPlatforms) {
        const recovered = await ensureLateLaunchDayRecoveryPost({
          supabase,
          launch,
          platform,
          baseDay,
          now,
          xMaxChars,
          weatherRows: weatherByLaunch.get(launch.id) || []
        });
        if (recovered) {
          recoveryQueued += 1;
          recoveryQueuedPlatforms.push(platform);
        } else {
          unrecoveredPlatforms.push(platform);
        }
      }

      await upsertOpsAlert(supabase, {
        key: missedKey,
        severity: unrecoveredPlatforms.length ? 'critical' : 'warning',
        message: unrecoveredPlatforms.length
          ? `Launch-day post missed for ${launch.mission_name || launch.name || launch.id}.`
          : `Launch-day post missed window but recovery queued for ${launch.mission_name || launch.name || launch.id}.`,
        details: {
          launch_id: launch.id,
          mission: (launch.mission_name || launch.name || '').trim() || null,
          provider: (launch.provider || '').trim() || null,
          rocket: (launch.rocket_full_name || launch.vehicle || '').trim() || null,
          pad: (launch.pad_name || '').trim() || null,
          location: (launch.pad_location_name || '').trim() || null,
          base_day: baseDay,
          pad_timezone: tz,
	          expected_window_local: '08:00–11:00',
	          grace_minutes: Math.round(LAUNCH_DAY_POST_GRACE_MS / (60 * 1000)),
	          base_post_at: new Date(basePostMs).toISOString(),
	          window_end_at: new Date(windowEndExclusiveMs).toISOString(),
          alert_after_at: new Date(alertAfterMs).toISOString(),
          missing_platforms: missingPlatforms,
          recovery_queued_platforms: recoveryQueuedPlatforms,
          unrecovered_platforms: unrecoveredPlatforms
        }
      });
    } else {
      await resolveOpsAlert(supabase, missedKey);
      resolved += 1;
    }
  }

  return { checked, missed, resolved, recoveryQueued };
}

async function ensureLateLaunchDayRecoveryPost({
  supabase,
  launch,
  platform,
  baseDay,
  now,
  xMaxChars,
  weatherRows
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launch: LaunchRow;
  platform: SupportedPlatform;
  baseDay: string;
  now: Date;
  xMaxChars: number;
  weatherRows: WeatherRow[];
}) {
  const nowIso = now.toISOString();
  const { data: existingRows, error: existingError } = await supabase
    .from('social_posts')
    .select('id,status,scheduled_for')
    .eq('post_type', 'launch_day')
    .eq('launch_id', launch.id)
    .eq('platform', platform)
    .eq('base_day', baseDay)
    .eq('thread_segment_index', 1)
    .order('created_at', { ascending: false })
    .limit(1);
  if (existingError) throw existingError;

  const existing = ((existingRows || [])[0] as { id: string; status: string | null; scheduled_for: string | null } | undefined) || null;
  if (existing?.id) {
    const existingStatus = String(existing.status || '').trim().toLowerCase();
    if (existingStatus === 'sent' || existingStatus === 'async' || existingStatus === 'sending' || existingStatus === 'pending') {
      return true;
    }
    const { error: requeueError } = await supabase
      .from('social_posts')
      .update({
        status: 'pending',
        scheduled_for: nowIso,
        last_error: truncateError('late_recovery_requeue'),
        send_lock_id: null,
        send_locked_at: null
      })
      .eq('id', existing.id);
    if (requeueError) {
      console.warn('social_posts late recovery requeue warning', requeueError.message);
      return false;
    }
    return true;
  }

  const tz = resolveTimeZone(launch.pad_timezone);
  const context = buildPostContext({
    launch,
    tz,
    weatherRows
  });
  const templateSet = context.whenKey === 'tomorrow' ? MAIN_TEMPLATES_TOMORROW : MAIN_TEMPLATES_TODAY;
  const templateIndex = 0;
  const rendered = renderTemplate(templateSet[templateIndex] || MAIN_TEMPLATES_TODAY[0] || '{mission}', context.tokens, MAX_TEMPLATE_RENDER_LEN);
  const postText = normalizeLaunchDayMainTextForPlatform(stripLaunchDayLinkLine(rendered), platform);

  const insertResult = await claimSocialPost(
    supabase,
    {
      launch_id: launch.id,
      platform,
      post_type: 'launch_day',
      base_day: baseDay,
      status: 'pending',
      template_id: String(templateIndex),
      reply_template_id: null,
      post_text: postText,
      reply_text: null,
      scheduled_for: nowIso
    },
    xMaxChars
  );

  return insertResult.ids.length > 0;
}

async function loadRecentSocialPostMeta(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    platform,
    postType,
    limit
  }: {
    platform: string;
    postType: string;
    limit: number;
  }
) {
  if (!limit) return { templateIndices: new Set<number>(), replyTemplateIndices: new Set<number>(), questionIds: new Set<string>() };
  const { data, error } = await supabase
    .from('social_posts')
    .select('template_id,reply_template_id,question_id')
    .eq('platform', platform)
    .eq('post_type', postType)
    .eq('thread_segment_index', 1)
    .in('status', ['pending', 'sent', 'failed', 'async'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const templateIndices = new Set<number>();
  const replyTemplateIndices = new Set<number>();
  const questionIds = new Set<string>();
  for (const row of (data || []) as Array<{
    template_id: string | null;
    reply_template_id: string | null;
    question_id: string | null;
  }>) {
    const idx = row.template_id != null ? Number(row.template_id) : NaN;
    if (Number.isFinite(idx)) templateIndices.add(idx);
    const replyIdx = row.reply_template_id != null ? Number(row.reply_template_id) : NaN;
    if (Number.isFinite(replyIdx)) replyTemplateIndices.add(replyIdx);
    if (row.question_id) questionIds.add(String(row.question_id));
  }

  return { templateIndices, replyTemplateIndices, questionIds };
}

async function loadLastUpdateSent(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[],
  platforms: SupportedPlatform[]
) {
  if (!launchIds.length || !platforms.length) return new Map<string, string>();
  const { data, error } = await supabase
    .from('social_posts')
    .select('launch_id,platform,posted_at')
    .in('launch_id', launchIds)
    .in('platform', platforms)
    .in('post_type', ['status_change', 'net_change', 'window_change'])
    .eq('status', 'sent')
    .order('posted_at', { ascending: false });
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of data || []) {
    if (!row.launch_id || !row.posted_at || !row.platform) continue;
    const key = `${row.launch_id}:${row.platform}`;
    if (!map.has(key)) map.set(key, row.posted_at as string);
  }
  return map;
}

async function scheduleThreadReplies({
  supabase,
  launches,
  now,
  enabledPlatforms,
  missionDropEnabled,
  missionDropMinAfter8Minutes,
  missionDropMinBeforeLaunchMinutes,
  missionBriefEnabled,
  missionBriefStartHourLocal,
  missionBriefMinBeforeLaunchMinutes,
  xMaxChars,
  noRepeatDepth
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launches: LaunchRow[];
  now: Date;
  enabledPlatforms: SupportedPlatform[];
  missionDropEnabled: boolean;
  missionDropMinAfter8Minutes: number;
  missionDropMinBeforeLaunchMinutes: number;
  missionBriefEnabled: boolean;
  missionBriefStartHourLocal: number;
  missionBriefMinBeforeLaunchMinutes: number;
  xMaxChars: number;
  noRepeatDepth: number;
}) {
  const queued = { queued: 0 };
  if (!missionDropEnabled && !missionBriefEnabled) return queued;

  const launchIds = launches.map((launch) => launch.id);
  const rootPosts = await loadLaunchDayPosts(supabase, launchIds, enabledPlatforms);
  const rootByLaunchPlatform = buildLatestLaunchDayPostByLaunchPlatform(rootPosts);
  if (!rootByLaunchPlatform.size) return queued;

  const nowMs = now.getTime();

  const recentDropTemplates = new Set<number>();
  const recentBriefTemplates = new Set<number>();
  if (noRepeatDepth) {
    for (const platform of enabledPlatforms) {
      const recentDrop = await loadRecentSocialPostMeta(supabase, {
        platform,
        postType: 'mission_drop',
        limit: noRepeatDepth
      });
      for (const idx of recentDrop.templateIndices) recentDropTemplates.add(idx);

      const recentBrief = await loadRecentSocialPostMeta(supabase, {
        platform,
        postType: 'mission_brief',
        limit: noRepeatDepth
      });
      for (const idx of recentBrief.templateIndices) recentBriefTemplates.add(idx);
    }
  }

  for (const launch of launches) {
    const platformsWithRoot: SupportedPlatform[] = [];
    for (const platform of enabledPlatforms) {
      if (rootByLaunchPlatform.has(`${launch.id}:${platform}`)) platformsWithRoot.push(platform);
    }
	    if (!platformsWithRoot.length) continue;

	    const root = rootByLaunchPlatform.get(`${launch.id}:${platformsWithRoot[0]}`)!;
	    const baseDay = resolveLaunchDayBaseDayFromRow(root);
	    if (!baseDay) continue;

	    const tz = resolveTimeZone(launch.pad_timezone);
	    const precision = normalizeNetPrecision(launch.net_precision);
	    const hasSpecificTime = precision === 'minute' || precision === 'hour';
	    const launchMs = launch.net ? Date.parse(launch.net) : NaN;
    if (!hasSpecificTime || !Number.isFinite(launchMs)) continue;

    const context = buildPostContext({ launch, tz, weatherRows: [] });
    const tokens = context.tokens;

	    const missionDrop = missionDropEnabled
	      ? await scheduleMissionDrop({
	          supabase,
	          launch,
	          root,
	          baseDay,
	          platforms: platformsWithRoot,
	          tz,
	          nowMs,
	          launchMs,
	          minAfter8Minutes: missionDropMinAfter8Minutes,
          minBeforeLaunchMinutes: missionDropMinBeforeLaunchMinutes,
          tokens,
          xMaxChars,
          excludedTemplateIndices: recentDropTemplates
        })
      : null;
    if (missionDrop) queued.queued += missionDrop.insertedCount;

	    const missionBrief = missionBriefEnabled
	      ? await scheduleMissionBrief({
	          supabase,
	          launch,
	          baseDay,
	          platforms: platformsWithRoot,
	          tz,
	          nowMs,
	          launchMs,
	          startHourLocal: missionBriefStartHourLocal,
          minBeforeLaunchMinutes: missionBriefMinBeforeLaunchMinutes,
          tokens,
          xMaxChars,
          excludedTemplateIndices: recentBriefTemplates,
          avoidTemplateIndex: missionDrop?.templateIndex ?? null
        })
      : null;
    if (missionBrief) queued.queued += missionBrief.insertedCount;
  }

  return queued;
}

async function scheduleMissionDrop({
  supabase,
  launch,
  root,
  baseDay,
  platforms,
  tz,
  nowMs,
  launchMs,
  minAfter8Minutes,
  minBeforeLaunchMinutes,
  tokens,
  xMaxChars,
  excludedTemplateIndices
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launch: LaunchRow;
  root: SocialPostRow;
  baseDay: string;
  platforms: SupportedPlatform[];
  tz: string;
  nowMs: number;
  launchMs: number;
  minAfter8Minutes: number;
  minBeforeLaunchMinutes: number;
  tokens: Record<string, string>;
  xMaxChars: number;
  excludedTemplateIndices: Set<number>;
}): Promise<{ templateIndex: number; insertedCount: number } | null> {
  const baseIso = root.scheduled_for || root.posted_at;
  const baseDate = parseIsoDate(baseIso) || new Date(nowMs);
  const baseParts = getZonedParts(baseDate, tz);
  const startTotalMinutes = 8 * 60 + clampInt(minAfter8Minutes, 0, 24 * 60);
  const startHour = Math.min(23, Math.floor(startTotalMinutes / 60));
  const startMinute = startTotalMinutes % 60;
  const startMs = zonedLocalToUtcMs({
    tz,
    year: baseParts.year,
    month: baseParts.month,
    day: baseParts.day,
    hour: startHour,
    minute: startMinute
  });

  const endMs = launchMs - clampInt(minBeforeLaunchMinutes, 0, 24 * 60) * 60 * 1000;
  const effectiveStart = Math.max(startMs, nowMs);
  if (!Number.isFinite(endMs) || endMs <= effectiveStart) return null;

  const scheduledFor = new Date(pickRandomMinuteMs(effectiveStart, endMs)).toISOString();
  const templateIndex = pickTemplateIndexAvoiding(MISSION_CALLOUT_TEMPLATES.length, excludedTemplateIndices);
  excludedTemplateIndices.add(templateIndex);
  const postText = renderTemplate(MISSION_CALLOUT_TEMPLATES[templateIndex]!, tokens, MAX_TEMPLATE_RENDER_LEN);

  let insertedCount = 0;
  for (const platform of platforms) {
	    const inserted = await enqueueThreadReplyPost(supabase, {
	      launch_id: launch.id,
	      platform,
	      post_type: 'mission_drop',
	      base_day: baseDay,
	      status: 'pending',
	      template_id: String(templateIndex),
	      question_id: null,
	      post_text: postText,
	      scheduled_for: scheduledFor
	    }, xMaxChars);
    insertedCount += inserted.insertedIds.length;
  }

  if (!insertedCount) return null;
  return { templateIndex, insertedCount };
}

async function scheduleMissionBrief({
  supabase,
  launch,
  baseDay,
  platforms,
  tz,
  nowMs,
  launchMs,
  startHourLocal,
  minBeforeLaunchMinutes,
  tokens,
  xMaxChars,
  excludedTemplateIndices,
  avoidTemplateIndex
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launch: LaunchRow;
  baseDay: string;
  platforms: SupportedPlatform[];
  tz: string;
  nowMs: number;
  launchMs: number;
  startHourLocal: number;
  minBeforeLaunchMinutes: number;
  tokens: Record<string, string>;
  xMaxChars: number;
  excludedTemplateIndices: Set<number>;
  avoidTemplateIndex: number | null;
}): Promise<{ templateIndex: number; insertedCount: number } | null> {
  const launchParts = getZonedParts(new Date(launchMs), tz);
  const startMs = zonedLocalToUtcMs({
    tz,
    year: launchParts.year,
    month: launchParts.month,
    day: launchParts.day,
    hour: clampInt(startHourLocal, 0, 23),
    minute: 0
  });

  const endMs = launchMs - clampInt(minBeforeLaunchMinutes, 0, 24 * 60) * 60 * 1000;
  const effectiveStart = Math.max(startMs, nowMs);
  if (!Number.isFinite(endMs) || endMs <= effectiveStart) return null;

  const scheduledFor = new Date(pickRandomMinuteMs(effectiveStart, endMs)).toISOString();

  const exclusion = new Set<number>(excludedTemplateIndices);
  if (avoidTemplateIndex != null) exclusion.add(avoidTemplateIndex);
  const templateIndex = pickTemplateIndexAvoiding(MISSION_CALLOUT_TEMPLATES.length, exclusion);
  excludedTemplateIndices.add(templateIndex);
  const postText = renderTemplate(MISSION_CALLOUT_TEMPLATES[templateIndex]!, tokens, MAX_TEMPLATE_RENDER_LEN);

  let insertedCount = 0;
  for (const platform of platforms) {
	    const inserted = await enqueueThreadReplyPost(supabase, {
	      launch_id: launch.id,
	      platform,
	      post_type: 'mission_brief',
	      base_day: baseDay,
	      status: 'pending',
	      template_id: String(templateIndex),
	      question_id: null,
	      post_text: postText,
	      scheduled_for: scheduledFor
	    }, xMaxChars);
    insertedCount += inserted.insertedIds.length;
  }

  if (!insertedCount) return null;
  return { templateIndex, insertedCount };
}

async function enqueueThreadReplyPost(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  payload: {
    launch_id: string;
    platform: string;
    post_type: string;
    base_day: string;
    status: string;
    template_id: string;
    question_id: string | null;
    post_text: string;
    scheduled_for: string;
  },
  xMaxChars: number
) {
  return await enqueueSegmentedSocialPost({
    supabase,
    payload: {
      ...payload,
      launch_update_id: null,
      reply_template_id: null,
      reply_text: null
    },
    xMaxChars
  });
}

async function processThreadReplyQueue({
  supabase,
  apiKey,
  uploadPostUser,
  enabledPlatforms,
  facebookPageId,
  maxAttempts,
  retryWindowHours,
  maxPerRun,
  dryRun,
  now,
  lockId,
  claimBatchSize,
  sendLockStaleMinutes,
  deadlineMs
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  apiKey: string;
  uploadPostUser: string;
  enabledPlatforms: SupportedPlatform[];
  facebookPageId: string;
  maxAttempts: number;
  retryWindowHours: number;
  maxPerRun: number;
  dryRun: boolean;
  now: Date;
  lockId: string;
  claimBatchSize: number;
  sendLockStaleMinutes: number;
  deadlineMs: number;
}) {
  const cutoffHours = Math.max(retryWindowHours, 24);
  const cutoffIso = new Date(now.getTime() - cutoffHours * 60 * 60 * 1000).toISOString();
  const perClaimLimit = Math.max(maxPerRun, claimBatchSize);
  let sent = 0;
  let skipped = 0;
  let deferred = 0;
  let failed = 0;

  while (hasRuntimeBudgetRemaining(deadlineMs)) {
    const rows = await claimDueSocialPosts({
      supabase,
      lockId,
      platforms: enabledPlatforms,
      postTypes: ['mission_drop', 'mission_brief'],
      statuses: ['pending', 'failed'],
      scheduledBeforeIso: new Date().toISOString(),
      scheduledAfterIso: cutoffIso,
      limit: perClaimLimit,
      maxAttempts,
      sendLockStaleMinutes
    });
    if (!rows.length) break;

    const launchIds = [...new Set(rows.map((row) => row.launch_id))];
    const rootPosts = await loadRootPosts(supabase, launchIds, enabledPlatforms);
    const rootByLaunchPlatform = buildLatestSentRootByLaunchPlatform(rootPosts);
    const parentPostIds = [...new Set(rows.map((row) => row.reply_to_social_post_id).filter((id): id is string => Boolean(id)))];
    const parentPosts = await loadSocialPostsByIds(supabase, parentPostIds);
    const parentPostById = new Map(parentPosts.map((post) => [post.id, post]));
    const rootByLaunchPlatformBaseDay = new Map<string, SocialPostRow>();
    for (const root of rootPosts) {
      const baseDay = resolveLaunchDayBaseDayFromRow(root);
      if (!baseDay) continue;
      const key = `${root.launch_id}:${root.platform}:${baseDay}`;
      const existing = rootByLaunchPlatformBaseDay.get(key);
      if (!existing) {
        rootByLaunchPlatformBaseDay.set(key, root);
        continue;
      }
      const existingMs = parseTimestampMs(existing.posted_at) ?? parseTimestampMs(existing.scheduled_for) ?? -1;
      const candidateMs = parseTimestampMs(root.posted_at) ?? parseTimestampMs(root.scheduled_for) ?? -1;
      if (candidateMs > existingMs) rootByLaunchPlatformBaseDay.set(key, root);
    }

    for (const row of rows) {
      const platform = row.platform as SupportedPlatform;
      if (!hasRuntimeBudgetRemaining(deadlineMs)) {
        await markPostDeferred(supabase, row.id, 'runtime_budget_exhausted', { lockId });
        deferred += 1;
        continue;
      }
      if (!row.post_text) {
        await markPostFailed(supabase, row.id, 'missing_post_text', { lockId });
        failed += 1;
        continue;
      }
      if (dryRun) {
        await markPostSkipped(supabase, row.id, 'dry_run', { lockId });
        skipped += 1;
        continue;
      }

      let replyToId: string | null = null;
      if (platform === 'x' && row.reply_to_social_post_id) {
        const parent = parentPostById.get(row.reply_to_social_post_id);
        if (!parent) {
          await markPostDeferred(supabase, row.id, 'missing_parent_segment', { lockId });
          deferred += 1;
          continue;
        }
        const resolvedParentId = resolveReplyToId(parent, platform);
        if (!resolvedParentId) {
          await markPostDeferred(supabase, row.id, 'parent_external_id_missing', { lockId });
          deferred += 1;
          continue;
        }
        replyToId = resolvedParentId;
      } else {
        const baseDay = resolveLaunchDayBaseDayFromRow(row);
        const root =
          (baseDay ? rootByLaunchPlatformBaseDay.get(`${row.launch_id}:${platform}:${baseDay}`) : null) ||
          rootByLaunchPlatform.get(`${row.launch_id}:${platform}`);
        if (!root) {
          await markPostDeferred(supabase, row.id, 'missing_root_post', { lockId });
          deferred += 1;
          continue;
        }
        const resolvedRootId = platform === 'x' ? resolveReplyToId(root, platform) : null;
        if (platform === 'x' && !resolvedRootId) {
          await markPostDeferred(supabase, row.id, 'missing_root_post', { lockId });
          deferred += 1;
          continue;
        }
        replyToId = resolvedRootId;
      }

      const sendResult = await sendUploadPost({
        apiKey,
        user: uploadPostUser,
        platform,
        facebookPageId,
        text: row.post_text,
        replyToId: replyToId || undefined
      });

      if (sendResult.status === 'async') {
        await markPostAsync(supabase, row.id, sendResult.requestId, { lockId });
        deferred += 1;
        continue;
      }
      if (sendResult.status === 'success') {
        await markPostSent(supabase, row.id, sendResult.externalId, sendResult.results, { lockId });
        parentPostById.set(row.id, {
          ...row,
          status: 'sent',
          external_id: sendResult.externalId,
          platform_results: sendResult.results || null
        });
        await resolveOpsAlert(supabase, 'social_posts_uploadpost_quota_exhausted');
        sent += 1;
        continue;
      }
      const errorMessage = sendResult.errorMessage || 'upload_failed';
      if (isUploadPostQuotaError(errorMessage)) {
        await upsertOpsAlert(supabase, {
          key: 'social_posts_uploadpost_quota_exhausted',
          severity: 'critical',
          message: 'UploadPost quota exhausted; social posts cannot be published.',
          details: {
            platform,
            post_type: row.post_type,
            launch_id: row.launch_id,
            social_post_id: row.id,
            scheduled_for: row.scheduled_for,
            attempts: row.attempts ?? 0,
            remaining_uploads: extractUploadPostRemainingUploads(errorMessage),
            error: errorMessage
          }
        });
      }

      await markPostFailed(supabase, row.id, errorMessage, { lockId });
      failed += 1;
    }
  }

  return { sent, skipped, deferred, failed };
}

function resolveReplyToId(
  root: SocialPostRow & { platform_results?: SocialPlatformResults },
  platform: SupportedPlatform
) {
  if (platform === 'x') {
    const candidates: Array<string | null | undefined> = [
      root.external_id,
      ...extractPlatformResultFieldValues(root.platform_results, platform, ['id', 'post_id', 'url'])
    ];
    for (const value of candidates) {
      const resolved = extractTweetId(value);
      if (resolved) return resolved;
    }
    return null;
  }

  if (platform === 'facebook') {
    const candidates: Array<string | null | undefined> = [
      root.external_id,
      ...extractPlatformResultFieldValues(root.platform_results, platform, ['id', 'post_id', 'url'])
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  }

  return null;
}

function isSocialPlatformResult(value: unknown): value is SocialPlatformResult {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getPlatformResultCandidates(results: SocialPlatformResults | undefined, platform: SupportedPlatform) {
  const candidates: SocialPlatformResult[] = [];
  const pushCandidate = (value: unknown) => {
    if (isSocialPlatformResult(value)) candidates.push(value);
  };

  if (Array.isArray(results)) {
    for (const entry of results) pushCandidate(entry);
  } else if (isSocialPlatformResult(results)) {
    if (platform === 'x') {
      pushCandidate(results.x);
      pushCandidate(results.twitter);
    } else if (platform === 'facebook') {
      pushCandidate(results.facebook);
    }
    pushCandidate(results);
  }

  if (!candidates.length) return [] as SocialPlatformResult[];

  const matches = candidates.filter((candidate) => {
    const candidatePlatform = typeof candidate.platform === 'string' ? candidate.platform.trim().toLowerCase() : '';
    if (!candidatePlatform) return false;
    if (platform === 'x') return candidatePlatform === 'x' || candidatePlatform === 'twitter';
    return candidatePlatform === platform;
  });

  return matches.length ? matches : candidates;
}

function extractPlatformResultFieldValues(
  results: SocialPlatformResults | undefined,
  platform: SupportedPlatform,
  fields: string[]
) {
  const values: string[] = [];
  for (const candidate of getPlatformResultCandidates(results, platform)) {
    for (const field of fields) {
      const value = candidate[field];
      if (typeof value === 'string' && value.trim()) values.push(value.trim());
    }
  }
  return values;
}

function extractTweetId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/status\/(\d+)/i);
  return match ? match[1] : null;
}

function pickFirstString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  }
  return '';
}

function parseIsoDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseTimestampMs(value?: string | null) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function minFiniteNumber(...values: Array<number | null | undefined>) {
  let min: number | null = null;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    if (min == null || value < min) min = value;
  }
  return min;
}

function buildLaunchDayBaseMsByLaunchId(rows: SocialPostRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const ms = parseTimestampMs(row.scheduled_for) ?? parseTimestampMs(row.posted_at);
    if (ms == null) continue;
    const existing = map.get(row.launch_id);
    if (existing == null || ms < existing) map.set(row.launch_id, ms);
  }
  return map;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function formatYmd(parts: { year: number; month: number; day: number }) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function resolveLaunchDayBaseDayFromRow(row: SocialPostRow) {
  const baseDay = row.base_day != null ? String(row.base_day).trim() : '';
  if (baseDay && /^\d{4}-\d{2}-\d{2}$/.test(baseDay)) return baseDay;

  const iso = row.scheduled_for || row.posted_at;
  if (typeof iso !== 'string' || iso.length < 10) return null;
  const candidate = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  return candidate;
}

function buildLatestLaunchDayPostByLaunchPlatform(rows: SocialPostRow[]) {
  const map = new Map<string, SocialPostRow>();
  for (const row of rows) {
    const key = `${row.launch_id}:${row.platform}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    const existingMs = parseTimestampMs(existing.scheduled_for) ?? parseTimestampMs(existing.posted_at) ?? -1;
    const candidateMs = parseTimestampMs(row.scheduled_for) ?? parseTimestampMs(row.posted_at) ?? -1;
    if (candidateMs > existingMs) map.set(key, row);
  }
  return map;
}

function buildLatestSentRootByLaunchPlatform(rows: SocialPostRow[]) {
  const map = new Map<string, SocialPostRow>();
  for (const row of rows) {
    const key = `${row.launch_id}:${row.platform}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    const existingMs = parseTimestampMs(existing.posted_at) ?? parseTimestampMs(existing.scheduled_for) ?? -1;
    const candidateMs = parseTimestampMs(row.posted_at) ?? parseTimestampMs(row.scheduled_for) ?? -1;
    if (candidateMs > existingMs) map.set(key, row);
  }
  return map;
}

function formatDateTimeValue(value: string | null, tz: string) {
  const date = parseIsoDate(value);
  if (!date) return 'TBD';
  return formatDateTime(date, tz);
}

function formatDateWithYear(date: Date, tz: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: '2-digit',
      year: 'numeric'
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatDateTime(date: Date, tz: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatWindowRange(startIso: string | null, endIso: string | null, tz: string) {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start && !end) return 'TBD';
  if (start && end) {
    return `${formatDateTime(start, tz)}–${formatDateTime(end, tz)}`;
  }
  return formatDateTime(start || end!, tz);
}

async function processRetryPosts({
  supabase,
  apiKey,
  uploadPostUser,
  enabledPlatforms,
  facebookPageId,
  siteUrl,
  launchDayImagesEnabled,
  launchDayImageTimeoutMs,
  retryWindowHours,
  dryRun,
  now,
  lockId,
  claimBatchSize,
  sendLockStaleMinutes,
  deadlineMs
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  apiKey: string;
  uploadPostUser: string;
  enabledPlatforms: SupportedPlatform[];
  facebookPageId: string;
  siteUrl: string;
  launchDayImagesEnabled: boolean;
  launchDayImageTimeoutMs: number;
  retryWindowHours: number;
  dryRun: boolean;
  now: Date;
  lockId: string;
  claimBatchSize: number;
  sendLockStaleMinutes: number;
  deadlineMs: number;
}) {
  let attempted = 0;
  let posted = 0;
  let failed = 0;
  let skipped = 0;
  let deferred = 0;
  const ogImageCache = new Map<string, Promise<LaunchOgImage | null>>();
  const nowMs = now.getTime();
  while (hasRuntimeBudgetRemaining(deadlineMs)) {
    const rows = await claimDueSocialPosts({
      supabase,
      lockId,
      platforms: enabledPlatforms,
      postTypes: ['launch_day', 'no_launch_day'],
      statuses: ['pending', 'failed'],
      scheduledBeforeIso: new Date().toISOString(),
      scheduledAfterIso: null,
      limit: claimBatchSize,
      maxAttempts: null,
      sendLockStaleMinutes
    });
    if (!rows.length) break;

    attempted += rows.length;
    const parentPostIds = [...new Set(rows.map((row) => row.reply_to_social_post_id).filter((id): id is string => Boolean(id)))];
    const parentPosts = await loadSocialPostsByIds(supabase, parentPostIds);
    const parentPostById = new Map(parentPosts.map((post) => [post.id, post]));

    const launchDayLaunchIds = [
      ...new Set(rows.filter((row) => row.post_type === 'launch_day').map((row) => row.launch_id).filter(Boolean))
    ];
    const launchDayLaunches = launchDayLaunchIds.length ? await loadLaunchesByIds(supabase, launchDayLaunchIds) : [];
    const launchById = new Map<string, LaunchRow>(launchDayLaunches.map((launch) => [launch.id, launch]));
    const basePostMsByLaunchId = new Map<string, number | null>();

    const noLaunchDayLaunchIds = [...new Set(rows.filter((row) => row.post_type === 'no_launch_day').map((row) => row.launch_id).filter(Boolean))];
    const noLaunchDayImageCandidatesByLaunchId = noLaunchDayLaunchIds.length
      ? await loadLaunchImageCandidatesByIds(supabase, noLaunchDayLaunchIds)
      : new Map<string, { rocketImageUrl: string | null; launchImageUrl: string | null; thumbnailUrl: string | null }>();

    for (const row of rows) {
      const platform = row.platform as SupportedPlatform;
      if (!hasRuntimeBudgetRemaining(deadlineMs)) {
        await markPostDeferred(supabase, row.id, 'runtime_budget_exhausted', { lockId });
        deferred += 1;
        continue;
      }
      if (!row.post_text) {
        await markPostFailed(supabase, row.id, 'missing_post_text', { lockId });
        failed += 1;
        continue;
      }
      if (dryRun) {
        await markPostSkipped(supabase, row.id, 'dry_run', { lockId });
        skipped += 1;
        continue;
      }

      const isLaunchDay = row.post_type === 'launch_day';
      const isNoLaunchDay = row.post_type === 'no_launch_day';
      const segmentIndex = clampInt(Number(row.thread_segment_index || 1), 1, 100_000);
      const isContinuation = segmentIndex > 1;
      let postText = row.post_text;
      let firstComment: string | undefined = undefined;
      let launchNetMs: number | null = null;
      if (isLaunchDay) {
        const launch = launchById.get(row.launch_id);
        if (!launch) {
          await markPostSkipped(supabase, row.id, 'missing_launch', { lockId });
          skipped += 1;
          continue;
        }

        launchNetMs = launch.net ? Date.parse(launch.net) : null;
        const tz = resolveTimeZone(launch.pad_timezone);
        if (!basePostMsByLaunchId.has(launch.id)) {
          basePostMsByLaunchId.set(launch.id, resolveBaseLaunchPostMs(launch, tz));
        }
        const basePostMs = basePostMsByLaunchId.get(launch.id) ?? null;
        const retryDeadlineMs = Number.isFinite(launchNetMs)
          ? (launchNetMs as number) + clampInt(retryWindowHours, 1, 24) * 60 * 60 * 1000
          : null;
        const windowEndExclusiveMs = basePostMs != null ? basePostMs + LAUNCH_DAY_POST_TOTAL_WINDOW_MS : null;
        const sendDeadlineMs = windowEndExclusiveMs != null ? windowEndExclusiveMs + LAUNCH_DAY_POST_GRACE_MS : null;
        const absoluteDeadlineMs = Math.max(
          sendDeadlineMs != null && Number.isFinite(sendDeadlineMs) ? sendDeadlineMs : -Infinity,
          retryDeadlineMs != null && Number.isFinite(retryDeadlineMs) ? retryDeadlineMs : -Infinity
        );
        if (basePostMs == null || !Number.isFinite(basePostMs) || !Number.isFinite(absoluteDeadlineMs)) {
          await markPostSkipped(supabase, row.id, 'missing_base_post_ms', { lockId });
          skipped += 1;
          continue;
        }
        if (nowMs > absoluteDeadlineMs) {
          await markPostSkipped(supabase, row.id, 'launch_day_deadline_passed', { lockId });
          skipped += 1;
          continue;
        }

        postText = stripUrlsFromText(postText);
        postText = stripLaunchDayLinkLine(postText);
      }
      let replyToId: string | undefined;
      if (platform === 'x' && row.reply_to_social_post_id) {
        const parent = parentPostById.get(row.reply_to_social_post_id);
        if (!parent) {
          await markPostDeferred(supabase, row.id, 'missing_parent_segment', { lockId });
          deferred += 1;
          continue;
        }
        const resolvedParentId = resolveReplyToId(parent, platform);
        if (!resolvedParentId) {
          await markPostDeferred(supabase, row.id, 'parent_external_id_missing', { lockId });
          deferred += 1;
          continue;
        }
        replyToId = resolvedParentId;
      }

      let sendResult:
        | { status: 'success'; externalId: string | null; results: SocialPlatformResults }
        | { status: 'async'; requestId: string }
        | { status: 'error'; errorMessage: string }
        | null = null;

      if ((isLaunchDay || isNoLaunchDay) && launchDayImagesEnabled && !isContinuation) {
        let cacheKey: string | null = null;
        let ogImagePromise: Promise<LaunchOgImage | null> | null = null;

        if (isLaunchDay) {
          cacheKey = buildLaunchOgImageCacheKey({ launchId: row.launch_id, scheduledFor: row.scheduled_for });
          const cached = ogImageCache.get(cacheKey);
          ogImagePromise =
            cached ||
            (async () => {
              const ogImage = await fetchLaunchOgImage({
                siteUrl,
                launchId: row.launch_id,
                scheduledFor: row.scheduled_for,
                timeoutMs: launchDayImageTimeoutMs
              });
              return ogImage;
            })();
          if (!cached) ogImageCache.set(cacheKey, ogImagePromise);
        } else if (isNoLaunchDay) {
          const candidates = noLaunchDayImageCandidatesByLaunchId.get(row.launch_id) || null;
          const rocketUrl = normalizeRemoteImageUrl(candidates?.rocketImageUrl || null);
          const launchUrl = normalizeRemoteImageUrl(candidates?.launchImageUrl || null);
          const thumbUrl = normalizeRemoteImageUrl(candidates?.thumbnailUrl || null);
          const chosenUrl = rocketUrl || launchUrl || thumbUrl;
          if (chosenUrl) {
            cacheKey = `remote__${chosenUrl}`;
            const cached = ogImageCache.get(cacheKey);
            const kind = rocketUrl ? 'rocket' : 'launch';
            ogImagePromise =
              cached ||
              (async () => {
                const img = await fetchRemoteImage({
                  url: chosenUrl,
                  timeoutMs: launchDayImageTimeoutMs,
                  launchId: row.launch_id,
                  kind
                });
                return img;
              })();
            if (!cached) ogImageCache.set(cacheKey, ogImagePromise);
          }
        }

        const ogImage = ogImagePromise ? await ogImagePromise : null;
        if (ogImage) {
          sendResult = await sendUploadPostWithImage({
            apiKey,
            user: uploadPostUser,
            platform,
            facebookPageId,
            text: postText,
            image: ogImage,
            firstComment,
            replyToId
          });
        }
      }

      if (!sendResult || sendResult.status === 'error') {
        sendResult = await sendUploadPost({
          apiKey,
          user: uploadPostUser,
          platform,
          facebookPageId,
          text: postText,
          firstComment,
          replyToId
        });
      }

      if (sendResult.status === 'async') {
        await markPostAsync(supabase, row.id, sendResult.requestId, { lockId });
        continue;
      }
      if (sendResult.status === 'success') {
        await markPostSent(supabase, row.id, sendResult.externalId, sendResult.results, { lockId });
        parentPostById.set(row.id, {
          ...row,
          status: 'sent',
          external_id: sendResult.externalId,
          platform_results: sendResult.results || null
        });
        await resolveOpsAlert(supabase, 'social_posts_uploadpost_quota_exhausted');
        posted += 1;
        continue;
      }
      const errorMessage = sendResult.errorMessage || 'upload_failed';
      if (isUploadPostQuotaError(errorMessage)) {
        await upsertOpsAlert(supabase, {
          key: 'social_posts_uploadpost_quota_exhausted',
          severity: 'critical',
          message: 'UploadPost quota exhausted; social posts cannot be published.',
          details: {
            platform,
            post_type: row.post_type,
            launch_id: row.launch_id,
            social_post_id: row.id,
            scheduled_for: row.scheduled_for,
            attempts: row.attempts ?? 0,
            remaining_uploads: extractUploadPostRemainingUploads(errorMessage),
            error: errorMessage
          }
        });
      }

      await markPostFailed(supabase, row.id, errorMessage, { lockId });
      const nextAttempts = Number(row.attempts || 0) + 1;
      if (isLaunchDay) {
        const basePostMs = basePostMsByLaunchId.get(row.launch_id) ?? null;
        const nextScheduledMs =
          basePostMs != null && Number.isFinite(basePostMs)
            ? computeNextLaunchDayRetryScheduledAtMs({
                basePostMs,
                nowMs,
                nextAttempts,
                launchNetMs,
                retryWindowHours
              })
            : null;
        const baseDay = resolveLaunchDayBaseDayFromRow(row);
        await upsertOpsAlert(supabase, {
          key: buildLaunchDayFailedAlertKey({ launchId: row.launch_id, platform, baseDay }),
          severity: 'critical',
          message: `Launch-day post failed (${platform}).`,
          details: {
            platform,
            launch_id: row.launch_id,
            base_day: baseDay,
            social_post_id: row.id,
            scheduled_for: row.scheduled_for,
            attempts: nextAttempts,
            error: errorMessage,
            retry_scheduled_for: nextScheduledMs != null ? new Date(nextScheduledMs).toISOString() : null
          }
        });

        if (nextScheduledMs != null && Number.isFinite(nextScheduledMs)) {
          const { error: rescheduleError } = await supabase
            .from('social_posts')
            .update({
              status: 'pending',
              scheduled_for: new Date(nextScheduledMs).toISOString(),
              send_lock_id: null,
              send_locked_at: null
            })
            .eq('id', row.id);
          if (rescheduleError) console.warn('social_posts reschedule warning', rescheduleError.message);
        }
      }
      failed += 1;
    }
  }

  return { attempted, posted, failed, skipped, deferred };
}

async function processAsyncPosts({
  supabase,
  apiKey,
  maxPerRun
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  apiKey: string;
  maxPerRun: number;
}) {
  const { data, error } = await supabase
    .from('social_posts')
    .select('id,platform,request_id')
    .eq('status', 'async')
    .not('request_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(maxPerRun);
  if (error) throw error;

  const rows = (data || []) as Array<{ id: string; platform: string | null; request_id: string | null }>;
  let pending = 0;
  let resolved = 0;

  for (const row of rows) {
    if (!row.request_id) continue;
    const platform = (row.platform || '').trim() as SupportedPlatform;
    if (!platform || !SUPPORTED_PLATFORMS.includes(platform)) continue;
    const status = await fetchUploadStatus(apiKey, row.request_id, platform);
    if (status.status === 'in_progress') {
      pending += 1;
      continue;
    }
    if (status.status === 'completed') {
      await markPostSent(supabase, row.id, status.externalId, status.results);
      await resolveOpsAlert(supabase, 'social_posts_uploadpost_quota_exhausted');
      resolved += 1;
      continue;
    }
    if (status.status === 'failed') {
      await markPostFailed(supabase, row.id, status.errorMessage || 'upload_failed');
      resolved += 1;
    }
  }

  return { pending, resolved };
}

async function sendUploadPost({
  apiKey,
  user,
  platform,
  facebookPageId,
  text,
  firstComment,
  replyToId
}: {
  apiKey: string;
  user: string;
  platform: SupportedPlatform;
  facebookPageId?: string;
  text: string;
  firstComment?: string;
  replyToId?: string;
}): Promise<
  | { status: 'success'; externalId: string | null; results: SocialPlatformResults }
  | { status: 'async'; requestId: string }
  | { status: 'error'; errorMessage: string }
> {
  try {
    const cleanedText = stripUrlsFromText(text);
    if (!cleanedText) return { status: 'error', errorMessage: 'empty_post_text' };
    const cleanedFirstComment = firstComment ? stripUrlsFromText(firstComment) : '';

    const form = new FormData();
    form.set('user', user);
    form.set('title', cleanedText);
    form.append('platform[]', platform);
	    if (platform === 'facebook') {
	      const pageId = (facebookPageId || '').trim();
	      if (!pageId) return { status: 'error', errorMessage: 'facebook_page_id_missing' };
	      form.set('facebook_page_id', pageId);
	    }
	    if (cleanedFirstComment) form.set('first_comment', cleanedFirstComment);
	    if (replyToId && platform === 'x') form.set('reply_to_id', replyToId);

    const response = await fetch(`${UPLOAD_POST_BASE}/upload_text`, {
      method: 'POST',
      headers: { Authorization: `Apikey ${apiKey}` },
      body: form
    });

    const data = await safeReadJson(response);
    if (!response.ok) {
      return { status: 'error', errorMessage: data?.message || `upload-post ${response.status}` };
    }

    if (data?.request_id) {
      return { status: 'async', requestId: String(data.request_id) };
    }

    if (data?.success === false) {
      return { status: 'error', errorMessage: data?.message || 'upload-post error' };
    }

    const results = (data?.results as SocialPlatformResults) || null;
    const externalId = extractExternalId(results, platform);
    return { status: 'success', externalId, results };
  } catch (err) {
    return { status: 'error', errorMessage: stringifyError(err) };
  }
}

type LaunchOgImage = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  sourceUrl: string;
};

function normalizeRemoteImageUrl(value: string | null | undefined) {
  const url = String(value || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

function guessImageContentTypeFromUrl(url: string) {
  const lower = url.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.gif')) return 'image/gif';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.jpeg') || lower.includes('.jpg')) return 'image/jpeg';
  return null;
}

async function readImageBytes(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const contentLength = Number(response.headers.get('content-length') || '');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;

  const stream = response.body;
  if (!stream) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) return null;
    if (bytes.byteLength > maxBytes) return null;
    return bytes;
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  if (!total) return null;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function buildRemoteImageFilename({ launchId, kind, contentType }: { launchId: string; kind: string; contentType: string }) {
  const ext = contentType.includes('png')
    ? 'png'
    : contentType.includes('gif')
      ? 'gif'
      : contentType.includes('webp')
        ? 'webp'
        : 'jpg';
  const safeKind = kind.replace(/[^a-z0-9_-]+/gi, '').slice(0, 24) || 'image';
  return `tmn-${safeKind}-${launchId}.${ext}`;
}

async function fetchRemoteImage({
  url,
  timeoutMs,
  launchId,
  kind
}: {
  url: string;
  timeoutMs: number;
  launchId: string;
  kind: string;
}): Promise<LaunchOgImage | null> {
  const resolved = normalizeRemoteImageUrl(url);
  if (!resolved) return null;
  try {
    const response = await fetchWithTimeout(resolved, {
      timeoutMs,
      headers: {
        'User-Agent': 'Twitterbot/1.0',
        Accept: 'image/*,*/*;q=0.8'
      }
    });

    if (!response.ok) return null;
    let contentType = (response.headers.get('content-type') || '').trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      const guessed = guessImageContentTypeFromUrl(resolved);
      if (!guessed) return null;
      contentType = guessed;
    }

    const bytes = await readImageBytes(response, MAX_SOCIAL_IMAGE_BYTES);
    if (!bytes) return null;
    const filename = buildRemoteImageFilename({ launchId, kind, contentType });
    return { bytes, contentType, filename, sourceUrl: resolved };
  } catch {
    return null;
  }
}

async function sendUploadPostWithImage({
  apiKey,
  user,
  platform,
  facebookPageId,
  text,
  image,
  firstComment,
  replyToId
}: {
  apiKey: string;
  user: string;
  platform: SupportedPlatform;
  facebookPageId?: string;
  text: string;
  image: LaunchOgImage;
  firstComment?: string;
  replyToId?: string;
}): Promise<
  | { status: 'success'; externalId: string | null; results: SocialPlatformResults }
  | { status: 'async'; requestId: string }
  | { status: 'error'; errorMessage: string }
> {
  try {
    const cleanedText = stripUrlsFromText(text);
    if (!cleanedText) return { status: 'error', errorMessage: 'empty_post_text' };
    const cleanedFirstComment = firstComment ? stripUrlsFromText(firstComment) : '';

    const form = new FormData();
    form.set('user', user);
    form.set('title', cleanedText);
    form.append('platform[]', platform);
    if (platform === 'facebook') {
      const pageId = (facebookPageId || '').trim();
      if (!pageId) return { status: 'error', errorMessage: 'facebook_page_id_missing' };
      form.set('facebook_page_id', pageId);
    }
    if (cleanedFirstComment) form.set('first_comment', cleanedFirstComment);
    if (replyToId && platform === 'x') form.set('reply_to_id', replyToId);

    form.append(
      'photos[]',
      new Blob([image.bytes], { type: image.contentType || 'application/octet-stream' }),
      image.filename || 'image.jpg'
    );

    const response = await fetch(`${UPLOAD_POST_BASE}/upload_photos`, {
      method: 'POST',
      headers: { Authorization: `Apikey ${apiKey}` },
      body: form
    });

    const data = await safeReadJson(response);
    if (!response.ok) {
      return { status: 'error', errorMessage: data?.message || `upload-post ${response.status}` };
    }

    if (data?.request_id) {
      return { status: 'async', requestId: String(data.request_id) };
    }

    if (data?.success === false) {
      return { status: 'error', errorMessage: data?.message || 'upload-post error' };
    }

    const results = (data?.results as SocialPlatformResults) || null;
    const externalId = extractExternalId(results, platform);
    const augmentedResults = Array.isArray(results)
      ? results
      : results
        ? { ...results, tmn: { ogImageUrl: image.sourceUrl } }
        : { tmn: { ogImageUrl: image.sourceUrl } };
    return { status: 'success', externalId, results: augmentedResults };
  } catch (err) {
    return { status: 'error', errorMessage: stringifyError(err) };
  }
}

function buildLaunchOgImageCacheKey({ launchId, scheduledFor }: { launchId: string; scheduledFor?: string | null }) {
  return `${launchId}:${normalizeOgCacheKeyTimestamp(scheduledFor) || ''}`;
}

function normalizeOgCacheKeyTimestamp(value?: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const iso = date.toISOString();
  return iso.slice(0, 13);
}

function buildLaunchDayOgVersionSegment(scheduledFor?: string | null) {
  const bucket = normalizeOgCacheKeyTimestamp(scheduledFor);
  const parts = [LAUNCH_DAY_OG_VERSION_PREFIX, bucket].filter(Boolean);
  return encodeURIComponent(parts.join('__') || LAUNCH_DAY_OG_VERSION_PREFIX);
}

async function fetchLaunchOgImage({
  siteUrl,
  launchId,
  scheduledFor,
  timeoutMs
}: {
  siteUrl: string;
  launchId: string;
  scheduledFor?: string | null;
  timeoutMs: number;
}): Promise<LaunchOgImage | null> {
  try {
    const versionSegment = buildLaunchDayOgVersionSegment(scheduledFor);
    const url = `${siteUrl}/launches/${encodeURIComponent(launchId)}/opengraph-image/${versionSegment}/jpeg`;
    const response = await fetchWithTimeout(url, {
      timeoutMs,
      headers: {
        'User-Agent': 'Twitterbot/1.0',
        Accept: 'image/*,*/*;q=0.8'
      }
    });

    if (!response.ok) return null;
    const contentType = (response.headers.get('content-type') || '').trim().toLowerCase();
    if (!contentType.startsWith('image/')) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) return null;
    const filename = buildOgFilename({ launchId, contentType });
    return { bytes, contentType, filename, sourceUrl: url };
  } catch {
    return null;
  }
}

function buildOgFilename({ launchId, contentType }: { launchId: string; contentType: string }) {
  const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : 'jpg';
  return `tmn-og-${launchId}.${ext}`;
}

async function fetchWithTimeout(
  url: string,
  {
    timeoutMs,
    headers
  }: {
    timeoutMs: number;
    headers?: Record<string, string>;
  }
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      headers,
      redirect: 'follow',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function stripUrlsFromText(text: string) {
  return String(text || '').replace(/(?:https?:\/\/|www\.)\S+/gi, '').trim();
}

async function fetchUploadStatus(apiKey: string, requestId: string, platform: SupportedPlatform): Promise<
  | { status: 'in_progress' }
  | { status: 'completed'; results: SocialPlatformResults; externalId: string | null }
  | { status: 'failed'; errorMessage: string }
> {
  try {
    const response = await fetch(`${UPLOAD_POST_BASE}/uploadposts/status?request_id=${encodeURIComponent(requestId)}`, {
      headers: { Authorization: `Apikey ${apiKey}` }
    });
    const data = await safeReadJson(response);
    if (!response.ok) {
      return { status: 'failed', errorMessage: data?.message || `upload-post ${response.status}` };
    }
    const status = String(data?.status || '').toLowerCase();
    if (status === 'pending' || status === 'in_progress') return { status: 'in_progress' };
    if (status === 'completed') {
      const results = (data?.results as SocialPlatformResults) || null;
      const externalId = extractExternalId(results, platform);
      return { status: 'completed', results, externalId };
    }
    return { status: 'failed', errorMessage: data?.message || 'upload-post failed' };
  } catch (err) {
    return { status: 'failed', errorMessage: stringifyError(err) };
  }
}

function extractExternalId(results: SocialPlatformResults, platform: SupportedPlatform) {
  if (!results) return null;

  if (platform === 'x') {
    for (const value of extractPlatformResultFieldValues(results, platform, ['id', 'post_id', 'url'])) {
      const resolved = extractTweetId(value);
      if (resolved) return resolved;
    }
    return null;
  }

  if (platform === 'facebook') {
    for (const value of extractPlatformResultFieldValues(results, platform, ['id', 'post_id', 'url'])) {
      if (value.trim()) return value.trim();
    }
    return null;
  }

  return null;
}

async function safeReadJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function markPostSent(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  id: string,
  externalId: string | null,
  results: SocialPlatformResults,
  { lockId }: { lockId?: string } = {}
) {
  let query = supabase
    .from('social_posts')
    .update({
      status: 'sent',
      posted_at: new Date().toISOString(),
      external_id: externalId,
      platform_results: results,
      request_id: null,
      last_error: null,
      send_lock_id: null,
      send_locked_at: null
    })
    .eq('id', id);
  if (lockId) query = query.eq('send_lock_id', lockId);
  const { error } = await query;
  if (error) console.warn('social_posts sent update warning', error.message);
}

async function markPostAsync(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  id: string,
  requestId: string,
  { lockId }: { lockId?: string } = {}
) {
  let query = supabase
    .from('social_posts')
    .update({
      status: 'async',
      request_id: requestId,
      send_lock_id: null,
      send_locked_at: null
    })
    .eq('id', id);
  if (lockId) query = query.eq('send_lock_id', lockId);
  const { error } = await query;
  if (error) console.warn('social_posts async update warning', error.message);
}

async function markPostFailed(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  id: string,
  message: string,
  { lockId }: { lockId?: string } = {}
) {
  let attemptsQuery = supabase.from('social_posts').select('attempts').eq('id', id);
  if (lockId) attemptsQuery = attemptsQuery.eq('send_lock_id', lockId);
  const { data, error } = await attemptsQuery.maybeSingle();
  if (error) {
    console.warn('social_posts attempts fetch warning', error.message);
    return;
  }
  if (!data) return;

  const attempts = Number((data as any)?.attempts || 0) + 1;
  let updateQuery = supabase
    .from('social_posts')
    .update({
      status: 'failed',
      last_error: truncateError(message),
      attempts,
      send_lock_id: null,
      send_locked_at: null
    })
    .eq('id', id);
  if (lockId) updateQuery = updateQuery.eq('send_lock_id', lockId);
  const { error: updateError } = await updateQuery;
  if (updateError) console.warn('social_posts failed update warning', updateError.message);
}

async function markPostSkipped(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  id: string,
  message: string,
  { lockId }: { lockId?: string } = {}
) {
  let query = supabase
    .from('social_posts')
    .update({
      status: 'skipped',
      last_error: truncateError(message),
      send_lock_id: null,
      send_locked_at: null
    })
    .eq('id', id);
  if (lockId) query = query.eq('send_lock_id', lockId);
  const { error } = await query;
  if (error) console.warn('social_posts skipped update warning', error.message);
}

async function markPostDeferred(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  id: string,
  message: string,
  { lockId }: { lockId?: string } = {}
) {
  let query = supabase
    .from('social_posts')
    .update({
      status: 'pending',
      last_error: truncateError(message),
      send_lock_id: null,
      send_locked_at: null
    })
    .eq('id', id);
  if (lockId) query = query.eq('send_lock_id', lockId);
  const { error } = await query;
  if (error) console.warn('social_posts deferred update warning', error.message);
}

async function upsertSetting(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  key: string,
  value: string | number | boolean | Record<string, unknown> | Array<unknown> | null
) {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) console.warn('system_settings upsert warning', error.message);
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (runId == null) return;
  const { error: updateError } = await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success,
      stats: stats ?? null,
      error: error ?? null
    })
    .eq('id', runId);
  if (updateError) {
    console.warn('Failed to update ingestion_runs record', { runId, updateError: updateError.message });
  }
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function truncateError(message: string) {
  if (message.length <= 240) return message;
  return message.slice(0, 237) + '...';
}

function buildLaunchDayFailedAlertKey({
  launchId,
  platform,
  baseDay
}: {
  launchId: string;
  platform: SupportedPlatform;
  baseDay: string | null;
}) {
  const safeBaseDay = baseDay && /^\d{4}-\d{2}-\d{2}$/.test(baseDay) ? baseDay : 'unknown';
  return `social_posts_launch_day_failed__${launchId}__${platform}__${safeBaseDay}`;
}

function buildLaunchDayMissedAlertKey({ launchId, baseDay }: { launchId: string; baseDay: string }) {
  const safeBaseDay = baseDay && /^\d{4}-\d{2}-\d{2}$/.test(baseDay) ? baseDay : 'unknown';
  return `social_posts_launch_day_missed__${launchId}__${safeBaseDay}`;
}

function isUploadPostQuotaError(message: string) {
  const lower = String(message || '').toLowerCase();
  return (
    lower.includes('monthly limit') ||
    lower.includes('upload(s) remaining') ||
    lower.includes('uploads remaining') ||
    lower.includes('exceed your monthly limit')
  );
}

function extractUploadPostRemainingUploads(message: string): number | null {
  const match = /have\s+(\d+)\s+upload\(s\)\s+remaining/i.exec(String(message || ''));
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function computeNextLaunchDayRetryScheduledAtMs({
  basePostMs,
  nowMs,
  nextAttempts,
  launchNetMs,
  retryWindowHours
}: {
  basePostMs: number;
  nowMs: number;
  nextAttempts: number;
  launchNetMs: number | null;
  retryWindowHours: number;
}): number | null {
  if (!Number.isFinite(basePostMs)) return null;
  if (!Number.isFinite(nowMs)) return null;

  const lastWindowEndExclusiveMs = basePostMs + LAUNCH_DAY_POST_TOTAL_WINDOW_MS;
  const sendDeadlineMs = lastWindowEndExclusiveMs + LAUNCH_DAY_POST_GRACE_MS;
  const launchRetryDeadlineMs =
    launchNetMs != null && Number.isFinite(launchNetMs)
      ? launchNetMs + clampInt(retryWindowHours, 1, 24) * 60 * 60 * 1000
      : null;
  const absoluteDeadlineMs = minFiniteNumber(
    Number.isFinite(sendDeadlineMs) ? sendDeadlineMs : null,
    launchRetryDeadlineMs
  );
  if (absoluteDeadlineMs == null || !Number.isFinite(absoluteDeadlineMs) || nowMs > absoluteDeadlineMs) return null;

  const hour9StartMs = basePostMs + LAUNCH_DAY_POST_WINDOW_MS;
  const hour10StartMs = basePostMs + 2 * LAUNCH_DAY_POST_WINDOW_MS;

  const slot10Ms = LAUNCH_DAY_RETRY_SLOT_MINUTES[0] * 60 * 1000;
  const slot40Ms = LAUNCH_DAY_RETRY_SLOT_MINUTES[1] * 60 * 1000;

  const candidates: number[] = [];
  if (nextAttempts === 1) {
    candidates.push(hour9StartMs + slot10Ms, hour9StartMs + slot40Ms);
  } else if (nextAttempts === 2) {
    candidates.push(hour9StartMs + slot40Ms);
  } else if (nextAttempts === 3) {
    candidates.push(hour10StartMs + slot10Ms, hour10StartMs + slot40Ms);
  } else if (nextAttempts === 4) {
    candidates.push(hour10StartMs + slot40Ms);
  }

  const minMs = nowMs + 60 * 1000;
  const chosen = candidates.find((ms) => Number.isFinite(ms) && ms >= minMs && ms <= absoluteDeadlineMs);
  if (chosen != null) return chosen;
  return minMs <= absoluteDeadlineMs ? minMs : null;
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const maybeError = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    if (maybeError.message) return String(maybeError.message);
    try {
      return JSON.stringify(maybeError);
    } catch {
      return String(maybeError);
    }
  }
  return String(err);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function upsertOpsAlert(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    key,
    severity,
    message,
    details
  }: {
    key: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    details?: Record<string, unknown>;
  }
) {
  const now = new Date().toISOString();
  const { data, error: fetchError } = await supabase.from('ops_alerts').select('id, occurrences').eq('key', key).maybeSingle();
  if (fetchError) {
    console.warn('ops_alerts fetch warning', fetchError.message);
    return;
  }

  if (!data) {
    const { error } = await supabase.from('ops_alerts').insert({
      key,
      severity,
      message,
      details: details || null,
      first_seen_at: now,
      last_seen_at: now,
      occurrences: 1,
      resolved: false,
      resolved_at: null
    });
    if (error) console.warn('ops_alerts insert warning', error.message);
    return;
  }

  const { error } = await supabase
    .from('ops_alerts')
    .update({
      severity,
      message,
      details: details || null,
      last_seen_at: now,
      occurrences: Number((data as any).occurrences || 0) + 1,
      resolved: false,
      resolved_at: null
    })
    .eq('id', (data as any).id);
  if (error) console.warn('ops_alerts update warning', error.message);
}

async function resolveOpsAlert(supabase: ReturnType<typeof createSupabaseAdminClient>, key: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('ops_alerts')
    .update({ resolved: true, resolved_at: now })
    .eq('key', key)
    .eq('resolved', false);
  if (error) console.warn('ops_alerts resolve warning', error.message);
}
