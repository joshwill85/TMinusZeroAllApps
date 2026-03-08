const { config } = require('dotenv');
config({ path: '.env.local' });
config();
const apiKey = process.env.SAM_GOV_API_KEY || process.env.SAM_API_KEY;
if (!apiKey) {
  console.error('Missing SAM_GOV_API_KEY');
  process.exit(1);
}

const cases = [
  { name: 'solnum_only', solnum: '47PF0018R0023', postedFrom: null, postedTo: null },
  { name: 'solnum_and_range', solnum: '47PF0018R0023', postedFrom: '02/23/2025', postedTo: '02/23/2026' },
  { name: 'posted_only', solnum: null, postedFrom: '02/23/2025', postedTo: '02/23/2026' }
];

(async () => {
  for (const c of cases) {
    const u = new URL('https://api.sam.gov/opportunities/v2/search');
    u.searchParams.set('api_key', apiKey);
    if (c.solnum) u.searchParams.set('solnum', c.solnum);
    if (c.postedFrom) u.searchParams.set('postedFrom', c.postedFrom);
    if (c.postedTo) u.searchParams.set('postedTo', c.postedTo);
    u.searchParams.set('limit', '1');
    u.searchParams.set('offset', '0');

    const r = await fetch(u.toString());
    const text = await r.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}
    const out = {
      name: c.name,
      status: r.status,
      message: body && typeof body === 'object' ? (body.message || body.errorMessage || body.error || body.detail || '') : null,
      code: body && typeof body === 'object' ? (body.code || body.errorCode || body.error_code || null) : null,
      totalRecords: body && typeof body === 'object' ? body.totalRecords : null
    };
    console.log(JSON.stringify(out));
  }
})();
