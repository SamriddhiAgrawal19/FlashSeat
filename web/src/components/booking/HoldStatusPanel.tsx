import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface HoldStatusPanelProps {
  title: string;
  children?: ReactNode;
  /** Buttons or links. */
  action?: ReactNode;
  /** 'notice' (lime rule) for something the user can act on, 'muted' for a closed state, 'error' for failures. */
  tone?: 'notice' | 'muted' | 'error';
  role?: 'status' | 'alert';
  className?: string;
}

/** A hairline-ruled message block: read-only banners, "you already hold seats", hold errors. */
export function HoldStatusPanel({ title, children, action, tone = 'notice', role = 'status', className }: HoldStatusPanelProps) {
  return (
    <div
      role={role}
      className={cn(
        'flex flex-col gap-4 border-l-2 bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8',
        tone === 'notice' && 'border-lime',
        tone === 'muted' && 'border-text/30',
        tone === 'error' && 'border-danger',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[17px] font-medium text-text">{title}</p>
        {children && <div className="mt-1 text-[15px] text-text-2">{children}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-3">{action}</div>}
    </div>
  );
}
