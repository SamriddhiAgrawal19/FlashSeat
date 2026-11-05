// One Idempotency-Key per "Hold seats" click, plus the in-flight request kept in sessionStorage
// so a reload during the request can resend it with the same key (the server replays it).

const STORAGE_KEY = 'fs:pending-hold';
/** A pending request older than a hold is worth nothing: any hold it made has expired. */
const MAX_AGE_MS = 10 * 60_000;

export interface PendingHold {
  key: string;
  showId: string;
  seatIds: string[];
  createdAt: number;
}

/** A fresh key for one click. Retries of that click reuse it; a new click gets a new one. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function savePendingHold(pending: PendingHold): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Storage blocked (private mode, quota): the request still goes out, it just can't be resumed.
  }
}

function isPendingHold(value: unknown): value is PendingHold {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === 'string' &&
    typeof v.showId === 'string' &&
    typeof v.createdAt === 'number' &&
    Array.isArray(v.seatIds) &&
    v.seatIds.every((id) => typeof id === 'string')
  );
}

/** The interrupted request for this show, if any (and recent enough to matter). */
export function readPendingHold(showId: string, now = Date.now()): PendingHold | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isPendingHold(value)) return null;
    if (value.showId !== showId) return null;
    if (now - value.createdAt > MAX_AGE_MS) {
      clearPendingHold();
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function clearPendingHold(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
