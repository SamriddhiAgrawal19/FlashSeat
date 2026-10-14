import { PoolClient } from 'pg';

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
