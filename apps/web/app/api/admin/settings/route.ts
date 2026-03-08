import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ error: 'system_settings_block_removed' }, { status: 410 });
}

export async function POST(request: Request) {
  void request;
  return NextResponse.json({ error: 'system_settings_block_removed' }, { status: 410 });
}
