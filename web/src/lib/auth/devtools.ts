// Development-only hooks for checking the session from the browser console or a test driver.
// Loaded from main.tsx behind import.meta.env.DEV, so production bundles never include it.
import { request } from '../api';
import { dropAccessTokenForTesting } from './session';

declare global {
  interface Window {
    __flashseatAuth?: {
      /** Forget the in-memory access token (the refresh cookie is untouched). */
      dropAccessToken: () => void;
      /** GET an API path through the normal client (bearer token, 401 -> refresh -> retry). */
      get: (path: string) => Promise<unknown>;
    };
  }
}

export function installAuthDevtools() {
  window.__flashseatAuth = {
    dropAccessToken: dropAccessTokenForTesting,
    get: (path) => request(path),
  };
}
