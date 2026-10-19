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

export async function searchPublishedEvents(
  client: PoolClient,
  filters: { category?: string; city?: string; dateFrom?: string; dateTo?: string },
  limit: number,
  offset: number
) {
  let queryText = `
    SELECT DISTINCT e.*
    FROM events e
    LEFT JOIN shows s ON e.id = s.event_id
    LEFT JOIN venues v ON s.venue_id = v.id
    WHERE e.status = 'PUBLISHED'
  `;
  const values: any[] = [];
  let paramIndex = 1;

  if (filters.category) {
    queryText += ` AND e.category = $${paramIndex++}`;
    values.push(filters.category);
  }
  if (filters.city) {
    queryText += ` AND v.city = $${paramIndex++}`;
    values.push(filters.city);
  }
  if (filters.dateFrom) {
    queryText += ` AND s.starts_at >= $${paramIndex++}`;
    values.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    queryText += ` AND s.ends_at <= $${paramIndex++}`;
    values.push(filters.dateTo);
  }

  // Count total matches
  const countQuery = `SELECT COUNT(*) as total FROM (${queryText}) as matches`;
  const countResult = await client.query(countQuery, values);
  const total = parseInt(countResult.rows[0].total, 10);

  // Get paginated results
  queryText += ` ORDER BY e.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  values.push(limit, offset);

  const result = await client.query(queryText, values);

  return { events: result.rows, total };
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
