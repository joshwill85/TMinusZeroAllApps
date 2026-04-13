import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminRequest } from '../../_lib/auth';

export const dynamic = 'force-dynamic';

const feedbackIdSchema = z.coerce.number().int().positive();

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const gate = await requireAdminRequest({ requireServiceRole: true });
  if (!gate.ok) return gate.response;

  const parsedId = feedbackIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: 'invalid_feedback_id' }, { status: 400 });
  }

  const admin = gate.context.admin;
  if (!admin) {
    return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 501 });
  }

  const { data, error } = await admin
    .from('feedback_submissions')
    .delete()
    .eq('id', parsedId.data)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('admin feedback delete error', error);
    return NextResponse.json({ error: 'failed_to_delete' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
