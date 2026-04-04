import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../_lib/auth';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireAdminRequest();
  if (!gate.ok) return gate.response;
  return NextResponse.json({ error: 'system_settings_block_removed' }, { status: 410 });
}

export async function POST(request: Request) {
  void request;
  const gate = await requireAdminRequest();
  if (!gate.ok) return gate.response;
  return NextResponse.json({ error: 'system_settings_block_removed' }, { status: 410 });
}
