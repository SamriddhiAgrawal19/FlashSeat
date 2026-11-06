import { useEffect, useRef, useState } from 'react';
import { serverNow } from '../../lib/booking/serverClock';
import { HOLD_MINUTES } from '../../lib/booking/seats';
import { cn } from '../../lib/cn';

/** Milliseconds left until `expiresAt`, on the server's clock. */
function msLeft(expiresAt: string): number {
  return Date.parse(expiresAt) - serverNow();
}

/** Whole seconds shown. Rounded down, so a fresh 10-minute hold never reads 10:01 while the clock estimate settles. */
function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.floor(msLeft(expiresAt) / 1000));
}

export function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Seconds left to `expiresAt`, counted on the estimated server clock (lib/booking/serverClock),
 * so a wrong device clock doesn't change the deadline. Calls onExpire once when it reaches zero.
 */
export function useCountdown(expiresAt: string, onExpire: () => void): number {
  const [left, setLeft] = useState(() => secondsLeft(expiresAt));
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    let fired = false;
    const tick = () => {
      setLeft(secondsLeft(expiresAt));
      if (msLeft(expiresAt) <= 0 && !fired) {
        fired = true;
        onExpireRef.current();
      }
    };
    tick();
    // Sample 4x a second so the displayed second flips on time; state only changes once a second.
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return left;
}

/** Screen readers get the minute marks, not every second. */
function Announcer({ left }: { left: number }) {
  return (
    <p className="sr-only" aria-live="polite">
      {left === 300 ? '5 minutes left' : left === 60 ? '1 minute left' : left === 0 ? 'Your hold has expired' : ''}
    </p>
  );
}

const RADIUS = 112;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // 703.7

/** The hold page's ring: drains over the hold; white, then coral for the last 60 s. */
export function CountdownRing({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
  const left = useCountdown(expiresAt, onExpire);
  const full = HOLD_MINUTES * 60;
  const fraction = Math.max(0, Math.min(1, left / full));
  const warning = left <= 60;
  return (
    <div className="bk-ring">
      <svg aria-hidden="true" width="260" height="260" viewBox="0 0 260 260">
        <circle cx="130" cy="130" r={RADIUS} fill="none" stroke="#1E1E23" strokeWidth="8" />
        <circle
          className="bk-ring-arc"
          cx="130"
          cy="130"
          r={RADIUS}
          fill="none"
          stroke={warning ? 'var(--accent)' : 'var(--text)'}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE.toFixed(1)}
          strokeDashoffset={(CIRCUMFERENCE * (1 - fraction)).toFixed(1)}
        />
      </svg>
      <div className="bk-ring-in">
        <span
          role="timer"
          aria-live="off"
          aria-label={`${Math.floor(left / 60)} minutes ${left % 60} seconds left`}
          data-seconds-left={left}
          className={cn('bk-clock', warning && 'is-warning')}
        >
          {mmss(left)}
        </span>
        <span className="bk-mono-label">{warning && left > 0 ? 'LESS THAN A MINUTE' : 'HELD FOR YOU'}</span>
      </div>
      <Announcer left={left} />
    </div>
  );
}

/** The pay page's small clock: "08:42 left to complete payment". */
export function MiniCountdown({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
  const left = useCountdown(expiresAt, onExpire);
  const warning = left <= 60;
  return (
    <span className="bk-miniclock">
      <span
        role="timer"
        aria-live="off"
        aria-label={`${Math.floor(left / 60)} minutes ${left % 60} seconds left`}
        data-seconds-left={left}
        className={cn('bk-miniclock-time', warning && 'is-warning')}
      >
        {mmss(left)}
      </span>
      left to complete payment
      <Announcer left={left} />
    </span>
  );
}
