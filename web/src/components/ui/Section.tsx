import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Small uppercase mono label. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('label-mono text-text-2', className)}>{children}</p>;
}

/** Editorial section number + name, with a hairline running to the edge: "01 — FEATURED ─────". */
export function SectionLabel({ index, children, className }: { index: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-4', className)}>
      <p className="label-mono shrink-0 text-text-2">
        <span className="text-lime">{index}</span> — {children}
      </p>
      <span aria-hidden="true" className="h-px flex-1 bg-rule" />
    </div>
  );
}

/** The one serif italic word or phrase in a heading. Lime by default. */
export function Accent({ children, lime = true }: { children: ReactNode; lime?: boolean }) {
  return <span className={cn('serif-accent', lime && 'text-lime')}>{children}</span>;
}
