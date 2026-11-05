import { Pool, PoolClient } from 'pg';

export interface ShowForSeatMapRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  sales_open_at: Date | null;
  status: string;
  event_id: string;
  event_title: string;
  event_status: string;
  venue_name: string;
  venue_city: string;
  not_started: boolean;
  /** sales_open_at IS NULL OR sales_open_at <= now() (DB clock) */
  sales_open: boolean;
}

export interface SeatMapRow {
  id: string;
  section: string;
  row_label: string;
  seat_number: number;
  category: string;
  price_paise: number;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'UNAVAILABLE';
}

export async function getVenueSeatCategories(client: PoolClient, venueId: string): Promise<string[]> {
  const result = await client.query<{ category: string }>(
    'SELECT DISTINCT category FROM venue_seats WHERE venue_id = $1',
    [venueId]
  );
  return result.rows.map(r => r.category);
}

export async function generateForShow(client: PoolClient, showId: string, venueId: string): Promise<number> {
  const result = await client.query(
    `INSERT INTO show_seats (show_id, venue_seat_id, price_paise)
SELECT $1, vs.id, scp.price_paise
  FROM venue_seats vs
  JOIN show_category_prices scp
    ON scp.show_id = $1 AND scp.category = vs.category
 WHERE vs.venue_id = $2`,
    [showId, venueId]
  );
  return result.rowCount ?? 0;
}

export async function countVenueSeats(client: PoolClient, venueId: string): Promise<number> {
  const result = await client.query<{ count: string | number }>(
    'SELECT count(*)::int as count FROM venue_seats WHERE venue_id = $1',
    [venueId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function getShowForSeatMap(
  client: PoolClient | Pool,
  showId: string
): Promise<ShowForSeatMapRow | null> {
  const result = await client.query<ShowForSeatMapRow>(
    `SELECT s.id, s.starts_at, s.ends_at, s.sales_open_at, s.status,
            e.id AS event_id, e.title AS event_title, e.status AS event_status,
            v.name AS venue_name, v.city AS venue_city,
            (s.starts_at > now()) AS not_started,
            (s.sales_open_at IS NULL OR s.sales_open_at <= now()) AS sales_open
       FROM shows s
       JOIN events e ON e.id = s.event_id
       JOIN venues v ON v.id = s.venue_id
      WHERE s.id = $1`,
    [showId]
  );
  return result.rows[0] || null;
}

export async function listSeatMap(
  client: PoolClient | Pool,
  showId: string
): Promise<SeatMapRow[]> {
  const result = await client.query<SeatMapRow>(
    `SELECT ss.id, vs.section, vs.row_label, vs.seat_number, vs.category, ss.price_paise,
            CASE
              WHEN ss.status = 'HELD' AND ss.held_until < now() THEN 'AVAILABLE'
              WHEN ss.status = 'BLOCKED' THEN 'UNAVAILABLE'
              ELSE ss.status::text
            END AS status
       FROM show_seats ss
       JOIN venue_seats vs ON vs.id = ss.venue_seat_id
      WHERE ss.show_id = $1
      ORDER BY vs.section, length(vs.row_label), vs.row_label, vs.seat_number`,
    [showId]
  );
  return result.rows;
}
