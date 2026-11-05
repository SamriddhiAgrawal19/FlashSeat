import { useRef, useSyncExternalStore, type RefObject } from 'react';
import { useInView } from 'motion/react';

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * True when the user asked the OS to reduce motion. Read straight from the media
 * query (and kept live) rather than motion's useReducedMotion, which logs a dev
 * warning whenever the preference is on, even when it's handled.
 */
export function useReducedMotionPref(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** Whether an element is on screen, so looping animations can pause when it is not. */
export function useOnScreen<T extends Element>(): { ref: RefObject<T | null>; onScreen: boolean } {
  const ref = useRef<T>(null);
  const onScreen = useInView(ref, { amount: 0.05 });
  return { ref, onScreen };
}
