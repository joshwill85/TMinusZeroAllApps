import { format, formatInTimeZone } from 'date-fns-tz';
import differenceInSeconds from 'date-fns/differenceInSeconds';
import { Launch } from './types/launch';

export function isDateOnlyNet(netIso: string, netPrecision?: Launch['netPrecision'], timeZone?: string) {
  if (!netIso) return true;

  // Explicit precision tells us to hide the countdown (only hour/minute show a countdown).
  // If we have explicit precision, trust it and skip midnight heuristics.
  if (netPrecision) {
    return netPrecision !== 'hour' && netPrecision !== 'minute';
  }

  const net = new Date(netIso);
  if (Number.isNaN(net.getTime())) return true;

  // Heuristic: many TBD launches are stored as 00:00:00; treat as date-only.
  const isMidnightUtc = net.getUTCHours() === 0 && net.getUTCMinutes() === 0 && net.getUTCSeconds() === 0;
  const isMidnightLocal = isMidnightInTimeZone(net, timeZone);
  return isMidnightUtc || isMidnightLocal;
}

export function isCountdownEligible(launch: Launch, timeZone?: string) {
  return !isDateOnlyNet(launch.net, launch.netPrecision, timeZone);
}

export function computeCountdown(netIso: string, nowInput?: number | Date) {
  const now =
    nowInput instanceof Date
      ? nowInput
      : typeof nowInput === 'number' && Number.isFinite(nowInput)
        ? new Date(nowInput)
        : new Date();
  const net = new Date(netIso);
  const diffSeconds = Math.max(0, differenceInSeconds(net, now));

  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  const label = days > 0
    ? `T-${days}d ${hours.toString().padStart(2, '0')}h`
    : `T-${hours.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m:${seconds
        .toString()
        .padStart(2, '0')}s`;

  return { label, diffSeconds };
}

export function formatNetLabel(netIso: string, timezone: string) {
  try {
    const formatted = formatInTimeZone(new Date(netIso), timezone, 'h:mm a zzz');
    return formatted;
  } catch (err) {
    return format(new Date(netIso), 'p O');
  }
}

export function formatDateOnly(netIso: string, timezone: string) {
  try {
    return formatInTimeZone(new Date(netIso), timezone, 'MMM d');
  } catch (err) {
    return format(new Date(netIso), 'MMM d');
  }
}

function isMidnightInTimeZone(date: Date, timeZone?: string) {
  if (!timeZone) {
    return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
  }
  try {
    return formatInTimeZone(date, timeZone, 'HH:mm:ss') === '00:00:00';
  } catch (err) {
    return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
  }
}
