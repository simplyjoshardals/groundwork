"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** How long a toast stays (DESIGN 5.8), and the length of its fade-out. */
const TOAST_MS = 4000;
const LEAVE_MS = 120;

export interface ToastApi {
  /** Shows one message. A toast already on screen is replaced (one at a time). */
  show: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

interface ActiveToast {
  id: number;
  message: string;
}

/**
 * Toasts for completed actions that leave no other trace (DESIGN 5.8): never
 * for errors or anything the person must read. The region is mounted from the
 * start (`role="status"`, polite), because a live region has to exist before
 * its content changes to be announced. Auto-dismisses after 4 s; hover or
 * focus inside the toast pauses the timer.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);

  const show = useCallback((message: string) => {
    setLeaving(false);
    setPaused(false);
    setToast((prev) => ({ id: (prev?.id ?? 0) + 1, message }));
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  const toastId = toast?.id;
  useEffect(() => {
    if (toastId === undefined || paused) return;
    const leave = setTimeout(() => setLeaving(true), TOAST_MS);
    return () => clearTimeout(leave);
  }, [toastId, paused]);

  useEffect(() => {
    if (!leaving) return;
    const remove = setTimeout(() => setToast(null), LEAVE_MS);
    return () => clearTimeout(remove);
  }, [leaving]);

  return (
    <ToastContext value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {toast ? (
          <div
            key={toast.id}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            className={
              leaving
                ? "toast-leave pointer-events-auto w-full max-w-sm rounded-lg bg-toast px-4 py-3 text-sm text-toast-fg shadow-pop"
                : "toast-enter pointer-events-auto w-full max-w-sm rounded-lg bg-toast px-4 py-3 text-sm text-toast-fg shadow-pop"
            }
          >
            <p className="wrap-break-word">{toast.message}</p>
          </div>
        ) : null}
      </div>
    </ToastContext>
  );
}

const NOOP_TOAST: ToastApi = { show: () => undefined };

/**
 * Without a provider (a component rendered on its own in a test) this is a
 * no-op, with a development warning, so an isolated render still works.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  const missing = api === null;
  useEffect(() => {
    if (missing && process.env.NODE_ENV !== "production") {
      console.warn("[toast] useToast was used outside a ToastProvider.");
    }
  }, [missing]);
  return api ?? NOOP_TOAST;
}
