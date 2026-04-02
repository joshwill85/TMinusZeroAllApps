'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import SectionCard from '../_components/SectionCard';

type AdminUser = {
  user_id: string;
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role: 'user' | 'admin';
  status: string;
  is_paid: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  providers: string[];
  primary_provider: string | null;
  platforms: string[];
  last_sign_in_platform: string | null;
  last_mobile_sign_in_at: string | null;
  avatar_url: string | null;
  identity_display_name: string | null;
  email_is_private_relay: boolean;
  billing: {
    provider: 'stripe' | 'apple_app_store' | 'google_play' | null;
    status: string | null;
    provider_product_id: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    source: 'provider_entitlement' | 'legacy_subscription' | 'none';
  };
  recent_auth_events: Array<{
    provider: string;
    platform: string;
    event_type: string;
    created_at: string | null;
  }>;
};

const USERS_PER_PAGE = 25;
const providerOptions = ['', 'email_password', 'google', 'apple', 'twitter', 'unknown'];
const platformOptions = ['', 'web', 'ios', 'android'];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersStatus, setUsersStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersMessage, setUsersMessage] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    const searchParams = new URLSearchParams({
      page: String(page),
      perPage: String(USERS_PER_PAGE)
    });
    if (query.trim()) searchParams.set('q', query.trim());
    if (providerFilter) searchParams.set('provider', providerFilter);
    if (platformFilter) searchParams.set('platform', platformFilter);

    setUsersStatus('loading');
    setUsersError(null);
    fetch(`/api/admin/users?${searchParams.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || 'Failed to load users');
        }
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setUsers(Array.isArray(json.users) ? (json.users as AdminUser[]) : []);
        setHasMore(Boolean(json.hasMore));
        setUsersStatus('ready');
      })
      .catch((err) => {
        console.error('admin users fetch error', err);
        if (!cancelled) {
          setUsersStatus('error');
          setUsersError(err.message || 'Failed to load users');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [page, platformFilter, providerFilter, query]);

  async function runUserAction(
    userId: string,
    payload: Record<string, unknown>,
    onSuccess?: (json: any) => void,
    successMessage?: string
  ) {
    setUpdatingUserId(userId);
    setUsersError(null);
    setUsersMessage(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...payload })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to update user');
      }
      if (onSuccess) onSuccess(json);
      if (successMessage) setUsersMessage(successMessage);
    } catch (err: any) {
      setUsersError(err.message || 'Failed to update user');
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function updateUserRole(userId: string, role: 'user' | 'admin') {
    await runUserAction(
      userId,
      { role },
      () => {
        setUsers((prev) =>
          prev.map((user) => {
            if (user.user_id !== userId) return user;
            const nextStatus = role === 'admin' ? 'admin' : user.is_paid ? 'paid' : 'signed_in';
            return { ...user, role, status: nextStatus };
          })
        );
      },
      role === 'admin' ? 'Admin access granted.' : 'Admin access revoked.'
    );
  }

  async function sendPasswordReset(user: AdminUser) {
    if (!user.email) {
      setUsersMessage(null);
      setUsersError('User is missing an email address.');
      return;
    }
    await runUserAction(user.user_id, { action: 'reset_password' }, undefined, `Password reset email sent to ${user.email}.`);
  }

  async function suspendUser(user: AdminUser, banDuration: string, label: string) {
    await runUserAction(
      user.user_id,
      { action: 'suspend', banDuration },
      (json) => {
        setUsers((prev) =>
          prev.map((entry) => (entry.user_id === user.user_id ? { ...entry, banned_until: json.banned_until ?? entry.banned_until } : entry))
        );
      },
      `Account suspended (${label}).`
    );
  }

  async function unsuspendUser(user: AdminUser) {
    await runUserAction(
      user.user_id,
      { action: 'unsuspend' },
      (json) => {
        setUsers((prev) =>
          prev.map((entry) => (entry.user_id === user.user_id ? { ...entry, banned_until: json.banned_until ?? null } : entry))
        );
      },
      'Suspension lifted.'
    );
  }

  async function deleteUserAccount(user: AdminUser) {
    const label = user.email || user.user_id;
    const confirm = window.confirm(
      `Permanently delete ${label}? This removes their account and data from our database and cannot be undone.`
    );
    if (!confirm) return;
    const typed = window.prompt(`Type DELETE to confirm deletion for ${label}.`);
    if (!typed || typed.trim().toUpperCase() !== 'DELETE') return;
    await runUserAction(
      user.user_id,
      { action: 'delete', confirm: typed },
      () => {
        setUsers((prev) => prev.filter((entry) => entry.user_id !== user.user_id));
      },
      `Account deleted for ${label}.`
    );
  }

  function closeDetails(event: MouseEvent<HTMLButtonElement>) {
    const details = event.currentTarget.closest('details');
    if (details) details.removeAttribute('open');
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
        <h1 className="text-3xl font-semibold text-text1">Users</h1>
        <p className="text-sm text-text2">Manage accounts, roles, suspensions, and cross-platform sign-in visibility.</p>
      </div>

      {usersError ? (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">{usersError}</div>
      ) : null}
      {usersMessage ? (
        <div className="rounded-xl border border-stroke bg-[rgba(234,240,255,0.04)] p-3 text-sm text-text2">{usersMessage}</div>
      ) : null}

      <SectionCard title="Filters" description="Search by identity and narrow by auth provider or surface.">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.08em] text-text3">
            Search
            <input
              value={query}
              onChange={(event) => {
                setPage(1);
                setQuery(event.target.value);
              }}
              placeholder="Email, name, provider, user id"
              className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm normal-case tracking-normal text-text1"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.08em] text-text3">
            Provider
            <select
              value={providerFilter}
              onChange={(event) => {
                setPage(1);
                setProviderFilter(event.target.value);
              }}
              className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm normal-case tracking-normal text-text1"
            >
              {providerOptions.map((option) => (
                <option key={option || 'all'} value={option}>
                  {option ? formatProviderLabel(option) : 'All providers'}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.08em] text-text3">
            Platform
            <select
              value={platformFilter}
              onChange={(event) => {
                setPage(1);
                setPlatformFilter(event.target.value);
              }}
              className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm normal-case tracking-normal text-text1"
            >
              {platformOptions.map((option) => (
                <option key={option || 'all'} value={option}>
                  {option ? formatPlatformLabel(option) : 'All platforms'}
                </option>
              ))}
            </select>
          </label>
        </div>
      </SectionCard>

      <SectionCard
        title="Users"
        description="Name, provider mix, last sign-in, platform history, status, and suspension state."
      >
        {usersStatus === 'loading' ? <div className="text-sm text-text3">Loading users...</div> : null}
        {usersStatus === 'error' ? <div className="text-sm text-warning">{usersError}</div> : null}
        {usersStatus === 'ready' ? (
          <div className="overflow-auto rounded-xl border border-stroke bg-surface-0">
            <table className="w-full text-left text-xs text-text2">
              <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Identity</th>
                  <th className="px-3 py-2">Activity</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-text3" colSpan={5}>
                      No users found.
                    </td>
                  </tr>
                ) : null}

                {users.map((user) => {
                  const status = resolveUserStatus(user);
                  const suspendedUntil = formatSuspendedUntil(user.banned_until);
                  const isSuspended = Boolean(suspendedUntil);
                  const isBusy = updatingUserId === user.user_id;

                  return (
                    <tr key={user.user_id} className="border-t border-stroke align-top">
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-stroke bg-[rgba(255,255,255,0.03)] text-[11px] font-semibold uppercase text-text3">
                            {buildInitials(user)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-text1">{formatUserName(user)}</div>
                            <div className="mt-1 break-all text-[11px] text-text3">{user.user_id}</div>
                            {user.avatar_url ? <div className="mt-1 text-[11px] text-text3">Avatar metadata present</div> : null}
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3">
                        <div className="space-y-2">
                          <div className="break-all text-text1">{user.email || '—'}</div>
                          {user.email_is_private_relay ? (
                            <div className="text-[11px] text-warning">Apple private relay email</div>
                          ) : null}
                          <div className="flex flex-wrap gap-1">
                            {user.providers.length === 0 ? (
                              <Badge label="Unknown provider" />
                            ) : (
                              user.providers.map((provider) => <Badge key={`${user.user_id}-${provider}`} label={formatProviderLabel(provider)} />)
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3">
                        <div className="space-y-2">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Last sign-in</div>
                            <div className="text-text1">{formatLastLogin(user.last_sign_in_at)}</div>
                            <div className="text-[11px] text-text3">{user.last_sign_in_platform ? formatPlatformLabel(user.last_sign_in_platform) : 'Platform unknown'}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Last mobile sign-in</div>
                            <div className="text-text1">{formatLastLogin(user.last_mobile_sign_in_at)}</div>
                          </div>
                          {user.recent_auth_events.length > 0 ? (
                            <div className="space-y-1">
                              <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Recent auth events</div>
                              {user.recent_auth_events.map((event, index) => (
                                <div key={`${user.user_id}-${event.created_at || index}`} className="text-[11px] text-text3">
                                  {formatProviderLabel(event.provider)} on {formatPlatformLabel(event.platform)} · {formatRelativeEvent(event)}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </td>

                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${statusBadgeClass(status)}`}
                          >
                            {formatUserStatusLabel(status)}
                          </span>
                          {isSuspended ? (
                            <span className="inline-flex items-center rounded-full border border-danger/40 bg-[rgba(251,113,133,0.08)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-danger">
                              Suspended
                            </span>
                          ) : null}
                          {user.platforms.map((platform) => (
                            <Badge key={`${user.user_id}-${platform}`} label={formatPlatformLabel(platform)} />
                          ))}
                        </div>
                        <div className="mt-2 space-y-1 text-[11px] text-text3">
                          <div>{formatBillingSummary(user)}</div>
                          {user.billing.provider_product_id ? <div className="break-all">Product: {user.billing.provider_product_id}</div> : null}
                          {user.billing.current_period_end ? (
                            <div>
                              {user.billing.cancel_at_period_end ? 'Ends' : 'Renews'} {formatDateTime(user.billing.current_period_end)}
                            </div>
                          ) : null}
                          {user.billing.source === 'legacy_subscription' ? <div>Legacy Stripe fallback</div> : null}
                        </div>
                        {isSuspended && suspendedUntil ? <div className="mt-1 text-[10px] text-text3">Until {suspendedUntil}</div> : null}
                      </td>

                      <td className="px-3 py-3 text-right">
                        <details className="relative inline-block text-left">
                          <summary
                            className={`btn-secondary inline-flex list-none rounded-md px-3 py-1 text-[11px] [&::-webkit-details-marker]:hidden ${isBusy ? 'pointer-events-none opacity-60' : ''}`}
                          >
                            Actions
                          </summary>
                          <div className="absolute right-0 z-10 mt-2 w-56 rounded-lg border border-stroke bg-surface-1 p-1 text-[11px] text-text2 shadow-glow">
                            {user.role === 'admin' ? (
                              <button
                                type="button"
                                className="flex w-full items-center rounded-md px-3 py-2 text-left hover:bg-surface-0 hover:text-text1 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={isBusy}
                                onClick={(event) => {
                                  closeDetails(event);
                                  updateUserRole(user.user_id, 'user');
                                }}
                              >
                                Revoke admin
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="flex w-full items-center rounded-md px-3 py-2 text-left hover:bg-surface-0 hover:text-text1 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={isBusy}
                                onClick={(event) => {
                                  closeDetails(event);
                                  updateUserRole(user.user_id, 'admin');
                                }}
                              >
                                Make admin
                              </button>
                            )}
                            <button
                              type="button"
                              className="flex w-full items-center rounded-md px-3 py-2 text-left hover:bg-surface-0 hover:text-text1 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isBusy || !user.email}
                              onClick={(event) => {
                                closeDetails(event);
                                sendPasswordReset(user);
                              }}
                            >
                              Send password reset
                            </button>
                            <div className="my-1 h-px bg-stroke" />
                            {isSuspended ? (
                              <button
                                type="button"
                                className="flex w-full items-center rounded-md px-3 py-2 text-left hover:bg-surface-0 hover:text-text1 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={isBusy}
                                onClick={(event) => {
                                  closeDetails(event);
                                  unsuspendUser(user);
                                }}
                              >
                                Lift suspension
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="flex w-full items-center rounded-md px-3 py-2 text-left hover:bg-surface-0 hover:text-text1 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={isBusy}
                                  onClick={(event) => {
                                    closeDetails(event);
                                    suspendUser(user, '168h', '7 days');
                                  }}
                                >
                                  Suspend 7 days
                                </button>
                                <button
                                  type="button"
                                  className="flex w-full items-center rounded-md px-3 py-2 text-left hover:bg-surface-0 hover:text-text1 disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={isBusy}
                                  onClick={(event) => {
                                    closeDetails(event);
                                    suspendUser(user, '87600h', 'indefinite');
                                  }}
                                >
                                  Suspend indefinitely
                                </button>
                              </>
                            )}
                            <div className="my-1 h-px bg-stroke" />
                            <button
                              type="button"
                              className="flex w-full items-center rounded-md px-3 py-2 text-left text-danger hover:bg-[rgba(251,113,133,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isBusy}
                              onClick={(event) => {
                                closeDetails(event);
                                deleteUserAccount(user);
                              }}
                            >
                              Delete account
                            </button>
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </SectionCard>

      {usersStatus === 'ready' ? (
        <div className="flex flex-col gap-3 text-xs text-text3 md:flex-row md:items-center md:justify-between">
          <div>
            Page {page} · Loaded {users.length} user{users.length === 1 ? '' : 's'} on this page.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-stroke px-3 py-1.5 text-text2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={page <= 1 || usersStatus !== 'ready'}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded-md border border-stroke px-3 py-1.5 text-text2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!hasMore || usersStatus !== 'ready'}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
      {label}
    </span>
  );
}

function resolveUserStatus(user: AdminUser): 'signed_in' | 'paid' | 'admin' {
  if (user.role === 'admin') return 'admin';
  if (user.is_paid) return 'paid';
  if (user.status === 'paid' || user.status === 'admin') return user.status;
  return 'signed_in';
}

function formatUserStatusLabel(status: 'signed_in' | 'paid' | 'admin') {
  if (status === 'admin') return 'Admin';
  if (status === 'paid') return 'Paid';
  return 'Signed in';
}

function statusBadgeClass(status: 'signed_in' | 'paid' | 'admin') {
  if (status === 'admin') return 'border-warning/40 text-warning bg-warning/10';
  if (status === 'paid') return 'border-success/40 text-success bg-success/10';
  return 'border-stroke text-text3 bg-[rgba(255,255,255,0.02)]';
}

function formatUserName(user: AdminUser) {
  const name = user.identity_display_name || [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || user.email || user.user_id || '—';
}

function buildInitials(user: AdminUser) {
  const source = formatUserName(user);
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase() || '')
    .join('') || 'U';
}

function formatLastLogin(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatSuspendedUntil(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() <= Date.now()) return null;
  return date.toLocaleString();
}

function formatProviderLabel(value: string) {
  if (value === 'apple_app_store') return 'App Store';
  if (value === 'google_play') return 'Google Play';
  if (value === 'email' || value === 'email_password') return 'Email';
  if (value === 'twitter') return 'X';
  if (value === 'unknown') return 'Unknown';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPlatformLabel(value: string) {
  if (value === 'ios') return 'iOS';
  return value.toUpperCase();
}

function formatRelativeEvent(event: AdminUser['recent_auth_events'][number]) {
  const date = event.created_at ? new Date(event.created_at) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return event.event_type.replace(/_/g, ' ');
  }
  return `${event.event_type.replace(/_/g, ' ')} · ${date.toLocaleString()}`;
}

function formatBillingSummary(user: AdminUser) {
  if (!user.billing.provider || !user.billing.status) {
    return 'Billing: free account';
  }
  return `Billing: ${formatProviderLabel(user.billing.provider)} · ${user.billing.status.replace(/_/g, ' ')}`;
}
