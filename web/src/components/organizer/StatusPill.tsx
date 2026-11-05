import type { EventStatus, ShowStatus } from '../../lib/api';
import { cn } from '../../lib/cn';
import { PILL_BASE } from '../booking/StatusPill';

type Status = EventStatus | ShowStatus;

const LABELS: Record<Status, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  CANCELLED: 'Cancelled',
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
};

// Same language as booking pills: lime marks the live state only, open states are warm white,
// closed ones recede.
const TONES: Record<Status, string> = {
  PUBLISHED: 'border-lime/60 text-lime',
  SCHEDULED: 'border-text/40 text-text',
  DRAFT: 'border-text/40 text-text',
  CANCELLED: 'border-rule text-text-2',
  COMPLETED: 'border-rule text-text-2',
};

export function eventStatusLabel(status: Status): string {
  return LABELS[status];
}

/** Event or show status: DRAFT / PUBLISHED / CANCELLED, SCHEDULED / COMPLETED. */
export function EventStatusPill({ status, className, compact = false }: { status: Status; className?: string; compact?: boolean }) {
  return (
    <span className={cn(PILL_BASE, TONES[status], compact && 'h-6 px-2', className)}>
      {status === 'PUBLISHED' && <span aria-hidden="true" className="size-1.5 bg-lime" />}
      {status === 'DRAFT' && <span aria-hidden="true" className="size-1.5 border border-text/60" />}
      {LABELS[status]}
    </span>
  );
}
