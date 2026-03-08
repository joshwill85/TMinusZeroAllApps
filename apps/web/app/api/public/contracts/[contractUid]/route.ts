import { NextResponse } from 'next/server';
import {
  fetchCanonicalContractDetailByUid,
  normalizeCanonicalContractUid
} from '@/lib/server/contracts';

export const dynamic = 'force-dynamic';

type Params = {
  contractUid: string;
};

export async function GET(_request: Request, { params }: { params: Params }) {
  const uid = normalizeCanonicalContractUid(params.contractUid);
  if (!uid) {
    return NextResponse.json({ error: 'invalid_contract_uid' }, { status: 400 });
  }

  try {
    const payload = await fetchCanonicalContractDetailByUid(uid);
    if (!payload) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=21600, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('public contract detail api error', error);
    return NextResponse.json({ error: 'contract_detail_failed' }, { status: 500 });
  }
}
