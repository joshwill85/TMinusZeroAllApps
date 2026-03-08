import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Launch } from '@/lib/types/launch';
import { isDateOnlyNet } from '@/lib/time';
import { BRAND_NAME, BRAND_TECHNICAL_NAME, DEFAULT_SITE_URL, ICS_UID_DOMAIN } from '@/lib/brand';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

export function buildIcs(launch: Launch, options?: { siteUrl?: string }) {
  return buildIcsCalendar([launch], options);
}

export function buildIcsCalendar(launches: Launch[], options?: { siteUrl?: string; alarmMinutesBefore?: number | null }) {
  const siteUrl = (options?.siteUrl || DEFAULT_SITE_URL).replace(/\/+$/, '');
  const rawAlarmMinutes =
    typeof options?.alarmMinutesBefore === 'number' && Number.isFinite(options.alarmMinutesBefore)
      ? Math.trunc(options.alarmMinutesBefore)
      : null;
  const alarmMinutesBefore = rawAlarmMinutes == null ? null : Math.min(10080, Math.max(0, rawAlarmMinutes));
  const dtstamp = formatUtcStamp(new Date());
  const events = launches.flatMap((launch) => buildIcsEvent(launch, dtstamp, siteUrl, alarmMinutesBefore));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${BRAND_TECHNICAL_NAME}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${BRAND_NAME} Launches`,
    'X-WR-TIMEZONE:UTC',
    ...events,
    'END:VCALENDAR'
  ];

  return lines.flatMap((line) => foldIcsLine(line)).join('\r\n') + '\r\n';
}

function buildIcsEvent(launch: Launch, dtstamp: string, siteUrl: string, alarmMinutesBefore: number | null) {
  const now = new Date();
  const net = safeDate(launch.net) ?? now;
  const windowEnd = launch.windowEnd ? safeDate(launch.windowEnd) : null;
  const uid = `${launch.id}@${ICS_UID_DOMAIN}`;

  const summary = escapeIcsText(launch.name);
  const location = escapeIcsText(`${launch.pad.name}${launch.pad.state ? `, ${launch.pad.state}` : ''}`);
  const description = escapeIcsText(
    [
      `Launch: ${launch.name}`,
      `Provider: ${launch.provider}`,
      `Vehicle: ${launch.vehicle}`,
      `Pad: ${launch.pad.name}`,
      '',
      'Launch data: The Space Devs (LL2).',
      'Not official LCC. Times and status may change.',
      '',
      `More: ${siteUrl}${buildLaunchHref(launch)}`
    ].join('\n')
  );

  const isTimed = !isDateOnlyNet(launch.net, launch.netPrecision);
  const dtstartLine = isTimed ? `DTSTART:${formatUtcStamp(net)}` : `DTSTART;VALUE=DATE:${formatUtcDate(net)}`;
  const dtendLine = isTimed
    ? `DTEND:${formatUtcStamp(windowEnd ?? net)}`
    : `DTEND;VALUE=DATE:${formatUtcDate(addDays(net, 1))}`;

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    dtstartLine,
    dtendLine,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    `URL:${siteUrl}${buildLaunchHref(launch)}`,
    ...(isTimed && alarmMinutesBefore != null
      ? [
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `DESCRIPTION:${summary}`,
          `TRIGGER:-PT${alarmMinutesBefore}M`,
          'END:VALARM'
        ]
      : []),
    'END:VEVENT'
  ];

  return lines;
}

function safeDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatUtcStamp(d: Date) {
  return formatInTimeZone(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
}

function formatUtcDate(d: Date) {
  return formatInTimeZone(d, 'UTC', 'yyyyMMdd');
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldIcsLine(line: string, maxBytes = 75) {
  if (Buffer.byteLength(line, 'utf8') <= maxBytes) return [line];

  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const char of line) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (current && currentBytes + charBytes > maxBytes) {
      parts.push(current);
      current = ` ${char}`;
      currentBytes = Buffer.byteLength(current, 'utf8');
      continue;
    }
    current += char;
    currentBytes += charBytes;
  }

  if (current) parts.push(current);
  return parts;
}
