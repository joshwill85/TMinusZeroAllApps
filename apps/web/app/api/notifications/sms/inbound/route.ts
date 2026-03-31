export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildTwiml(message?: string) {
  if (!message) return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

export async function POST(request: Request) {
  void request;
  return new Response(buildTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } });
}
