import { forwardRef, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

/** Form-level error above the fields. Focusable so the page can move focus to it. */
export const FormAlert = forwardRef<HTMLDivElement, { children: ReactNode }>(function FormAlert({ children }, ref) {
  return (
    <div ref={ref} role="alert" tabIndex={-1} className="mb-7 flex gap-3 border-l-2 border-danger bg-surface px-4 py-3 text-[15px] text-text focus-visible:outline-offset-2">
      {children}
    </div>
  );
});

/** Lime submit button; shows a spinner and is disabled while the request runs. */
export function SubmitButton({ busy, children, busyLabel }: { busy: boolean; children: ReactNode; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy}
      className={cn(
        'group flex h-12 w-full items-center justify-center gap-2 rounded-[2px] bg-lime px-6 text-base font-medium tracking-[-0.01em] text-bg',
        'transition-[background-color,transform] duration-200 hover:bg-lime-hover motion-safe:active:scale-[0.99] disabled:cursor-progress disabled:opacity-80',
      )}
    >
      {busy ? (
        <>
          <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Message for errors that aren't about one field. */
export function describeNetworkOrRateLimit(code: string, retryAfterSeconds?: number): string | null {
  if (code === 'RATE_LIMITED') {
    return retryAfterSeconds
      ? `Too many attempts. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`
      : 'Too many attempts. Try again in a moment.';
  }
  if (code === 'NETWORK_ERROR' || code.startsWith('HTTP_5')) return "We couldn't reach FlashSeat. Check your connection and try again.";
  return null;
}
