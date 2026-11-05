// Small fetch wrapper for the FlashSeat API. In dev every call goes through the
// Vite proxy at /api (see vite.config.ts), because the API has no CORS.
import { getAccessToken, handleSessionExpired, refreshSession } from './auth/session';

export const API_BASE = '/api';

/** Error shape every API error uses: `{ error: { message, code, details? } }` (docs/api.md). */
interface ApiErrorBody {
  error: {
    message: string;
    code: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  /** Seconds from the Retry-After header (429 RATE_LIMITED, some 409/503s), when present. */
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, code: string, message: string, details?: unknown, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function retryAfter(response: Response): number | undefined {
  const value = Number(response.headers.get('Retry-After'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { message?: unknown }).message === 'string' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type Query = Record<string, string | number | undefined>;

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return `${API_BASE}${path}${search ? `?${search}` : ''}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

/** Sends one request; also reports which access token (if any) it carried. */
async function send(path: string, options: RequestOptions): Promise<{ response: Response; token: string | null }> {
  const { method = 'GET', query, body, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // The refresh token is an HttpOnly cookie scoped to /api/auth; it must travel with auth calls.
      credentials: 'include',
      signal,
    });
    return { response, token };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.');
  }
}

/**
 * JSON request to the API. Attaches the in-memory access token. On a 401 from anything
 * other than /auth/*, it runs the shared single-flight refresh once and retries the
 * request once; if the refresh fails the session is cleared and the user is sent to log in.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const first = await send(path, options);
  let { response } = first;

  if (response.status === 401 && !path.startsWith('/auth/')) {
    // If a refresh already replaced the token this request carried (a parallel 401 got there
    // first and the refresh has finished), just retry with the new one: no second refresh.
    const current = getAccessToken();
    const refreshed = current !== null && current !== first.token ? true : await refreshSession();
    if (refreshed) {
      response = (await send(path, options)).response;
    } else {
      handleSessionExpired();
    }
  }

  const data = await readJson(response);

  if (!response.ok) {
    if (isApiErrorBody(data)) {
      throw new ApiError(response.status, data.error.code, data.error.message, data.error.details, retryAfter(response));
    }
    // No API error body: usually the dev proxy answering because the API is down.
    throw new ApiError(response.status, `HTTP_${response.status}`, response.statusText || 'Request failed', undefined, retryAfter(response));
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';

/**
 * An event row as returned by GET /events (snake_case, straight from the
 * `events` table; see docs/api.md "Events and shows"). Timestamps are ISO 8601 UTC.
 */
export interface EventRow {
  id: string;
  organizer_id: string;
  title: string;
  description: string;
  category: string;
  poster_url: string | null;
  status: EventStatus;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The earliest upcoming SCHEDULED show of an event, as returned by GET /events. */
export interface NextShow {
  id: string;
  starts_at: string;
  ends_at: string;
  venue: { id: string; name: string; city: string };
}

/**
 * A GET /events row: the event row plus upcoming-show info ("upcoming" = SCHEDULED and
 * starts_at in the future, by the database clock). See docs/api.md.
 */
export interface EventListItem extends EventRow {
  next_show: NextShow | null;
  upcoming_show_count: number;
  /** Lowest category price across the upcoming shows, in paise; null when there are none. */
  min_price_paise: number | null;
}

/** GET /events response: `{ events, page, limit, total }`. */
export interface EventsPage {
  events: EventListItem[];
  page: number;
  limit: number;
  total: number;
}

/** GET /events query parameters (all optional). */
export interface GetEventsParams {
  /** Exact category match, case-insensitive. */
  category?: string;
  /** Exact match on a show's venue city, case-insensitive. */
  city?: string;
  /** ISO datetime; shows with `starts_at >=` this. */
  dateFrom?: string;
  /** ISO datetime; shows with `ends_at <=` this. */
  dateTo?: string;
  /** Default 1. */
  page?: number;
  /** 1–50, default 20. */
  limit?: number;
}

/** Search PUBLISHED events, newest first. No auth. */
export function getEvents(params: GetEventsParams = {}, signal?: AbortSignal): Promise<EventsPage> {
  return request<EventsPage>('/events', { query: { ...params }, signal });
}

export type ShowStatus = 'SCHEDULED' | 'CANCELLED' | 'COMPLETED';

/** One entry of `shows` on GET /events/:eventId (ordered by start time). */
export interface EventShowSummary {
  id: string;
  venue_name: string;
  venue_city: string;
  starts_at: string;
  ends_at: string;
  status: ShowStatus;
}

/** GET /events/:eventId: the event row plus its shows. */
export interface EventDetail extends EventRow {
  shows: EventShowSummary[];
}

/**
 * GET /events/:eventId/shows/:showId: the full show row (src/modules/shows/shows.repository.ts
 * findShowInEvent: s.*), the venue, the event's status and the category prices (paise).
 */
export interface ShowDetail {
  id: string;
  event_id: string;
  venue_id: string;
  starts_at: string;
  ends_at: string;
  /** When ticket sales open; null means they are open as soon as the show is published. */
  sales_open_at: string | null;
  status: ShowStatus;
  created_at: string;
  updated_at: string;
  venue_name: string;
  venue_address: string;
  venue_city: string;
  event_status: EventStatus;
  category_prices: Array<{ category: string; price_paise: number }>;
}

/** A published (or cancelled) event with its shows. No auth. */
export function getEvent(eventId: string, signal?: AbortSignal): Promise<EventDetail> {
  return request<EventDetail>(`/events/${encodeURIComponent(eventId)}`, { signal });
}

/** One show of an event, with its category prices. No auth. */
export function getShow(eventId: string, showId: string, signal?: AbortSignal): Promise<ShowDetail> {
  return request<ShowDetail>(`/events/${encodeURIComponent(eventId)}/shows/${encodeURIComponent(showId)}`, { signal });
}
