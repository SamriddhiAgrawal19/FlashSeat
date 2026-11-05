import { PoolClient } from 'pg';

export interface VenueRow {
  id: string;
  owner_id: string;
  name: string;
  address: string;
  city: string;
  created_at: Date;
}

export interface VenueWithSeatCountRow extends VenueRow {
  seat_count: number;
  /** Distinct venue_seats.category values, sorted ascending; [] for a venue without seats. */
  categories: string[];
}

/** One venue seat, as read for the owner's layout preview. */
export interface VenueSeatLayoutRow {
  section: string;
  row_label: string;
  seat_number: number;
  category: string;
}

export async function createVenue(
  client: PoolClient,
  ownerId: string,
  name: string,
  address: string,
  city: string
): Promise<VenueRow> {
  const result = await client.query(
    'INSERT INTO venues (owner_id, name, address, city) VALUES ($1, $2, $3, $4) RETURNING *',
    [ownerId, name, address, city]
  );
  return result.rows[0];
}

export async function findVenueById(client: PoolClient, venueId: string): Promise<VenueRow | null> {
  const result = await client.query('SELECT * FROM venues WHERE id = $1', [venueId]);
  return result.rows[0] || null;
}

// FOR UPDATE: serializes concurrent bulk seat calls on one venue so the
// per-venue seat cap is checked and enforced atomically.
export async function lockVenueForUpdate(client: PoolClient, venueId: string): Promise<VenueRow | null> {
  const result = await client.query('SELECT * FROM venues WHERE id = $1 FOR UPDATE', [venueId]);
  return result.rows[0] || null;
}

export async function countVenueSeats(client: PoolClient, venueId: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM venue_seats WHERE venue_id = $1',
    [venueId]
  );
  return result.rows[0].count;
}

export async function findVenuesByOwnerId(client: PoolClient, ownerId: string): Promise<VenueWithSeatCountRow[]> {
  const result = await client.query(`
    SELECT v.*, COUNT(s.id)::int as seat_count,
           COALESCE(array_agg(DISTINCT s.category ORDER BY s.category) FILTER (WHERE s.id IS NOT NULL), '{}') AS categories
    FROM venues v
    LEFT JOIN venue_seats s ON v.id = s.venue_id
    WHERE v.owner_id = $1
    GROUP BY v.id
    ORDER BY v.created_at DESC
  `, [ownerId]);
  return result.rows;
}

// Rows ordered naturally: shorter labels first ('B' before 'AA', '2' before '10'), then by label.
export async function findVenueSeatLayout(client: PoolClient, venueId: string): Promise<VenueSeatLayoutRow[]> {
  const result = await client.query<VenueSeatLayoutRow>(
    `SELECT section, row_label, seat_number, category
       FROM venue_seats
      WHERE venue_id = $1
      ORDER BY section, length(row_label), row_label, seat_number`,
    [venueId]
  );
  return result.rows;
}

export async function insertBulkSeats(
  client: PoolClient,
  venueId: string,
  seats: { section: string; rowLabel: string; seatNumber: number; category: string }[]
): Promise<void> {
  if (seats.length === 0) return;

  // Build the bulk insert values string and flattened array
  const values = [];
  const queryPlaceholders = [];
  let paramIndex = 1;

  for (const seat of seats) {
    queryPlaceholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);
    values.push(venueId, seat.section, seat.rowLabel, seat.seatNumber, seat.category);
    paramIndex += 5;
  }

  const queryText = `
    INSERT INTO venue_seats (venue_id, section, row_label, seat_number, category)
    VALUES ${queryPlaceholders.join(', ')}
  `;

  await client.query(queryText, values);
}
