import { NextResponse } from 'next/server';
import {
  fetchSpaceXContractDetailBySlug,
  parseSpaceXContractSlug
} from '@/lib/server/spacexProgram';

export const dynamic = 'force-dynamic';

type Params = {
  contractKey: string;
};

export async function GET(_request: Request, { params }: { params: Params }) {
  const slug = parseSpaceXContractSlug(params.contractKey);
  if (!slug) return NextResponse.json({ error: 'invalid_contract_key' }, { status: 400 });

  try {
    const payload = await fetchSpaceXContractDetailBySlug(slug);
    if (!payload) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('spacex contract detail api error', error);
    return NextResponse.json({ error: 'contract_detail_failed' }, { status: 500 });
  }
}
