'use client';

import clsx from 'clsx';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ToastTone = 'info' | 'success' | 'warning';

type Toast = {
  id: string;
  message: string;
  tone: ToastTone;
  durationMs: number;
  undoLabel: string;
  dismissLabel: string;
  onUndo?: () => void | Promise<void>;
};

type ToastInput = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
  undoLabel?: string;
  dismissLabel?: string;
  onUndo?: () => void | Promise<void>;
};

type ToastContextValue = {
  pushToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timersRef.current[id];
    if (timer) clearTimeout(timer);
    delete timersRef.current[id];
  }, []);

  const pushToast = useCallback(
    (input: ToastInput) => {
      const id = `toast_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const toast: Toast = {
        id,
        message: input.message,
        tone: input.tone ?? 'info',
        durationMs: input.durationMs ?? 6500,
        undoLabel: input.undoLabel ?? 'Undo',
        dismissLabel: input.dismissLabel ?? 'Dismiss',
        onUndo: input.onUndo
      };

      setToasts((prev) => [...prev, toast].slice(-3));

      if (toast.durationMs > 0) {
        timersRef.current[id] = setTimeout(() => dismissToast(id), toast.durationMs);
      }

      return id;
    },
    [dismissToast]
  );

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach((timer) => clearTimeout(timer));
      timersRef.current = {};
    };
  }, []);

  const value = useMemo(() => ({ pushToast, dismissToast }), [dismissToast, pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      className="pointer-events-none fixed bottom-[calc(var(--dock-offset,0px)+16px)] left-4 right-4 z-[90] flex flex-col items-end gap-2 sm:left-auto sm:right-4 sm:max-w-[420px]"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  const handleUndo = useCallback(async () => {
    if (!toast.onUndo) return;
    if (undoing) return;
    setUndoing(true);
    setUndoError(null);
    try {
      await toast.onUndo();
      onDismiss(toast.id);
    } catch (err) {
      console.error('toast undo failed', err);
      setUndoError('Undo failed. Try again.');
    } finally {
      setUndoing(false);
    }
  }, [onDismiss, toast, undoing]);

  const toneRing = toast.tone === 'warning' ? 'ring-warning/30' : toast.tone === 'success' ? 'ring-success/30' : 'ring-primary/20';

  return (
    <div
      className={clsx(
        'pointer-events-auto w-full overflow-hidden rounded-xl border border-stroke bg-surface-1 px-3 py-2 shadow-surface ring-1',
        toneRing
      )}
      role="status"
      aria-atomic="true"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-text1">{toast.message}</div>
          {undoError && <div className="mt-1 text-xs text-warning">{undoError}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {toast.onUndo && (
            <button
              type="button"
              className={clsx('text-xs font-semibold text-primary hover:text-primary/80', undoing && 'opacity-70')}
              onClick={handleUndo}
              disabled={undoing}
            >
              {undoing ? 'Undoing…' : toast.undoLabel}
            </button>
          )}
          <button type="button" className="text-xs text-text3 hover:text-text1" onClick={() => onDismiss(toast.id)}>
            {toast.dismissLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

