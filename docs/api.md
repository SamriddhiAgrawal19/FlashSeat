# API reference

Base URL in the Docker stack: `http://localhost:3000`. Every route here comes from
`src/modules/*/*.routes.ts` and `src/app.ts`.

## Conventions

- **Auth.** Protected routes need `Authorization: Bearer <accessToken>`. Access tokens are
  HS256 JWTs carrying `{ userId, role }` and live for `JWT_ACCESS_EXPIRY` (15 minutes in the
  templates). The refresh token is an `httpOnly`, `SameSite=Strict` cookie named
  `refreshToken`, scoped to `path=/auth`, and `Secure` when `NODE_ENV=production`.
- **Roles.** `ORGANIZER` routes return 403 `FORBIDDEN` for other roles. "user" below means
  any authenticated role.
- **Not yours = 404.** Another user's venue, event, reservation or booking returns 404,
  never 403, so ids cannot be probed.
- **Ids.** Path ids must be uuids (otherwise 400 `VALIDATION_ERROR`); they are
  case-insensitive.
- **Money** is in paise (integers). **Timestamps** are ISO 8601 UTC.
- **Errors** always have this shape:

  ```json
  { "error": { "message": "Selected seats are no longer available", "code": "SEATS_UNAVAILABLE", "details": { "unavailableSeatIds": ["..."] } } }
  ```

  `details` appears only on some errors (Zod issues, `unavailableSeatIds`, a `status`).

> **Known inconsistency: field casing is mixed.** Requests use `organization_name` on
> register but camelCase elsewhere (`posterUrl`, `seatIds`, `startsAt`). Responses that
> return database rows (users, venues, events, shows) are snake_case (`owner_id`,
> `starts_at`), while reservation, booking and seat-map objects are camelCase (`expiresAt`,
> `totalPaise`). It is left as is to avoid breaking clients; see
> [todo.md](todo.md#mixed-field-casing-in-requests-and-responses).

Errors any endpoint can return:

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | body, query, path or header failed validation (`details` lists Zod issues) |
| 401 | `UNAUTHORIZED` | missing or non-Bearer `Authorization` header |
| 401 | `INVALID_TOKEN` / `TOKEN_EXPIRED` | bad signature, wrong algorithm, invalid payload / expired token |
| 403 | `FORBIDDEN` | wrong role |
| 409 | `LOCK_TIMEOUT` | waited more than `DB_LOCK_TIMEOUT_MS` for a row lock (`Retry-After: 1`) |
| 409 | `RETRYABLE_CONFLICT` | deadlock or serialization failure (`Retry-After: 1`) |
| 409 | `CONFLICT` | unmapped unique, exclusion or FK violation |
| 503 | `DB_UNAVAILABLE` | no pool connection within 5 s, or Postgres unreachable (`Retry-After: 1`) |
| 503 | `DB_TIMEOUT` | statement exceeded `DB_STATEMENT_TIMEOUT_MS` (`Retry-After: 1`) |
| 500 | `INTERNAL` | anything unmapped |

Rate-limited routes can also return **429 `RATE_LIMITED`** with `Retry-After: <seconds>`.
Admission-gated routes (hold, checkout, confirm-mock) can return **503 `SERVICE_BUSY`** with
`Retry-After: 1`.

## Auth

### `POST /auth/register`

No auth. Rate limit: `RATE_LIMIT_REGISTER_IP_LIMIT` per IP per 60 s (default 30).

Body: `name` (non-empty), `email`, `password` (at least 8 characters), `role` (`ATTENDEE`
default, or `ORGANIZER`), and `organization_name` (required when `role` is `ORGANIZER`).

**201** `{ "user": { id, name, email, role, is_active, created_at, updated_at }, "accessToken" }`,
plus a `Set-Cookie: refreshToken=...`.

Errors: 400; 409 `EMAIL_TAKEN` (case-insensitive, also for concurrent same-email
registrations); 429.

### `POST /auth/login`

No auth. Rate limits: `RATE_LIMIT_LOGIN_IP_LIMIT` (10) per IP and
`RATE_LIMIT_LOGIN_EMAIL_LIMIT` (5) per email, each per 60 s; both must pass.

Body: `{ email, password }`. **200** `{ "accessToken" }` plus a new refresh cookie.

Errors: 401 `INVALID_CREDENTIALS`. Wrong password, unknown email and deactivated user all get
the same error and the same argon2 cost: an unknown email is verified against a dummy hash, so
response time doesn't reveal which emails exist. 429.

### `POST /auth/refresh`

Refresh cookie. Rotates the token: the presented one is revoked and a new pair is issued, in
one transaction with the token row locked `FOR UPDATE`.

**200** `{ "accessToken" }` plus a new refresh cookie.

Errors: 401 `UNAUTHORIZED` (no cookie); 401 `INVALID_REFRESH_TOKEN` (unknown, expired,
revoked, or user inactive). Presenting a **revoked** token is treated as theft: all of that
user's refresh tokens are revoked, and the revocation commits before the 401 is sent. Every
401 clears the cookie. Ten parallel refreshes with one cookie give exactly one 200
(`tests/auth.test.ts` H-4).

### `POST /auth/logout`

Refresh cookie (optional). Revokes it if present and clears the cookie. **200**
`{ "success": true }`.

## Venues

All venue routes require `ORGANIZER`.

### `POST /venues`

Body `{ name, address, city }` (all non-empty). **201** with the venue row
`{ id, owner_id, name, address, city, created_at }`.

### `POST /venues/:venueId/seats/bulk`

Owner only (otherwise 404). Body is one of:

- `{ "mode": "GRID", "rows": ["A","B"], "seatsPerRow": 10, "section": "MAIN", "category": "REGULAR" }`
  - `rows`: 1–4 letters or digits each, unique case-insensitively.
  - `seatsPerRow`: 1–500, and `rows.length x seatsPerRow` at most `MAX_SEATS_PER_BULK_CALL` (2000).
- `{ "mode": "GENERAL_ADMISSION", "count": 100, "section": "MAIN", "category": "REGULAR" }`
  - Row is `G`, seats 1..count, with `count` at most 2000.

`section` and `category` are optional (defaults `MAIN` and `REGULAR`), trimmed, 1–30
characters, and stored uppercase. Row labels are stored uppercase too.

**201** `{ "success": true, "message": "Seats generated successfully" }`.

Errors: 400; 404; 409 `SEATS_ALREADY_EXIST` (any seat already exists, nothing inserted); 409
`VENUE_SEAT_LIMIT` (would exceed `MAX_SEATS_PER_VENUE`, 20,000; `details` has `existing`,
`requested`, `max`).

### `GET /venues/mine`

**200** array of the organizer's venues, newest first, each with `seat_count`.

## Events and shows

### `GET /events`

No auth. Lists PUBLISHED events, newest first. Query: `category` (exact), `city` (exact, a
show's venue city), `dateFrom` (ISO datetime; show `starts_at >=`), `dateTo` (show
`ends_at <=`), `page` (default 1), `limit` (1–50, default 20).

**200** `{ "events": [event rows], "page", "limit", "total" }`.

### `GET /events/mine`

`ORGANIZER`. **200** array of the organizer's events in every status, newest first.

### `POST /events`

`ORGANIZER`. Body `{ title, category, description?, posterUrl? }`; `posterUrl` must be a URL.
**201** with the event row, `status: "DRAFT"`.

### `GET /events/:eventId`

No auth. **200** the event row plus `shows: [{ id, venue_name, venue_city, starts_at,
ends_at, status }]`, ordered by start time. 404 for unknown or DRAFT events; CANCELLED
events stay readable.

### `PATCH /events/:eventId`

`ORGANIZER`, owner. Body: any of `title`, `description`, `category`, `posterUrl`. **200** with
the updated row. Errors: 404; 409 `EVENT_CANCELLED`.

### `POST /events/:eventId/publish`

`ORGANIZER`, owner. DRAFT to PUBLISHED. **200**
`{ "success": true, "message": "Event published successfully" }`.

Errors: 404; 409 `EVENT_NOT_DRAFT` (already published or cancelled); 409 `CONFLICT` "Cannot
publish an event with zero shows".

### `POST /events/:eventId/cancel`

`ORGANIZER`, owner. Cancels the event and all its shows, releases ACTIVE holds, cancels
PENDING_PAYMENT bookings and marks CONFIRMED bookings `REFUND_PENDING`, all in one transaction
([booking-flow.md](booking-flow.md#cancel-event-post-eventseventidcancel)). **200**
`{ "success": true, "message": "Event cancelled successfully" }`. Cancelling again returns
200 and changes nothing. Errors: 404.

### `POST /events/:eventId/shows`

`ORGANIZER`, owner of both the event and the venue. Body:

```json
{ "venueId": "uuid", "startsAt": "2027-03-01T13:30:00Z", "endsAt": "2027-03-01T16:00:00Z",
  "salesOpenAt": "optional ISO datetime",
  "categoryPrices": [{ "category": "REGULAR", "pricePaise": 25000 }] }
```

`endsAt` must be after `startsAt`. `categoryPrices` must have no duplicate categories and
must cover exactly the venue's seat categories. Creates the show, its prices, and one
`show_seats` row per venue seat. **201** with the show row plus `seatCount`.

Errors:

- 400: venue has no seats, missing or unknown price categories, duplicate category.
- 404: event or venue not found or not yours.
- 409 `EVENT_CANCELLED`.
- 409 `CONFLICT` "This venue is already booked for an overlapping time slot".

### `GET /events/:eventId/shows/:showId`

No auth. **200** with the show row plus `venue_name`, `venue_address`, `venue_city` and
`category_prices: [{ category, price_paise }]`. 404 if the show is not in that event, or the
event is DRAFT.

## Seat map

### `GET /shows/:showId/seats`

No auth. Headers: `Cache-Control: no-store`, and `X-Cache: HIT|MISS` (Redis cache, TTL
`SEAT_MAP_CACHE_TTL_MS` = 2000 ms).

**200** `{ show: { id, startsAt, endsAt, status, bookable }, summary: { total, available,
held, booked, unavailable }, sections: [{ section, rows: [{ row, seats: [{ id, number,
category, pricePaise, status }] }] }] }`.

- Seat `status` is `AVAILABLE`, `HELD`, `BOOKED` or `UNAVAILABLE`. A hold past `held_until`
  shows as `AVAILABLE`.
- `bookable` means SCHEDULED, PUBLISHED and not started.
- The map is advisory and can be up to 2 s stale; holds always re-check under row locks.

Errors: 404 for unknown shows or DRAFT events.

## Reservations (holds)

### `POST /shows/:showId/reservations`

User. Middleware: rate limit `RATE_LIMIT_RESERVATION_USER_LIMIT` (20) per user per 60 s,
then the admission gate.

- Header `Idempotency-Key`: required, 8–128 printable ASCII characters.
- Body `{ "seatIds": [uuid] }`: 1 to `MAX_SEATS_PER_RESERVATION` (6) distinct ids.

**201** new hold, or **200** replay of the same key:
`{ "reservation": { id, showId, status, expiresAt, seats: [{ id, section, row, number,
category, pricePaise }], totalPricePaise } }`. The hold lasts `HOLD_DURATION_SECONDS`
(600 s).

Errors:

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | missing/invalid key, bad seat ids, duplicates, too many seats, or seats from another show |
| 404 | `NOT_FOUND` | unknown show, or DRAFT event |
| 409 | `SHOW_NOT_BOOKABLE` | show cancelled or started, event not published, or sales not open |
| 409 | `ACTIVE_RESERVATION_EXISTS` | you already have an ACTIVE hold on this show under another key |
| 409 | `SEATS_UNAVAILABLE` | a seat is held or booked; `details.unavailableSeatIds` |
| 409 | `RESERVATION_NOT_ACTIVE` | replay of a key whose hold is no longer live; `details.status` |
| 422 | `IDEMPOTENCY_KEY_REUSED` | key already used for a different show or seat set |
| 429 | `RATE_LIMITED` | |
| 503 | `SERVICE_BUSY` | admission gate full |

### `GET /reservations/:reservationId`

User, owner. **200** `{ "reservation": {...} }`, same shape as above. `status` reads
`EXPIRED` once the hold is past `expires_at`, even before the sweeper runs. 404 if not found
or not yours.

### `DELETE /reservations/:reservationId`

User, owner. Releases an ACTIVE hold: its seats go back to AVAILABLE and a PENDING_PAYMENT
booking becomes CANCELLED. **204**, also when it was already RELEASED or EXPIRED. Errors:
404; 409 `CANNOT_RELEASE_CONFIRMED`.

## Bookings

### `POST /reservations/:reservationId/checkout`

User, owner. Admission-gated. No body and no idempotency header: one booking per reservation
makes it idempotent.

**201** new booking or **200** replay:
`{ "booking": { id, status: "PENDING_PAYMENT", totalPaise, createdAt, confirmedAt: null,
event: { id, title }, show: { id, startsAt, venue: { name, city } }, seats: [...],
payBefore } }`. `payBefore` is the hold's `expires_at`.

Errors:

| HTTP | `code` | When |
|---|---|---|
| 404 | `NOT_FOUND` | not found or not yours |
| 409 | `RESERVATION_NOT_ACTIVE` | hold released or expired; `details.status` |
| 409 | `BOOKING_NOT_PAYABLE` | the existing booking is CANCELLED or EXPIRED |
| 409 | `SHOW_NOT_BOOKABLE` | show cancelled or started |
| 409 | `HOLD_LOST` | a seat is no longer held by this reservation |
| 503 | `SERVICE_BUSY` | admission gate full |

### `POST /bookings/:bookingId/confirm-mock`

User, owner. Admission-gated. Only when `ENABLE_MOCK_PAYMENT=true`; otherwise 404
`Endpoint not available` (the env schema refuses `true` when `NODE_ENV=production`). It
stands in for a payment confirmation: seats become BOOKED, one ticket per seat is created,
and the booking and reservation become CONFIRMED.

**200** `{ "booking": {..., status: "CONFIRMED", confirmedAt, seats: [{..., ticketCode}]} }`,
for both the first call and replays.

Errors: 404; 409 `SHOW_NOT_BOOKABLE`; 409 `BOOKING_NOT_PAYABLE` (not PENDING_PAYMENT); 409
`HOLD_LOST` (hold expired or taken over); 503 `SERVICE_BUSY`.

### `GET /bookings/mine`

User. Query `page` (default 1), `limit` (1–50, default 20). **200**
`{ "bookings": [...], "page", "limit", "total" }`, newest first.

- `ticketCode` appears only on CONFIRMED bookings.
- A PENDING_PAYMENT booking whose hold is dead reads as `EXPIRED`, without `payBefore`.

### `GET /bookings/:bookingId`

User, owner. **200** `{ "booking": {...} }`. 404 if not found or not yours.

## Other routes

| Route | Notes |
|---|---|
| `GET /health` | **200** `{ "status": "ok" }` after `SELECT 1`; **503** `SHUTTING_DOWN` while draining; 503 `DB_UNAVAILABLE` if Postgres is unreachable |

## Curl walkthrough

The full happy path against a fresh Docker stack (`docker compose down -v`, then
`docker compose up --build -d`). It works in any POSIX shell (last verified 2026-10-30 in
Git Bash on Windows). It needs `curl` and `node`; `node` is used instead of `jq` to read
JSON fields. Ids, tokens and timestamps differ on every run;
the responses below are real but shortened (`…`).

```sh
API=http://localhost:3000
# call: run curl, print the response and keep it in /tmp/r.json; get: read a field from it
call() { curl -s "$@" | tee /tmp/r.json; echo; }
get() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8'))$1" < /tmp/r.json; }
```

**1. Register an organizer** (201):

```sh
call -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Org One","email":"org@example.com","password":"Passw0rd!123","role":"ORGANIZER","organization_name":"Drama Society"}'
ORG_TOKEN=$(get .accessToken)
```

```json
{"user":{"id":"843eff7f-…","name":"Org One","email":"org@example.com","role":"ORGANIZER","is_active":true,"created_at":"2026-10-30T09:41:59.710Z","updated_at":"2026-10-30T09:41:59.710Z"},"accessToken":"eyJhbGciOiJIUzI1NiIs…"}
```

**2. Create a venue** (201):

```sh
call -X POST $API/venues -H "Authorization: Bearer $ORG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Main Hall","address":"1 College Road","city":"Pune"}'
VENUE_ID=$(get .id)
```

```json
{"id":"d64e49b0-…","owner_id":"843eff7f-…","name":"Main Hall","address":"1 College Road","city":"Pune","created_at":"2026-10-30T09:41:59.978Z"}
```

**3. Add seats**, 2 rows x 5 (201):

```sh
call -X POST $API/venues/$VENUE_ID/seats/bulk -H "Authorization: Bearer $ORG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"GRID","rows":["A","B"],"seatsPerRow":5,"category":"REGULAR"}'
```

```json
{"success":true,"message":"Seats generated successfully"}
```

**4. Create an event** (201, DRAFT):

```sh
call -X POST $API/events -H "Authorization: Bearer $ORG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Spring Play","category":"THEATRE","description":"Annual play"}'
EVENT_ID=$(get .id)
```

```json
{"id":"adc70dd1-…","organizer_id":"843eff7f-…","title":"Spring Play","description":"Annual play","category":"THEATRE","poster_url":null,"status":"DRAFT","cancelled_at":null,"created_at":"…","updated_at":"…"}
```

**5. Create a show** (201; one seat row per venue seat):

```sh
call -X POST $API/events/$EVENT_ID/shows -H "Authorization: Bearer $ORG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"venueId":"'$VENUE_ID'","startsAt":"2027-03-01T13:30:00Z","endsAt":"2027-03-01T16:00:00Z","categoryPrices":[{"category":"REGULAR","pricePaise":25000}]}'
SHOW_ID=$(get .id)
```

```json
{"id":"8d33deb0-…","event_id":"adc70dd1-…","venue_id":"d64e49b0-…","starts_at":"2027-03-01T13:30:00.000Z","ends_at":"2027-03-01T16:00:00.000Z","sales_open_at":null,"status":"SCHEDULED","created_at":"…","updated_at":"…","seatCount":10}
```

**6. Publish** (200):

```sh
call -X POST $API/events/$EVENT_ID/publish -H "Authorization: Bearer $ORG_TOKEN"
```

```json
{"success":true,"message":"Event published successfully"}
```

**7. Register an attendee** (201; `role` defaults to ATTENDEE):

```sh
call -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Asha","email":"asha@example.com","password":"Passw0rd!123"}'
USER_TOKEN=$(get .accessToken)
```

```json
{"user":{"id":"361ed32d-…","name":"Asha","email":"asha@example.com","role":"ATTENDEE","is_active":true,…},"accessToken":"eyJhbGciOiJIUzI1NiIs…"}
```

**8. Read the seat map** (200, `X-Cache: MISS` on the first read) and pick the first seat:

```sh
call $API/shows/$SHOW_ID/seats
SEAT_ID=$(get '.sections[0].rows[0].seats[0].id')
```

```json
{"show":{"id":"8d33deb0-…","startsAt":"2027-03-01T13:30:00.000Z","endsAt":"2027-03-01T16:00:00.000Z","status":"SCHEDULED","bookable":true},"summary":{"total":10,"available":10,"held":0,"booked":0,"unavailable":0},"sections":[{"section":"MAIN","rows":[{"row":"A","seats":[{"id":"544ea788-…","number":1,"category":"REGULAR","pricePaise":25000,"status":"AVAILABLE"},…]},{"row":"B","seats":[…]}]}]}
```

**9. Hold the seat** (201). Sending the same request again with the same key returns 200 and
the same reservation:

```sh
call -X POST $API/shows/$SHOW_ID/reservations -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: hold-asha-0001' \
  -d '{"seatIds":["'$SEAT_ID'"]}'
RES_ID=$(get .reservation.id)
```

```json
{"reservation":{"id":"adb5ad5c-…","showId":"8d33deb0-…","status":"ACTIVE","expiresAt":"2026-10-30T09:52:01.109Z","seats":[{"id":"544ea788-…","section":"MAIN","row":"A","number":1,"category":"REGULAR","pricePaise":25000}],"totalPricePaise":25000}}
```

**10. Check out** (201, PENDING_PAYMENT, no tickets yet):

```sh
call -X POST $API/reservations/$RES_ID/checkout -H "Authorization: Bearer $USER_TOKEN"
BOOKING_ID=$(get .booking.id)
```

```json
{"booking":{"id":"f0119349-…","status":"PENDING_PAYMENT","totalPaise":25000,"createdAt":"2026-10-30T09:42:01.279Z","confirmedAt":null,"event":{"id":"adc70dd1-…","title":"Spring Play"},"show":{"id":"8d33deb0-…","startsAt":"2027-03-01T13:30:00.000Z","venue":{"name":"Main Hall","city":"Pune"}},"seats":[{"id":"544ea788-…","section":"MAIN","row":"A","number":1,"category":"REGULAR","pricePaise":25000}],"payBefore":"2026-10-30T09:52:01.109Z"}}
```

**11. Confirm with mock payment** (200; each seat gets a `ticketCode`):

```sh
call -X POST $API/bookings/$BOOKING_ID/confirm-mock -H "Authorization: Bearer $USER_TOKEN"
```

```json
{"booking":{"id":"f0119349-…","status":"CONFIRMED","totalPaise":25000,"createdAt":"2026-10-30T09:42:01.279Z","confirmedAt":"2026-10-30T09:42:01.362Z",…,"seats":[{"id":"544ea788-…","section":"MAIN","row":"A","number":1,"category":"REGULAR","pricePaise":25000,"ticketCode":"278a3da6-…"}]}}
```

**12. List my bookings** (200):

```sh
call $API/bookings/mine -H "Authorization: Bearer $USER_TOKEN"
```

```json
{"bookings":[{"id":"f0119349-…","status":"CONFIRMED",…,"seats":[{…,"ticketCode":"278a3da6-…"}]}],"page":1,"limit":20,"total":1}
```

Access tokens expire after 15 minutes. If a later step returns 401 `TOKEN_EXPIRED`, log in
again (`POST /auth/login`) and reset the token variable.
