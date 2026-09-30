import { PoolClient } from 'pg';

export interface ShowRow {
  id: string;
  event_id: string;
  venue_id: string;
  starts_at: Date;
  ends_at: Date;
  sales_open_at: Date | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export async function createShow(
  client: PoolClient,
  eventId: string,
  venueId: string,
  startsAt: string,
  endsAt: string,
  salesOpenAt?: string
): Promise<ShowRow> {
  const result = await client.query(
    'INSERT INTO shows (event_id, venue_id, starts_at, ends_at, sales_open_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [eventId, venueId, startsAt, endsAt, salesOpenAt || null]
  );
  return result.rows[0];
}

export async function insertCategoryPrices(
  client: PoolClient,
  showId: string,
  prices: { category: string; pricePaise: number }[]
): Promise<void> {
  const values = [];
  const placeholders = [];
  let paramIndex = 1;

  for (const price of prices) {
    placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
    values.push(showId, price.category, price.pricePaise);
  }

  const queryText = `INSERT INTO show_category_prices (show_id, category, price_paise) VALUES ${placeholders.join(', ')}`;
  await client.query(queryText, values);
}

export async function findShowById(client: PoolClient, showId: string) {
  const showResult = await client.query(`
    SELECT s.*, v.name as venue_name, v.address as venue_address, v.city as venue_city
    FROM shows s
    JOIN venues v ON s.venue_id = v.id
    WHERE s.id = $1
  `, [showId]);
  
  if (showResult.rowCount === 0) return null;
  
  const pricesResult = await client.query('SELECT category, price_paise FROM show_category_prices WHERE show_id = $1', [showId]);
  
  return {
    ...showResult.rows[0],
    category_prices: pricesResult.rows
  };
}
