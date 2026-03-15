import { NextResponse } from 'next/server';
import { buildAppleAppSiteAssociationPayload } from '@/lib/server/mobileAppLinks';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(buildAppleAppSiteAssociationPayload(), {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400'
      }
    });
  } catch (error) {
    console.error('apple app-site-association route failed', error);
    return NextResponse.json(
      { error: 'app_links_not_configured' },
      {
        status: 503,
        headers: {
          'Cache-Control': 'private, no-store'
        }
      }
    );
  }
}
