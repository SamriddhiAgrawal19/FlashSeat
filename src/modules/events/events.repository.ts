import { PoolClient } from 'pg';

export interface EventRow {
  id: string;
  organizer_id: string;
  title: string;
  description: string;
  category: string;
  poster_url: string | null;
  status: string;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function createEvent(
  client: PoolClient,
  organizerId: string,
  title: string,
  description: string,
  category: string,
  posterUrl?: string
): Promise<EventRow> {
  const result = await client.query(
    'INSERT INTO events (organizer_id, title, description, category, poster_url, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [organizerId, title, description, category, posterUrl || null, 'DRAFT']
  );
  return result.rows[0];
}

export async function findEventById(client: PoolClient, eventId: string): Promise<EventRow | null> {
  const result = await client.query('SELECT * FROM events WHERE id = $1', [eventId]);
  return result.rows[0] || null;
}

export async function updateEvent(
  client: PoolClient,
  eventId: string,
  updates: { title?: string; description?: string; category?: string; posterUrl?: string }
): Promise<EventRow> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.title !== undefined) {
    setClauses.push(`title = $${paramIndex++}`);
    values.push(updates.title);
  }
  if (updates.description !== undefined) {
    setClauses.push(`description = $${paramIndex++}`);
    values.push(updates.description);
  }
  if (updates.category !== undefined) {
    setClauses.push(`category = $${paramIndex++}`);
    values.push(updates.category);
  }
  if (updates.posterUrl !== undefined) {
    setClauses.push(`poster_url = $${paramIndex++}`);
    values.push(updates.posterUrl);
  }

  values.push(eventId);
  const queryText = `
    UPDATE events
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await client.query(queryText, values);
  return result.rows[0];
}

export async function updateEventStatus(client: PoolClient, eventId: string, status: string, cancel: boolean = false): Promise<void> {
  const setClause = cancel ? `status = $1, cancelled_at = now()` : `status = $1`;
  await client.query(`UPDATE events SET ${setClause} WHERE id = $2`, [status, eventId]);
}

// Lock the event row FOR UPDATE (hierarchy level 1) for state mutations.
export async function findEventForUpdate(client: PoolClient, eventId: string): Promise<EventRow | null> {
  const result = await client.query<EventRow>('SELECT * FROM events WHERE id = $1 FOR UPDATE', [eventId]);
  return result.rows[0] || null;
}

// Lock the event row FOR UPDATE with the owner check (hierarchy level 1).
export async function lockEventForCancel(
  client: PoolClient,
  eventId: string,
  organizerId: string
): Promise<{ id: string; status: string } | null> {
  const result = await client.query<{ id: string; status: string }>(
    'SELECT id, status FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE',
    [eventId, organizerId]
  );
  return result.rows[0] || null;
}

// Lock the event row FOR SHARE (hierarchy level 1) so a concurrent cancelEvent
// (which needs FOR UPDATE) cannot run between a status check and a write.
export async function lockEventForShowCreate(
  client: PoolClient,
  eventId: string
): Promise<{ id: string; organizer_id: string; status: string } | null> {
  const result = await client.query<{ id: string; organizer_id: string; status: string }>(
    'SELECT id, organizer_id, status FROM events WHERE id = $1 FOR SHARE',
    [eventId]
  );
  return result.rows[0] || null;
}

// ---- cancelEvent pipeline (set-based, lock hierarchy: shows -> reservations ->
// ---- bookings -> show_seats; every level locked ORDER BY id ASC) ----------

export async function lockShowsForEvent(client: PoolClient, eventId: string): Promise<void> {
  await client.query('SELECT id FROM shows WHERE event_id = $1 ORDER BY id FOR UPDATE', [eventId]);
}

export async function cancelShowsForEvent(client: PoolClient, eventId: string): Promise<void> {
  await client.query(`UPDATE shows SET status = 'CANCELLED' WHERE event_id = $1`, [eventId]);
}

export async function lockActiveReservationsForEvent(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `SELECT r.id FROM reservations r JOIN shows s ON s.id = r.show_id
      WHERE s.event_id = $1 AND r.status = 'ACTIVE' ORDER BY r.id FOR UPDATE`,
    [eventId]
  );
}

export async function lockBookingsToCloseForEvent(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `SELECT b.id FROM bookings b JOIN shows s ON s.id = b.show_id
      WHERE s.event_id = $1 AND b.status IN ('PENDING_PAYMENT', 'CONFIRMED') ORDER BY b.id FOR UPDATE`,
    [eventId]
  );
}

export async function lockHeldSeatsForEvent(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `SELECT ss.id FROM show_seats ss JOIN shows s ON s.id = ss.show_id
      WHERE s.event_id = $1 AND ss.status = 'HELD' ORDER BY ss.id FOR UPDATE`,
    [eventId]
  );
}

export async function releaseHeldSeatsForEvent(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `UPDATE show_seats ss SET status = 'AVAILABLE', reservation_id = NULL, held_until = NULL
       FROM shows s
      WHERE s.id = ss.show_id AND s.event_id = $1 AND ss.status = 'HELD'`,
    [eventId]
  );
}

export async function releaseActiveReservationsForEvent(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `UPDATE reservations r SET status = 'RELEASED'
       FROM shows s
      WHERE s.id = r.show_id AND s.event_id = $1 AND r.status = 'ACTIVE'`,
    [eventId]
  );
}

export async function cancelPendingBookingsForEvent(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `UPDATE bookings b SET status = 'CANCELLED', cancelled_at = now()
       FROM shows s
      WHERE s.id = b.show_id AND s.event_id = $1 AND b.status = 'PENDING_PAYMENT'`,
    [eventId]
  );
}

export async function markConfirmedBookingsRefundPendingForEvent(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `UPDATE bookings b SET status = 'REFUND_PENDING'
       FROM shows s
      WHERE s.id = b.show_id AND s.event_id = $1 AND b.status = 'CONFIRMED'`,
    [eventId]
  );
}

export async function countShowsForEvent(client: PoolClient, eventId: string): Promise<number> {
  const result = await client.query('SELECT COUNT(*)::int as count FROM shows WHERE event_id = $1', [eventId]);
  return result.rows[0].count;
}

export async function findEventsByOrganizer(client: PoolClient, organizerId: string): Promise<EventRow[]> {
  const result = await client.query('SELECT * FROM events WHERE organizer_id = $1 ORDER BY created_at DESC', [organizerId]);
  return result.rows;
}

/** A show of one of the organizer's events, as listed on GET /events/mine (any status). */
export interface OrganizerShowRow {
  id: string;
  event_id: string;
  venue_id: string;
  venue_name: string;
  venue_city: string;
  starts_at: Date;
  ends_at: Date;
  sales_open_at: Date | null;
  status: string;
  /** show_seats rows of the show. */
  seats_total: number;
  /** show_seats rows with status BOOKED (includes seats of REFUND_PENDING bookings). */
  seats_booked: number;
}

// Every show of every event the organizer owns, in one statement (no per-event lookups).
// The seat counts use idx_show_seats_show_status.
export async function findShowsForOrganizer(client: PoolClient, organizerId: string): Promise<OrganizerShowRow[]> {
  const result = await client.query<OrganizerShowRow>(
    `SELECT s.id, s.event_id, s.venue_id, v.name AS venue_name, v.city AS venue_city,
            s.starts_at, s.ends_at, s.sales_open_at, s.status,
            c.seats_total, c.seats_booked
       FROM shows s
       JOIN events e ON e.id = s.event_id
       JOIN venues v ON v.id = s.venue_id
       LEFT JOIN LATERAL (
              SELECT count(*)::int AS seats_total,
                     count(*) FILTER (WHERE ss.status = 'BOOKED')::int AS seats_booked
                FROM show_seats ss
               WHERE ss.show_id = s.id
            ) c ON true
      WHERE e.organizer_id = $1
      ORDER BY s.starts_at, s.id`,
    [organizerId]
  );
  return result.rows;
}

/** The earliest upcoming SCHEDULED show of an event, as returned by GET /events. */
export interface NextShow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  venue: { id: string; name: string; city: string };
}

/** A GET /events row: the event row unchanged, plus upcoming-show info. */
export interface PublicEventRow extends EventRow {
  next_show: NextShow | null;
  upcoming_show_count: number;
  min_price_paise: number | null;
}

interface SearchRow extends EventRow {
  ns_id: string | null;
  ns_starts_at: Date | null;
  ns_ends_at: Date | null;
  ns_venue_id: string | null;
  ns_venue_name: string | null;
  ns_venue_city: string | null;
  upcoming_show_count: number;
  min_price_paise: number | null;
}

export async function searchPublishedEvents(
  client: PoolClient,
  filters: { category?: string; city?: string; dateFrom?: string; dateTo?: string },
  limit: number,
  offset: number
): Promise<{ events: PublicEventRow[]; total: number }> {
  const values: unknown[] = [];
  const conditions = [`e.status = 'PUBLISHED'`];

  // Case-insensitive on both sides; stored values are not changed.
  if (filters.category) {
    values.push(filters.category);
    conditions.push(`lower(e.category) = lower($${values.length})`);
  }

  // A "matching show" is an upcoming one (SCHEDULED, starts_at > now() by the database clock)
  // that also satisfies every active show filter, all on the SAME show. This one predicate is
  // used for which events are listed, for total, and for next_show / upcoming_show_count /
  // min_price_paise, so the card always describes a show that matched the search.
  const showConditions = [`s.event_id = e.id`, `s.status = 'SCHEDULED'`, `s.starts_at > now()`];
  if (filters.city) {
    values.push(filters.city);
    showConditions.push(`lower(v.city) = lower($${values.length})`);
  }
  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    showConditions.push(`s.starts_at >= $${values.length}`);
  }
  if (filters.dateTo) {
    values.push(filters.dateTo);
    showConditions.push(`s.ends_at <= $${values.length}`);
  }
  const matching = showConditions.join(' AND ');

  // Only events with at least one matching show are listed (no upcoming show, no listing).
  conditions.push(`EXISTS (SELECT 1 FROM shows s JOIN venues v ON v.id = s.venue_id WHERE ${matching})`);

  const where = conditions.join(' AND ');

  const countResult = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM events e WHERE ${where}`,
    values
  );
  const total = countResult.rows[0].total;

  // One statement for the page: the show info comes from two LATERAL joins over the same
  // matching shows (evaluated per event row inside the query), so there are no per-event
  // follow-up queries. The $n placeholders of the filters are shared by all three uses.
  const pageValues = [...values, limit, offset];
  const result = await client.query<SearchRow>(
    `SELECT e.*,
            ns.id AS ns_id, ns.starts_at AS ns_starts_at, ns.ends_at AS ns_ends_at,
            ns.venue_id AS ns_venue_id, ns.venue_name AS ns_venue_name, ns.venue_city AS ns_venue_city,
            up.upcoming_show_count, up.min_price_paise
       FROM events e
       LEFT JOIN LATERAL (
              SELECT s.id, s.starts_at, s.ends_at, v.id AS venue_id, v.name AS venue_name, v.city AS venue_city
                FROM shows s
                JOIN venues v ON v.id = s.venue_id
               WHERE ${matching}
               ORDER BY s.starts_at, s.id
               LIMIT 1
            ) ns ON true
       LEFT JOIN LATERAL (
              -- DISTINCT: the price join yields one row per (show, category).
              SELECT count(DISTINCT s.id)::int AS upcoming_show_count,
                     min(p.price_paise)::int AS min_price_paise
                FROM shows s
                JOIN venues v ON v.id = s.venue_id
                LEFT JOIN show_category_prices p ON p.show_id = s.id
               WHERE ${matching}
            ) up ON true
      WHERE ${where}
      ORDER BY e.created_at DESC, e.id
      LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues
  );

  const events = result.rows.map(
    ({ ns_id, ns_starts_at, ns_ends_at, ns_venue_id, ns_venue_name, ns_venue_city, ...row }): PublicEventRow => ({
      ...row,
      next_show:
        ns_id && ns_starts_at && ns_ends_at && ns_venue_id && ns_venue_name !== null && ns_venue_city !== null
          ? { id: ns_id, starts_at: ns_starts_at, ends_at: ns_ends_at, venue: { id: ns_venue_id, name: ns_venue_name, city: ns_venue_city } }
          : null,
    })
  );

  return { events, total };
}

export async function findShowsForEvent(client: PoolClient, eventId: string) {
  const result = await client.query(`
    SELECT s.id, v.name as venue_name, v.city as venue_city, s.starts_at, s.ends_at, s.status
    FROM shows s
    JOIN venues v ON s.venue_id = v.id
    WHERE s.event_id = $1
    ORDER BY s.starts_at ASC
  `, [eventId]);
  return result.rows;
}
