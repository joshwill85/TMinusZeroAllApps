'use client';

import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
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
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersStatus, setUsersStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersMessage, setUsersMessage] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUsersStatus('loading');
    fetch('/api/admin/users', { cache: 'no-store' })
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
  }, []);

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
          prev.map((u) => {
            if (u.user_id !== userId) return u;
            const nextStatus = role === 'admin' ? 'admin' : u.is_paid ? 'paid' : 'free';
            return { ...u, role, status: nextStatus };
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
          prev.map((u) => (u.user_id === user.user_id ? { ...u, banned_until: json.banned_until ?? u.banned_until } : u))
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
          prev.map((u) => (u.user_id === user.user_id ? { ...u, banned_until: json.banned_until ?? null } : u))
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
        setUsers((prev) => prev.filter((u) => u.user_id !== user.user_id));
      },
      `Account deleted for ${label}.`
    );
  }

  function closeDetails(event: MouseEvent<HTMLButtonElement>) {
    const details = event.currentTarget.closest('details');
    if (details) details.removeAttribute('open');
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
        <h1 className="text-3xl font-semibold text-text1">Users</h1>
        <p className="text-sm text-text2">Manage accounts, roles, and suspensions.</p>
      </div>

      {usersError && (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
          {usersError}
        </div>
      )}
      {usersMessage && (
        <div className="rounded-xl border border-stroke bg-[rgba(234,240,255,0.04)] p-3 text-sm text-text2">
          {usersMessage}
        </div>
      )}

      <SectionCard
        title="Users"
        description="Name, email, last login, status, and suspension state. Use actions to manage access, reset passwords, or delete accounts."
      >
        {usersStatus === 'loading' && <div className="text-sm text-text3">Loading users...</div>}
        {usersStatus === 'error' && <div className="text-sm text-warning">{usersError}</div>}
        {usersStatus === 'ready' && (
          <div className="overflow-auto rounded-xl border border-stroke bg-surface-0">
            <table className="w-full text-left text-xs text-text2">
              <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Last login</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-text3" colSpan={5}>
                      No users found.
                    </td>
                  </tr>
                )}
                {users.map((u) => {
                  const status = resolveUserStatus(u);
                  const suspendedUntil = formatSuspendedUntil(u.banned_until);
                  const isSuspended = Boolean(suspendedUntil);
                  const isBusy = updatingUserId === u.user_id;
                  return (
                    <tr key={u.user_id} className="border-t border-stroke">
                      <td className="px-3 py-2 text-text1">{formatUserName(u)}</td>
                      <td className="px-3 py-2">{u.email || '—'}</td>
                      <td className="px-3 py-2">{formatLastLogin(u.last_sign_in_at)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${statusBadgeClass(status)}`}
                          >
                            {formatUserStatusLabel(status)}
                          </span>
                          {isSuspended && (
                            <span className="inline-flex items-center rounded-full border border-danger/40 bg-[rgba(251,113,133,0.08)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-danger">
                              Suspended
                            </span>
                          )}
                        </div>
                        {isSuspended && suspendedUntil && (
                          <div className="mt-1 text-[10px] text-text3">Until {suspendedUntil}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <details className="relative inline-block text-left">
                          <summary
                            className={`btn-secondary inline-flex list-none rounded-md px-3 py-1 text-[11px] [&::-webkit-details-marker]:hidden ${isBusy ? 'pointer-events-none opacity-60' : ''}`}
                          >
                            Actions
                          </summary>
                          <div className="absolute right-0 mt-2 w-56 rounded-lg border border-stroke bg-surface-1 p-1 text-[11px] text-text2 shadow-glow">
                            {u.role === 'admin' ? (
                              <button
                                type="button"
                                className="flex w-full items-center rounded-md px-3 py-2 text-left hover:bg-surface-0 hover:text-text1 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={isBusy}
                                onClick={(event) => {
                                  closeDetails(event);
                                  updateUserRole(u.user_id, 'user');
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
                                  updateUserRole(u.user_id, 'admin');
                                }}
                              >
                                Make admin
                              </button>
                            )}
                            <button
                              type="button"
                              className="flex w-full items-center rounded-md px-3 py-2 text-left hover:bg-surface-0 hover:text-text1 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isBusy || !u.email}
                              onClick={(event) => {
                                closeDetails(event);
                                sendPasswordReset(u);
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
                                  unsuspendUser(u);
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
                                    suspendUser(u, '168h', '7 days');
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
                                    suspendUser(u, '87600h', 'indefinite');
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
                                deleteUserAccount(u);
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
        )}
      </SectionCard>

      {usersStatus === 'ready' && (
        <div className="text-xs text-text3">
          Loaded {users.length} user{users.length === 1 ? '' : 's'}.
        </div>
      )}
    </div>
  );
}

function resolveUserStatus(user: AdminUser): 'free' | 'paid' | 'admin' {
  if (user.role === 'admin') return 'admin';
  if (user.is_paid) return 'paid';
  if (user.status === 'paid' || user.status === 'admin' || user.status === 'free') return user.status;
  return 'free';
}

function formatUserStatusLabel(status: 'free' | 'paid' | 'admin') {
  if (status === 'admin') return 'Admin';
  if (status === 'paid') return 'Paid';
  return 'Free';
}

function statusBadgeClass(status: 'free' | 'paid' | 'admin') {
  if (status === 'admin') return 'border-warning/40 text-warning bg-warning/10';
  if (status === 'paid') return 'border-success/40 text-success bg-success/10';
  return 'border-stroke text-text3 bg-[rgba(255,255,255,0.02)]';
}

function formatUserName(user: AdminUser) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || user.email || user.user_id || '—';
}

function formatLastLogin(value?: string | null) {
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
