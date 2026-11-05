import { dismissToast, useToasts } from '../../lib/toast';

/** Short status messages under the navbar ("C5 was just taken."). Announced politely. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex max-w-[34rem] items-center gap-4 border border-rule bg-surface py-3 pr-3 pl-4 text-[15px] text-text shadow-[0_12px_40px_rgb(0_0_0/0.5)] motion-safe:animate-rise"
        >
          <span aria-hidden="true" className="size-1.5 shrink-0 bg-lime" />
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="label-mono shrink-0 px-2 py-1 text-text-2 hover:text-text"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
