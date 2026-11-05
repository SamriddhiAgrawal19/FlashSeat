/** Shown on guarded pages while the first session refresh is still running. */
export function SessionLoading() {
  return (
    <div role="status" aria-live="polite" className="grid min-h-[70vh] place-items-center pt-16">
      <p className="label-mono flex items-center gap-3 text-text-2">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-lime motion-safe:animate-breathe" />
        Checking your session
      </p>
    </div>
  );
}
