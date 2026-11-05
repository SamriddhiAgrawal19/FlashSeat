import type { CSSProperties, ReactNode } from 'react';

/**
 * Headline lines that slide up from behind a mask, one after another, on load.
 * Pure CSS (motion-safe only): with reduced motion the lines are simply there.
 */
export function LineReveal({ lines, baseDelay = 0.15, step = 0.12 }: { lines: ReactNode[]; baseDelay?: number; step?: number }) {
  return (
    <>
      {lines.map((line, i) => {
        const style: CSSProperties = { animationDelay: `${baseDelay + i * step}s` };
        return (
          // pb/-mb keep descenders (and the serif italic) from being clipped by the mask.
          <span key={i} className="-mb-[0.12em] block overflow-hidden pb-[0.12em]">
            <span className="block motion-safe:animate-line-up" style={style}>
              {line}
            </span>
          </span>
        );
      })}
    </>
  );
}
