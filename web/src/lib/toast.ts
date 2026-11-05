// A tiny app-wide toast queue. Toasts survive navigation (e.g. "Seats released." shown on the
// seat map after leaving the hold page). Rendered by <Toaster /> in the layout.
import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  message: string;
}

const DURATION_MS = 4500;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Show a short message. The same message twice in a row replaces the first (no stacking repeats). */
export function showToast(message: string): void {
  const id = nextId++;
  toasts = [...toasts.filter((t) => t.message !== message), { id, message }].slice(-3);
  emit();
  setTimeout(() => dismissToast(id), DURATION_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts);
}
