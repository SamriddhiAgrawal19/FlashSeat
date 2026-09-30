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

export async function findVenuesByOwnerId(client: PoolClient, ownerId: string): Promise<VenueWithSeatCountRow[]> {
  const result = await client.query(`
    SELECT v.*, COUNT(s.id)::int as seat_count
    FROM venues v
    LEFT JOIN venue_seats s ON v.id = s.venue_id
    WHERE v.owner_id = $1
    GROUP BY v.id
    ORDER BY v.created_at DESC
  `, [ownerId]);
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
