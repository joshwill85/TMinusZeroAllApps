import { APP_USER_AGENT } from '@/lib/brand';

const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
const LL2_USER_AGENT = process.env.LL2_USER_AGENT || APP_USER_AGENT;
const LL2_API_KEY = process.env.LL2_API_KEY || '';

export type Ll2LaunchDetail = {
  id: string;
  name: string;
  status?: string;
  net?: string;
  window_start?: string | null;
  window_end?: string | null;
  mission?: {
    name?: string;
    description?: string;
    type?: string;
    orbit?: { name?: string; abbrev?: string };
    agencies?: Array<{ id: number; name: string; country_code?: string; type?: string }>;
    info_urls?: Array<{ url?: string; title?: string }>;
    vid_urls?: Array<{ url?: string; title?: string }>;
  };
  rocket?: {
    name?: string;
    full_name?: string;
    family?: string;
    description?: string;
    manufacturer?: { name?: string; country_code?: string; type?: string };
    reusable?: boolean;
    maiden_flight?: string | null;
    leo_capacity?: number | null;
    gto_capacity?: number | null;
    info_url?: string | null;
    wiki_url?: string | null;
  };
  launch_service_provider?: { name?: string; country?: Array<{ alpha_2_code?: string; alpha_3_code?: string }>; type?: string; description?: string };
  pad?: {
    name?: string;
    latitude?: string;
    longitude?: string;
    map_url?: string | null;
    location?: { name?: string; country?: { alpha_2_code?: string; alpha_3_code?: string }; timezone_name?: string };
  };
  crew?: Array<{ role?: string; astronaut?: { name?: string; nationality?: string } }>;
  programs?: Array<{ name?: string; description?: string }>;
};

export async function fetchLl2LaunchDetail(id: string): Promise<Ll2LaunchDetail | null> {
  try {
    const res = await fetch(`${LL2_BASE}/launches/${id}/?mode=detailed`, { headers: buildLl2Headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return data as Ll2LaunchDetail;
  } catch (err) {
    console.error('LL2 detail fetch failed', err);
    return null;
  }
}

function buildLl2Headers() {
  const headers: Record<string, string> = { 'User-Agent': LL2_USER_AGENT, accept: 'application/json' };
  if (LL2_API_KEY) {
    headers.Authorization = `Token ${LL2_API_KEY}`;
  }
  return headers;
}
