'use client';

import { useEffect, useState } from 'react';
import SectionCard from '../_components/SectionCard';
import { formatTimestamp } from '../_lib/format';

type FeedbackRow = {
  id: number;
  created_at: string;
  user_id?: string | null;
  name?: string | null;
  email: string;
  message: string;
  page_path: string;
  source: 'launch_card' | 'launch_details';
  launch_id?: string | null;
};

export default function AdminFeedbackPage() {
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [feedbackStatus, setFeedbackStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [deletingFeedbackId, setDeletingFeedbackId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFeedbackStatus('loading');
    setFeedbackError(null);
    fetch('/api/admin/feedback?limit=200', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || 'Failed to load feedback');
        }
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setFeedback(Array.isArray(json.feedback) ? (json.feedback as FeedbackRow[]) : []);
        setFeedbackStatus('ready');
      })
      .catch((err) => {
        console.error('admin feedback fetch error', err);
        if (!cancelled) {
          setFeedbackStatus('error');
          setFeedbackError(err.message || 'Failed to load feedback');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function deleteFeedback(row: FeedbackRow) {
    const confirmed = window.confirm(
      `Delete this feedback submission from ${row.email}? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingFeedbackId(row.id);
    setFeedbackError(null);
    setFeedbackMessage(null);

    try {
      const res = await fetch(`/api/admin/feedback/${row.id}`, {
        method: 'DELETE'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to delete feedback');
      }

      setFeedback((prev) => prev.filter((entry) => entry.id !== row.id));
      setFeedbackMessage(`Deleted feedback from ${row.email}.`);
    } catch (err: unknown) {
      setFeedbackError(err instanceof Error ? err.message : 'Failed to delete feedback');
    } finally {
      setDeletingFeedbackId((current) => (current === row.id ? null : current));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <div>
        <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
        <h1 className="text-3xl font-semibold text-text1">Feedback</h1>
        <p className="text-sm text-text2">Recent submissions from the in-app feedback form.</p>
      </div>

      <SectionCard
        title="Feedback"
        description="Recent feedback submissions. Follow up via email as needed."
        actions={
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.1em] text-text3">
            {feedbackStatus === 'ready' ? `${feedback.length} recent` : 'Loading'}
          </span>
        }
      >
        {feedbackMessage && (
          <div className="mb-3 rounded-xl border border-stroke bg-[rgba(234,240,255,0.04)] p-3 text-sm text-text2">
            {feedbackMessage}
          </div>
        )}
        {feedbackStatus === 'loading' && <div className="text-sm text-text3">Loading feedback...</div>}
        {feedbackError && (
          <div className="mb-3 rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
            {feedbackError}
          </div>
        )}

        {feedbackStatus === 'ready' && (
          <div className="space-y-2">
            {feedback.length === 0 && (
              <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-text3">
                No feedback yet.
              </div>
            )}
            {feedback.map((row) => {
              const isDeleting = deletingFeedbackId === row.id;

              return (
                <div key={row.id} className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text1">
                        <a className="underline hover:text-text1" href={`mailto:${row.email}`}>
                          {row.email}
                        </a>
                      </div>
                      <div className="text-xs text-text3">
                        {row.name ? row.name : '—'} • {formatTimestamp(row.created_at)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] uppercase tracking-[0.08em] text-text3">
                      <span className="rounded-full border border-stroke px-2 py-0.5">
                        {row.source === 'launch_details' ? 'Details' : 'Card'}
                      </span>
                      {row.launch_id && (
                        <a className="underline hover:text-text1" href={`/launches/${row.launch_id}`}>
                          Launch
                        </a>
                      )}
                      <button
                        type="button"
                        className="rounded-full border border-danger/40 bg-[rgba(251,113,133,0.08)] px-3 py-1 font-semibold text-danger hover:bg-[rgba(251,113,133,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={deletingFeedbackId !== null}
                        onClick={() => {
                          deleteFeedback(row);
                        }}
                      >
                        {isDeleting ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words text-sm text-text2">
                    {row.message}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text3">
                    <span className="rounded-full border border-stroke px-2 py-0.5 font-mono">{row.page_path}</span>
                    {row.user_id && (
                      <span className="rounded-full border border-stroke px-2 py-0.5 font-mono">user:{row.user_id}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
