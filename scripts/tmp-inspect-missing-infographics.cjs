const fs = require('fs');
const path = require('path');
const { createClient } = require(path.resolve(process.cwd(), 'node_modules/@supabase/supabase-js'));

const envObj = Object.create(null);
for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx < 0) continue;
  let v = trimmed.slice(idx + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  envObj[trimmed.slice(0, idx)] = v;
}

const supabase = createClient(envObj.NEXT_PUBLIC_SUPABASE_URL || envObj.SUPABASE_URL, envObj.SUPABASE_SERVICE_ROLE_KEY);

function buildVariants(flightCode) {
  const normalized = String(flightCode || '').trim().toLowerCase().replace(/^(ns|ng)-/, '');
  if (!/^(ns|ng)-\d{1,3}$/i.test(flightCode || '')) return [];
  const missionCode = encodeURIComponent(flightCode);
  const normalizedNumber = encodeURIComponent(normalized);
  const variants = new Set([
    `/news/${missionCode}`,
    `/news/${missionCode}-mission`,
    `/news/${missionCode}-mission-updates`,
    `/news/${missionCode}-mission-announcement`,
    `/news/${missionCode}-launch-updates`,
    `/missions/${missionCode}`,
    `/missions/by/${missionCode}`
  ]);

  if (normalized) {
    variants.add(`/news/ns-${normalizedNumber}`);
    variants.add(`/news/ng-${normalizedNumber}`);
    variants.add(`/news/ns-${normalizedNumber}-mission`);
    variants.add(`/news/ng-${normalizedNumber}-mission`);
    variants.add(`/news/ns-${normalizedNumber}-mission-updates`);
    variants.add(`/news/ng-${normalizedNumber}-mission-updates`);
  }

  if (flightCode.startsWith('ns-')) {
    const p = 'new-shepard';
    variants.add(`/news/${p}-${missionCode}-mission`);
    variants.add(`/news/${p}-mission-${missionCode}`);
    variants.add(`/news/${p}-${missionCode}-mission-announcement`);
    variants.add(`/news/${p}-${missionCode}-mission-launch-updates`);
    variants.add(`/news/${p}-mission-${missionCode}-to-conduct-astronaut-rehearsal`);
    variants.add(`/news/new-shepard-ns-${normalizedNumber}-mission`);
    variants.add(`/news/new-shepard-mission-ns-${normalizedNumber}`);
    variants.add(`/news/new-shepard-mission-ns-${normalizedNumber}-launch-updates`);
    variants.add(`/news/new-shepard-mission-ns-${normalizedNumber}-mission-updates`);
  }

  if (flightCode.startsWith('ng-')) {
    const p = 'new-glenn';
    variants.add(`/news/${p}-${missionCode}-mission`);
    variants.add(`/news/${p}-mission-${missionCode}`);
    variants.add(`/news/${p}-${missionCode}-mission-announcement`);
    variants.add(`/news/${p}-mission-${missionCode}-launch-updates`);
    variants.add(`/news/new-glenn-mission-ng-${normalizedNumber}`);
    variants.add(`/news/new-glenn-mission-ng-${normalizedNumber}-launch-updates`);
  }

  return [...variants]
    .filter(Boolean)
    .map((entry) => `https://www.blueorigin.com${entry}`)
    .filter((url) => /\/news\//.test(url) || /\/missions\//.test(url));
}

async function checkHead(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 9000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': 'TMinusZero/0.1 (+https://tminusnow.app)',
        accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'manual',
      signal: ac.signal
    });
    clearTimeout(timer);
    return { status: res.status, ok: res.ok, location: res.headers.get('location') || null };
  } catch {
    clearTimeout(timer);
    return { status: 0, ok: false, location: null, error: 'network_error' };
  }
}

(async () => {
  const { data: flights } = await supabase
    .from('blue_origin_flights')
    .select('flight_code,launch_id,launch_name')
    .like('flight_code', 'ns-%')
    .order('launch_date', { ascending: false, nullsFirst: false });

  const target = new Set([
    'ns-38','ns-27','ns-26','ns-22','ns-19','ns-18','ns-12','ns-11','ns-10','ns-9','ns-8','ns-7','ns-6','ns-5','ns-4','ns-3','ns-2'
  ]);

  for (const row of flights || []) {
    if (!target.has(row.flight_code)) continue;
    const variants = buildVariants(row.flight_code);
    const results = [];
    for (const candidate of variants) {
      const res = await checkHead(candidate);
      results.push({ candidate, status: res.status, ok: res.ok, location: res.location, error: res.error || null });
      if (res.ok || res.status === 200) break;
    }
    const success = results.find((r) => r.status === 200 || r.status === 301 || r.status === 302 || r.status === 307 || r.status === 308);
    console.log('\n' + row.flight_code + ' ' + row.launch_name);
    if (success) {
      console.log('  first redirect/ok', success);
    } else {
      console.log('  first 8 results', results.slice(0, 8));
    }
  }
})();
