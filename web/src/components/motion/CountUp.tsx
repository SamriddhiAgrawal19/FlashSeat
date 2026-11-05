import { useEffect, useRef, useState } from 'react';
import { useInView } from 'motion/react';
import { useReducedMotionPref } from '../../lib/motion';

const format = new Intl.NumberFormat('en-IN');

/**
 * A number that counts up from 0 the first time it scrolls into view (ease-out, rAF).
 * With reduced motion, or before JS runs, it simply shows the final value.
 */
export function CountUp({ value, duration = 1200, className }: { value: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotionPref();
  const [shown, setShown] = useState(value);

  useEffect(() => {
    // inView is `once`, so this runs a single time per mount.
    if (reduced || !inView) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    setShown(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduced, value, duration]);

  // tabular-nums keeps the width steady while the digits change (no layout shift).
  return (
    <span ref={ref} className={`tabular-nums ${className ?? ''}`}>
      {format.format(shown)}
    </span>
  );
}
