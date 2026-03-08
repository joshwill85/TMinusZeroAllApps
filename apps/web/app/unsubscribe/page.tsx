import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';

export const metadata: Metadata = {
  title: 'Unsubscribe',
  robots: {
    index: false,
    follow: false
  }
};

export const dynamic = 'force-dynamic';

type UnsubscribeStatus = 'confirm' | 'missing' | 'invalid' | 'unsubscribed' | 'failed' | 'not-configured';

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getFirstParam(value: string | string[] | undefined) {
  if (!value) return '';
  return Array.isArray(value) ? value[0] || '' : value;
}

function buildPageUrl(token: string, status: Exclude<UnsubscribeStatus, 'confirm'>) {
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  params.set('status', status);
  return `/unsubscribe?${params.toString()}`;
}

function resolveStatus(token: string, statusParam: string): UnsubscribeStatus {
  if (!token) return 'missing';
  if (!isUuid(token)) return 'invalid';
  if (!isSupabaseConfigured()) return 'not-configured';
  if (statusParam === 'unsubscribed') return 'unsubscribed';
  if (statusParam === 'failed') return 'failed';
  if (statusParam === 'invalid') return 'invalid';
  return 'confirm';
}

export default async function UnsubscribePage({
  searchParams
}: {
  searchParams?: Promise<{ token?: string | string[]; status?: string | string[] }> | { token?: string | string[]; status?: string | string[] };
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const token = getFirstParam(resolvedSearchParams?.token).trim();
  const statusParam = getFirstParam(resolvedSearchParams?.status).trim();
  const status = resolveStatus(token, statusParam);

  async function confirmUnsubscribe(formData: FormData) {
    'use server';

    const submittedToken = String(formData.get('token') || '').trim();

    if (!submittedToken) redirect(buildPageUrl('', 'missing'));
    if (!isUuid(submittedToken)) redirect(buildPageUrl(submittedToken, 'invalid'));
    if (!isSupabaseConfigured()) redirect(buildPageUrl(submittedToken, 'not-configured'));

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.rpc('unsubscribe_marketing_emails', { token_in: submittedToken });

    if (error) {
      console.error('marketing unsubscribe error', error);
      redirect(buildPageUrl(submittedToken, 'failed'));
    }

    redirect(buildPageUrl(submittedToken, data === true ? 'unsubscribed' : 'invalid'));
  }

  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-3xl flex-col justify-center gap-4 px-4 py-16">
      <p className="text-xs uppercase tracking-[0.1em] text-text3">Email</p>
      <h1 className="text-3xl font-semibold text-text1">Unsubscribe</h1>

      {status === 'confirm' && (
        <>
          <p className="text-sm text-text2">
            This will turn off optional marketing emails like product updates and occasional offers.
          </p>
          <p className="text-sm text-text3">
            Essential account emails such as password resets, billing receipts, and security notices will still be sent when needed.
          </p>
          <form action={confirmUnsubscribe} className="mt-2 rounded-2xl border border-stroke bg-surface-1 p-4">
            <input type="hidden" name="token" value={token} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className="btn rounded-lg px-4 py-2 text-sm">
                Confirm unsubscribe
              </button>
              <Link href="/" className="btn-secondary rounded-lg px-4 py-2 text-sm">
                Keep browsing
              </Link>
            </div>
          </form>
        </>
      )}

      {status === 'unsubscribed' && (
        <p className="text-sm text-text2">
          You&#39;re unsubscribed from marketing emails. You can opt back in anytime in{' '}
          <Link className="text-primary hover:underline" href="/account">
            Account settings
          </Link>
          .
        </p>
      )}
      {status === 'missing' && <p className="text-sm text-text2">Missing unsubscribe token.</p>}
      {status === 'invalid' && <p className="text-sm text-text2">This unsubscribe link is invalid or expired.</p>}
      {status === 'not-configured' && <p className="text-sm text-text2">Unsubscribe is not available right now.</p>}
      {status === 'failed' && (
        <p className="text-sm text-text2">Something went wrong while unsubscribing. Please try again later.</p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Link href="/" className="btn-secondary rounded-lg px-4 py-2 text-sm">
          Home
        </Link>
        <Link href="/account" className="btn rounded-lg px-4 py-2 text-sm">
          Account
        </Link>
      </div>
    </div>
  );
}
