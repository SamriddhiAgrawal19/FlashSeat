import { useEffect, useRef, useState } from 'react';
import { serverNow } from '../../lib/booking/serverClock';
import { cn } from '../../lib/cn';

/** Milliseconds left until `expiresAt`, on the server's clock. */
function msLeft(expiresAt: string): number {
  return Date.parse(expiresAt) - serverNow();
}

/** Whole seconds shown. Rounded down, so a fresh 10-minute hold never reads 10:01 while the clock estimate settles. */
function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.floor(msLeft(expiresAt) / 1000));
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface CountdownProps {
  expiresAt: string;
  onExpire: () => void;
}

/**
 * Large mm:ss to the hold's expiry. It counts on the estimated server clock (lib/booking/serverClock),
 * so a wrong device clock doesn't change the deadline. Lime for the last minute.
 */
export function Countdown({ expiresAt, onExpire }: CountdownProps) {
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

  const warning = left > 0 && left <= 60;
  return (
    <div>
      <p className="label-mono text-text-2">{warning ? 'Less than a minute left' : 'Held for you'}</p>
      <p
        role="timer"
        aria-label={`${Math.floor(left / 60)} minutes ${left % 60} seconds left`}
        data-seconds-left={left}
        className={cn(
          'mt-2 font-mono text-[clamp(4rem,11vw,8.5rem)] leading-none font-medium tracking-[-0.06em] tabular-nums transition-colors duration-500',
          warning ? 'text-lime' : 'text-text',
        )}
      >
        {mmss(left)}
      </p>
      {/* Screen readers get the minute marks, not every second. */}
      <p className="sr-only" aria-live="polite">
        {left === 300 ? '5 minutes left' : left === 60 ? '1 minute left' : left === 0 ? 'Your hold has expired' : ''}
      </p>
    </div>
  );
}
