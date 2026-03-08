const fs = require('fs');
const { config } = require('dotenv');

config({ path: '.env.local' });
config();

const apiKey = process.env.SAM_GOV_API_KEY || process.env.SAM_API_KEY;
if (!apiKey) {
  console.error('Missing SAM_GOV_API_KEY');
  process.exit(1);
}

(async () => {
  const now = new Date();
  const format = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;

  for (const lookback of [365, 364, 360, 180, 30]) {
    const postedTo = new Date(now);
    const postedFrom = new Date(postedTo.getTime() - lookback * 24 * 60 * 60 * 1000);
    const u = new URL('https://api.sam.gov/opportunities/v2/search');
    u.searchParams.set('api_key', apiKey);
    u.searchParams.set('postedFrom', format(postedFrom));
    u.searchParams.set('postedTo', format(postedTo));
    u.searchParams.set('limit', '1');
    u.searchParams.set('offset', '0');

    const response = await fetch(u.toString());
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 250);
    }

    const errMessage = body && typeof body === 'object' ? body.errorMessage || body.message || body.detail || body.error || body.code || body.errorCode : body;
    console.log(
      JSON.stringify(
        {
          lookback,
          status: response.status,
          range: `${format(postedFrom)} -> ${format(postedTo)}`,
          code: body && typeof body === 'object' ? (body.code || body.errorCode || body.status || body.errorCode) : null,
          message: body && typeof body === 'object' ? (body.message || body.errorMessage || body.detail || body.description || '') : body,
          totalRecords: body && typeof body === 'object' ? body.totalRecords : null
        },
        null,
        2
      )
    );

    // polite pacing to avoid request bursts
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
})();
