// Small fetch wrapper for the FlashSeat API. In dev every call goes through the
// Vite proxy at /api (see vite.config.ts), because the API has no CORS.
import { getAccessToken, handleSessionExpired, refreshSession } from './auth/session';
import { observeServerDate } from './booking/serverClock';

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
  /** Extra request headers (e.g. Idempotency-Key). */
  headers?: Record<string, string>;
}

/** Sends one request; also reports which access token (if any) it carried. */
async function send(path: string, options: RequestOptions): Promise<{ response: Response; token: string | null }> {
  const { method = 'GET', query, body, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const sentAt = Date.now();
    const response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // The refresh token is an HttpOnly cookie scoped to /api/auth; it must travel with auth calls.
      credentials: 'include',
      signal,
    });
    // Every API response carries the server's Date header; it keeps the server clock estimate tight.
    observeServerDate(response.headers.get('Date'), sentAt, Date.now());
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
  /** show_seats rows of this show. */
  seats_total: number;
  /** Seats a buyer could hold now: AVAILABLE plus lapsed holds (the seat map's rule). */
  seats_available: number;
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
  venue: { name: string; city: string; address: string };
  /** show_seats rows of this show. */
  seats_total: number;
  /** Seats a buyer could hold now: AVAILABLE plus lapsed holds (the seat map's rule). */
  seats_available: number;
  starts_at: string;
  ends_at: string;
  status: ShowStatus;
}

/** GET /events/:eventId: the event row plus its shows. */
export interface EventDetail extends EventRow {
  /** The organizer's organization name; null if they have no organizer profile. */
  organization_name: string | null;
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

// ---------------------------------------------------------------------------
// Seat map and holds (camelCase, see docs/api.md "Seat map" and "Reservations")
// ---------------------------------------------------------------------------

/** A HELD seat past its held_until already reads as AVAILABLE; UNAVAILABLE is a blocked seat. */
export type SeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED' | 'UNAVAILABLE';

export interface SeatMapSeat {
  id: string;
  number: number;
  category: string;
  pricePaise: number;
  status: SeatStatus;
}

export interface SeatMapRow {
  row: string;
  seats: SeatMapSeat[];
}

export interface SeatMapSection {
  section: string;
  rows: SeatMapRow[];
}

/** GET /shows/:showId/seats. Advisory and up to 2 s stale (Redis cache); holds re-check under row locks. */
export interface SeatMap {
  show: {
    id: string;
    startsAt: string;
    endsAt: string;
    /** When ticket sales open (ISO); null = open since publishing. */
    salesOpenAt: string | null;
    status: ShowStatus;
    /** SCHEDULED + event PUBLISHED + not started + sales open, by the database clock. */
    bookable: boolean;
    venue: VenueRef;
  };
  event: EventRef;
  summary: { total: number; available: number; held: number; booked: number; unavailable: number };
  sections: SeatMapSection[];
}

/** No auth. 404 for unknown shows and DRAFT events. */
export function getSeatMap(showId: string, signal?: AbortSignal): Promise<SeatMap> {
  return request<SeatMap>(`/shows/${encodeURIComponent(showId)}/seats`, { signal });
}

/** `event` on seat map, reservation and booking responses. */
export interface EventRef {
  id: string;
  title: string;
}

export interface VenueRef {
  name: string;
  city: string;
}

/** `show` on reservation and booking responses. */
export interface ShowRef {
  id: string;
  startsAt: string;
  venue: VenueRef;
}

/** Reads EXPIRED once past expiresAt, even before the sweeper runs. */
export type ReservationStatus = 'ACTIVE' | 'EXPIRED' | 'RELEASED' | 'CONFIRMED';

export interface ReservationSeat {
  id: string;
  section: string;
  row: string;
  number: number;
  category: string;
  pricePaise: number;
}

export interface Reservation {
  id: string;
  showId: string;
  status: ReservationStatus;
  expiresAt: string;
  seats: ReservationSeat[];
  totalPricePaise: number;
  event: EventRef;
  show: ShowRef;
}

/** `details` of 409 SEATS_UNAVAILABLE. */
export interface SeatsUnavailableDetails {
  unavailableSeatIds: string[];
}

/** `details` of 409 ACTIVE_RESERVATION_EXISTS: the caller's own live hold on this show. */
export interface ActiveReservationDetails {
  reservationId: string;
}

/**
 * POST /shows/:showId/reservations. 201 new hold, 200 replay of the same Idempotency-Key.
 * Send the SAME key and seatIds on every retry of one attempt.
 */
export async function createReservation(showId: string, seatIds: string[], idempotencyKey: string, signal?: AbortSignal): Promise<Reservation> {
  const data = await request<{ reservation: Reservation }>(`/shows/${encodeURIComponent(showId)}/reservations`, {
    method: 'POST',
    body: { seatIds },
    headers: { 'Idempotency-Key': idempotencyKey },
    signal,
  });
  return data.reservation;
}

/** Owner only; 404 otherwise. */
export async function getReservation(reservationId: string, signal?: AbortSignal): Promise<Reservation> {
  const data = await request<{ reservation: Reservation }>(`/reservations/${encodeURIComponent(reservationId)}`, { signal });
  return data.reservation;
}

/** 204, also when already RELEASED or EXPIRED. 409 CANNOT_RELEASE_CONFIRMED. */
export async function releaseReservation(reservationId: string): Promise<void> {
  await request<null>(`/reservations/${encodeURIComponent(reservationId)}`, { method: 'DELETE' });
}

/** Narrowing helpers for error `details` (typed as unknown on ApiError). */
export function seatsUnavailableIds(error: ApiError): string[] {
  const details = error.details as Partial<SeatsUnavailableDetails> | undefined;
  return Array.isArray(details?.unavailableSeatIds) ? details.unavailableSeatIds.filter((id): id is string => typeof id === 'string') : [];
}

export function activeReservationId(error: ApiError): string | null {
  const details = error.details as Partial<ActiveReservationDetails> | undefined;
  return typeof details?.reservationId === 'string' ? details.reservationId : null;
}

// ---------------------------------------------------------------------------
// Bookings (docs/api.md "Bookings")
// ---------------------------------------------------------------------------

/**
 * PENDING_PAYMENT reads as EXPIRED once its hold is dead. REFUND_PENDING follows a cancelled
 * event or a Razorpay payment that arrived after the hold ended; REFUNDED once the refund is paid out
 * (Razorpay only). PAYMENT_FAILED exists in the schema but nothing sets it.
 */
export type BookingStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'PAYMENT_FAILED' | 'REFUND_PENDING' | 'REFUNDED';

export interface BookingSeat extends ReservationSeat {
  /** Only on CONFIRMED bookings. */
  ticketCode?: string;
}

export interface Booking {
  id: string;
  reservationId: string;
  status: BookingStatus;
  totalPaise: number;
  createdAt: string;
  confirmedAt: string | null;
  /** The hold's expiresAt; only while PENDING_PAYMENT. */
  payBefore?: string;
  event: EventRef;
  show: ShowRef;
  seats: BookingSeat[];
  /** Latest provider payment; null for mock-paid or never-paid bookings. */
  payment?: BookingPayment | null;
  /** Latest refund; null when there is none (mock-paid bookings of a cancelled event too). */
  refund?: BookingRefund | null;
}

export interface BookingPayment {
  provider: 'razorpay';
  status: 'CREATED' | 'CAPTURED' | 'FAILED';
}

export type RefundReason = 'EVENT_CANCELLED' | 'HOLD_EXPIRED';

export interface BookingRefund {
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  reason: RefundReason;
}

export interface BookingsPage {
  bookings: Booking[];
  page: number;
  limit: number;
  total: number;
}

/** 201 new PENDING_PAYMENT booking, 200 replay (one booking per reservation). Admission-gated. */
export async function checkoutReservation(reservationId: string, signal?: AbortSignal): Promise<Booking> {
  const data = await request<{ booking: Booking }>(`/reservations/${encodeURIComponent(reservationId)}/checkout`, { method: 'POST', signal });
  return data.booking;
}

/** Mock payment (ENABLE_MOCK_PAYMENT). 200 for the first call and for replays. 404 "Endpoint not available" when disabled. */
export async function confirmMockPayment(bookingId: string, signal?: AbortSignal): Promise<Booking> {
  const data = await request<{ booking: Booking }>(`/bookings/${encodeURIComponent(bookingId)}/confirm-mock`, { method: 'POST', signal });
  return data.booking;
}

/** Owner only; 404 otherwise. */
export async function getBooking(bookingId: string, signal?: AbortSignal): Promise<Booking> {
  const data = await request<{ booking: Booking }>(`/bookings/${encodeURIComponent(bookingId)}`, { signal });
  return data.booking;
}

/** POST /bookings/:id/payments: the public Razorpay order (201 new, 200 the open one). */
export interface PaymentOrder {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  bookingId: string;
}

/**
 * Creates (or returns the open) Razorpay order. 404 "Endpoint not available" when the API runs
 * the mock provider; 409 HOLD_TOO_SHORT under 2 minutes of hold. The amount comes from the server.
 */
export function createPaymentOrder(bookingId: string, signal?: AbortSignal): Promise<PaymentOrder> {
  return request<PaymentOrder>(`/bookings/${encodeURIComponent(bookingId)}/payments`, { method: 'POST', signal });
}

export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/** Razorpay Checkout success callback -> CONFIRMED booking. Idempotent. */
export async function verifyRazorpayPayment(body: RazorpaySuccess, signal?: AbortSignal): Promise<Booking> {
  const data = await request<{ booking: Booking }>('/payments/razorpay/verify', { method: 'POST', body, signal });
  return data.booking;
}

/** Newest first. `limit` 1–50. */
export function getMyBookings(page: number, limit: number, signal?: AbortSignal): Promise<BookingsPage> {
  return request<BookingsPage>('/bookings/mine', { query: { page, limit }, signal });
}

// ---------------------------------------------------------------------------
// Organizer: venues, seat layouts, events and shows (ORGANIZER role; docs/api.md)
// Rows are snake_case (database rows); request bodies are camelCase.
// ---------------------------------------------------------------------------

/** Server limits (src/config/env.ts defaults, src/modules/venues/venues.schema.ts). */
export const MAX_SEATS_PER_BULK_CALL = 2000;
export const MAX_SEATS_PER_VENUE = 20_000;
export const MAX_SEATS_PER_ROW = 500;
export const ROW_LABEL_PATTERN = /^[A-Z0-9]{1,4}$/;
/** Section and category tags: trimmed, 1–30 characters, stored uppercase. */
export const SEAT_TAG_MAX = 30;

export interface VenueRow {
  id: string;
  owner_id: string;
  name: string;
  address: string;
  city: string;
  created_at: string;
}

/** A GET /venues/mine row: the venue plus its seat count and sorted distinct seat categories. */
export interface MyVenue extends VenueRow {
  seat_count: number;
  categories: string[];
}

export interface VenueLayoutRow {
  row: string;
  seats: Array<{ number: number; category: string }>;
}

/** GET /venues/:venueId/seats (owner only). */
export interface VenueLayout {
  venue_id: string;
  seat_count: number;
  categories: string[];
  sections: Array<{ section: string; rows: VenueLayoutRow[] }>;
}

export type BulkSeatsBody =
  | { mode: 'GRID'; rows: string[]; seatsPerRow: number; section?: string; category?: string }
  | { mode: 'GENERAL_ADMISSION'; count: number; section?: string; category?: string };

/** `details` of 409 VENUE_SEAT_LIMIT. */
export interface VenueSeatLimitDetails {
  existing: number;
  requested: number;
  max: number;
}

export function getMyVenues(signal?: AbortSignal): Promise<MyVenue[]> {
  return request<MyVenue[]>('/venues/mine', { signal });
}

export function createVenue(body: { name: string; address: string; city: string }): Promise<VenueRow> {
  return request<VenueRow>('/venues', { method: 'POST', body });
}

export function getVenueLayout(venueId: string, signal?: AbortSignal): Promise<VenueLayout> {
  return request<VenueLayout>(`/venues/${encodeURIComponent(venueId)}/seats`, { signal });
}

/** 201. 409 SEATS_ALREADY_EXIST (nothing inserted) or VENUE_SEAT_LIMIT. */
export async function bulkCreateSeats(venueId: string, body: BulkSeatsBody): Promise<void> {
  await request<{ success: boolean }>(`/venues/${encodeURIComponent(venueId)}/seats/bulk`, { method: 'POST', body });
}

/** A show on GET /events/mine (any status), with seat counts. */
export interface OrganizerShow {
  id: string;
  venue_id: string;
  venue_name: string;
  venue_city: string;
  starts_at: string;
  ends_at: string;
  sales_open_at: string | null;
  status: ShowStatus;
  seats_total: number;
  /** BOOKED seats, including those of REFUND_PENDING bookings. */
  seats_booked: number;
}

/** A GET /events/mine row: the event row plus all of its shows, by start time. */
export interface OrganizerEvent extends EventRow {
  shows: OrganizerShow[];
}

export interface EventInput {
  title: string;
  category: string;
  description?: string;
  posterUrl?: string;
}

export interface CreateShowBody {
  venueId: string;
  startsAt: string;
  endsAt: string;
  salesOpenAt?: string;
  categoryPrices: Array<{ category: string; pricePaise: number }>;
}

/** The show row plus the number of seats generated. */
export interface CreatedShow {
  id: string;
  event_id: string;
  venue_id: string;
  starts_at: string;
  ends_at: string;
  sales_open_at: string | null;
  status: ShowStatus;
  seatCount: number;
}

export function getMyEvents(signal?: AbortSignal): Promise<OrganizerEvent[]> {
  return request<OrganizerEvent[]>('/events/mine', { signal });
}

/** 201, status DRAFT. */
export function createEvent(body: EventInput): Promise<EventRow> {
  return request<EventRow>('/events', { method: 'POST', body });
}

/** 409 EVENT_CANCELLED. */
export function updateEvent(eventId: string, body: Partial<EventInput>): Promise<EventRow> {
  return request<EventRow>(`/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body });
}

/** 409 EVENT_NOT_DRAFT, or 409 CONFLICT with zero shows. */
export async function publishEvent(eventId: string): Promise<void> {
  await request<{ success: boolean }>(`/events/${encodeURIComponent(eventId)}/publish`, { method: 'POST' });
}

/** Idempotent: cancelling a cancelled event is a 200 that changes nothing. */
export async function cancelEvent(eventId: string): Promise<void> {
  await request<{ success: boolean }>(`/events/${encodeURIComponent(eventId)}/cancel`, { method: 'POST' });
}

/** 409 CONFLICT (venue overlap) or EVENT_CANCELLED; 400 for missing/unknown price categories. */
export function createShow(eventId: string, body: CreateShowBody): Promise<CreatedShow> {
  return request<CreatedShow>(`/events/${encodeURIComponent(eventId)}/shows`, { method: 'POST', body });
}
