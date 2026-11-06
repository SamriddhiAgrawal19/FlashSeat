import type { EventStatus, ShowStatus } from '../../lib/api';
import { cn } from '../../lib/cn';

type Status = EventStatus | ShowStatus;

const LABELS: Record<Status, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  CANCELLED: 'Cancelled',
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
};

// docs/organizer-dashboard-design.html: PUBLISHED green, DRAFT grey, CANCELLED coral.
const TONES: Record<Status, string> = {
  PUBLISHED: 'is-green',
  SCHEDULED: 'is-white',
  DRAFT: '',
  CANCELLED: 'is-coral',
  COMPLETED: '',
};

export function eventStatusLabel(status: Status): string {
  return LABELS[status];
}

/** Event or show status: DRAFT / PUBLISHED / CANCELLED, SCHEDULED / COMPLETED. */
export function EventStatusPill({ status, className, compact = false }: { status: Status; className?: string; compact?: boolean }) {
  return <span className={cn('og-pill', TONES[status], !compact && 'is-lg', className)}>{LABELS[status].toUpperCase()}</span>;
}

/** A free-form pill (show states: ON SALE, SALES OPEN …, ENDED, CANCELLED). */
export function Pill({ tone, children, large = false }: { tone?: 'green' | 'coral' | 'white'; children: string; large?: boolean }) {
  return <span className={cn('og-pill', tone && `is-${tone}`, large && 'is-lg')}>{children}</span>;
}
