import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface HoldStatusPanelProps {
  title: string;
  children?: ReactNode;
  /** Buttons or links. */
  action?: ReactNode;
  /** 'notice' (coral dot) for something the user can act on, 'muted' for a closed state, 'error' for failures. */
  tone?: 'notice' | 'muted' | 'error';
  role?: 'status' | 'alert';
  className?: string;
}

/** A rounded v2 message card: read-only banners, "you already hold seats", hold and payment errors. */
export function HoldStatusPanel({ title, children, action, tone = 'notice', role = 'status', className }: HoldStatusPanelProps) {
  return (
    <div role={role} className={cn('bk-panel', `is-${tone}`, className)}>
      <div className="bk-panel-body">
        <p className="bk-panel-title">
          <i aria-hidden="true" className="bk-panel-dot" />
          {title}
        </p>
        {children && <div className="bk-panel-text">{children}</div>}
      </div>
      {action && <div className="bk-panel-actions">{action}</div>}
    </div>
  );
}
