import { buildCalendarEventLinks } from '@tminuszero/domain';
import { buildLaunchHref } from '@tminuszero/navigation';
import { getPublicSiteUrl } from '@/src/config/api';

const MOBILE_BRAND_NAME = 'T-Minus Zero';

export type LaunchCalendarLaunch = {
  id: string;
  name: string;
  provider: string;
  vehicle: string;
  net: string;
  netPrecision?: 'minute' | 'hour' | 'day' | 'month' | 'tbd' | null;
  windowEnd?: string | null;
  pad: {
    name: string;
    state?: string | null;
  };
};

type BuildLaunchCalendarLinksOptions = {
  calendarToken?: string | null;
};

export function buildLaunchCalendarLinks(launch: LaunchCalendarLaunch, options: BuildLaunchCalendarLinksOptions = {}) {
  const detailUrl = `${getPublicSiteUrl()}${buildLaunchHref(launch.id)}`;
  const location = [launch.pad.name, launch.pad.state].filter(Boolean).join(', ');
  const description = [
    `Launch: ${launch.name}`,
    `Provider: ${launch.provider}`,
    `Vehicle: ${launch.vehicle}`,
    `Pad: ${launch.pad.name}`
  ].join('\n');
  const isTimed = launch.netPrecision === 'minute' || launch.netPrecision === 'hour';
  const { googleUrl, outlookUrl } = buildCalendarEventLinks({
    title: launch.name,
    location,
    description,
    detailUrl,
    startIso: launch.net,
    endIso: launch.windowEnd || launch.net,
    allDay: !isTimed,
    brandName: MOBILE_BRAND_NAME
  });
  const icsUrl = new URL(`/api/launches/${encodeURIComponent(launch.id)}/ics`, getPublicSiteUrl());
  const calendarToken = String(options.calendarToken || '').trim();
  if (calendarToken) {
    icsUrl.searchParams.set('token', calendarToken);
  }

  return {
    googleUrl,
    outlookUrl,
    detailUrl,
    icsUrl: icsUrl.toString()
  };
}
