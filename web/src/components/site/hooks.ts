import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** True when the OS asks for reduced motion (kept live). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(REDUCED_MOTION);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * Scroll reveal: returns a ref and a className ("lp-reveal", plus "is-in" once the element has
 * entered the viewport). It reveals once and stops observing. With reduced motion, or without
 * IntersectionObserver, it is visible from the start (the CSS also forces that).
 */
export function useReveal<T extends Element>(): { ref: RefObject<T | null>; className: string } {
  const ref = useRef<T>(null);
  const reduced = useReducedMotion();
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen || reduced || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen, reduced]);

  const shown = seen || reduced || typeof IntersectionObserver === 'undefined';
  return { ref, className: shown ? 'lp-reveal is-in' : 'lp-reveal' };
}

function useTabVisible(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
    () => document.visibilityState === 'visible',
    () => true,
  );
}

/**
 * Whether a looping animation should run: its element is (at least partly) on screen and the tab
 * is visible. Used to add "lp-paused" to the marquee and the hero seat race.
 */
export function usePlayWhenVisible<T extends Element>(): { ref: RefObject<T | null>; playing: boolean } {
  const ref = useRef<T>(null);
  const tabVisible = useTabVisible();
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setOnScreen(entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, playing: onScreen && tabVisible };
}

/**
 * Scale for content drawn at a fixed width (the hero race is 396px, because its cursor keyframes
 * use absolute pixels): min(1, available width / natural width), kept up to date on resize.
 */
export function useFitScale<T extends HTMLElement>(naturalWidth: number): { ref: RefObject<T | null>; scale: number } {
  const ref = useRef<T>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, el.clientWidth / naturalWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [naturalWidth]);

  return { ref, scale };
}
