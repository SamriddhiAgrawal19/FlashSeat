const { Client } = require('pg');
const { execSync } = require('child_process');

async function run() {
  const pgClient = new Client('postgres://flashseat:flashseat@localhost:5432/flashseat');
  await pgClient.connect();

  console.log('--- Cleaning database ---');
  await pgClient.query('TRUNCATE users CASCADE');

  // Register organizer
  const regRes = await fetch('http://localhost:3000/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Organizer One',
      email: 'org1@test.com',
      password: 'password123',
      role: 'ORGANIZER',
      organization_name: 'Org Corp',
    }),
  });
  const regData = await regRes.json();
  const token = regData.accessToken;

  // Create venue 1 (with seats)
  const venueRes = await fetch('http://localhost:3000/venues', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'Grand Arena',
      address: '100 Main St',
      city: 'Mumbai',
    }),
  });
  const venue = await venueRes.json();

  // Add 40 REGULAR seats and 10 VIP seats (Total 50 seats)
  await fetch(`http://localhost:3000/venues/${venue.id}/seats/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mode: 'GRID',
      section: 'LOWER',
      rows: ['A', 'B', 'C', 'D'],
      seatsPerRow: 10,
      category: 'REGULAR',
    }),
  });

  await fetch(`http://localhost:3000/venues/${venue.id}/seats/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mode: 'GRID',
      section: 'BALCONY',
      rows: ['V'],
      seatsPerRow: 10,
      category: 'VIP',
    }),
  });

  // Create event
  const eventRes = await fetch('http://localhost:3000/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: 'Rock Concert',
      description: 'Big concert',
      category: 'MUSIC',
    }),
  });
  const event = await eventRes.json();

  // 1. Create a show on a venue with 50 seats -> response has seatCount 50 and count in DB is 50
  console.log('\n--- Test 1: Create show on 50-seat venue ---');
  const showRes = await fetch(`http://localhost:3000/events/${event.id}/shows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      venueId: venue.id,
      startsAt: '2026-11-01T18:00:00.000Z',
      endsAt: '2026-11-01T21:00:00.000Z',
      categoryPrices: [
        { category: 'REGULAR', pricePaise: 50000 },
        { category: 'VIP', pricePaise: 120000 },
      ],
    }),
  });
  const showData = await showRes.json();
  console.log('Create show status:', showRes.status);
  console.log('seatCount in response:', showData.seatCount);

  const dbSeatsCount = await pgClient.query('SELECT count(*)::int as count FROM show_seats WHERE show_id = $1', [showData.id]);
  console.log('DB show_seats count:', dbSeatsCount.rows[0].count);

  // 2. Prices in show_seats match the category prices (VIP vs REGULAR)
  console.log('\n--- Test 2: Category prices match in show_seats ---');
  const priceCheck = await pgClient.query(`
    SELECT vs.category, ss.price_paise, count(*)::int as seat_count
    FROM show_seats ss
    JOIN venue_seats vs ON ss.venue_seat_id = vs.id
    WHERE ss.show_id = $1
    GROUP BY vs.category, ss.price_paise
    ORDER BY vs.category
  `, [showData.id]);
  console.log('Prices per category:', priceCheck.rows);

  // 3. Create a show omitting one category's price -> 400 naming the missing category
  console.log('\n--- Test 3: Omitting category price ---');
  const omitRes = await fetch(`http://localhost:3000/events/${event.id}/shows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      venueId: venue.id,
      startsAt: '2026-11-02T18:00:00.000Z',
      endsAt: '2026-11-02T21:00:00.000Z',
      categoryPrices: [
        { category: 'REGULAR', pricePaise: 50000 },
        // VIP is missing
      ],
    }),
  });
  const omitData = await omitRes.json();
  console.log('Omit category status:', omitRes.status, omitData);

  // 4. Send a price for a category that does not exist in the venue -> 400
  console.log('\n--- Test 4: Unknown category price ---');
  const unknownRes = await fetch(`http://localhost:3000/events/${event.id}/shows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      venueId: venue.id,
      startsAt: '2026-11-03T18:00:00.000Z',
      endsAt: '2026-11-03T21:00:00.000Z',
      categoryPrices: [
        { category: 'REGULAR', pricePaise: 50000 },
        { category: 'VIP', pricePaise: 120000 },
        { category: 'PLATINUM', pricePaise: 200000 }, // Unknown category
      ],
    }),
  });
  const unknownData = await unknownRes.json();
  console.log('Unknown category status:', unknownRes.status, unknownData);

  // 5. Venue with 0 seats -> 400
  console.log('\n--- Test 5: Venue with 0 seats ---');
  const emptyVenueRes = await fetch('http://localhost:3000/venues', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'Empty Hall',
      address: '200 Main St',
      city: 'Delhi',
    }),
  });
  const emptyVenue = await emptyVenueRes.json();

  const emptyShowRes = await fetch(`http://localhost:3000/events/${event.id}/shows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      venueId: emptyVenue.id,
      startsAt: '2026-11-04T18:00:00.000Z',
      endsAt: '2026-11-04T21:00:00.000Z',
      categoryPrices: [
        { category: 'REGULAR', pricePaise: 50000 },
      ],
    }),
  });
  const emptyShowData = await emptyShowRes.json();
  console.log('Empty venue show status:', emptyShowRes.status, emptyShowData);

  // 6. Overlapping show -> 409, and no show or show_seats rows are left behind
  console.log('\n--- Test 6: Overlapping show ---');
  const preCountShows = await pgClient.query('SELECT count(*)::int as count FROM shows');
  const preCountShowSeats = await pgClient.query('SELECT count(*)::int as count FROM show_seats');

  const overlapRes = await fetch(`http://localhost:3000/events/${event.id}/shows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      venueId: venue.id,
      // Overlaps with 2026-11-01T18:00:00 to 21:00:00
      startsAt: '2026-11-01T19:00:00.000Z',
      endsAt: '2026-11-01T22:00:00.000Z',
      categoryPrices: [
        { category: 'REGULAR', pricePaise: 50000 },
        { category: 'VIP', pricePaise: 120000 },
      ],
    }),
  });
  const overlapData = await overlapRes.json();
  console.log('Overlap status:', overlapRes.status, overlapData);

  const postCountShows = await pgClient.query('SELECT count(*)::int as count FROM shows');
  const postCountShowSeats = await pgClient.query('SELECT count(*)::int as count FROM show_seats');
  console.log('Shows count before & after overlap attempt:', preCountShows.rows[0].count, '->', postCountShows.rows[0].count);
  console.log('Show_seats count before & after overlap attempt:', preCountShowSeats.rows[0].count, '->', postCountShowSeats.rows[0].count);

  // 7. Backfill script: create legacy show without show_seats
  console.log('\n--- Test 7: Backfill script ---');
  const oldShowRes = await pgClient.query(`
    INSERT INTO shows (event_id, venue_id, starts_at, ends_at)
    VALUES ($1, $2, '2026-12-01T10:00:00Z', '2026-12-01T12:00:00Z') RETURNING id
  `, [event.id, venue.id]);
  const oldShowId = oldShowRes.rows[0].id;

  await pgClient.query(`
    INSERT INTO show_category_prices (show_id, category, price_paise)
    VALUES ($1, 'REGULAR', 50000), ($1, 'VIP', 120000)
  `, [oldShowId]);

  const beforeBackfill = await pgClient.query('SELECT count(*)::int as count FROM show_seats WHERE show_id = $1', [oldShowId]);
  console.log('Old show seats before backfill:', beforeBackfill.rows[0].count);

  execSync('npm run db:backfill-seats', { stdio: 'inherit' });
  const afterFirstBackfill = await pgClient.query('SELECT count(*)::int as count FROM show_seats WHERE show_id = $1', [oldShowId]);
  console.log('Old show seats after 1st backfill:', afterFirstBackfill.rows[0].count);

  execSync('npm run db:backfill-seats', { stdio: 'inherit' });
  const afterSecondBackfill = await pgClient.query('SELECT count(*)::int as count FROM show_seats WHERE show_id = $1', [oldShowId]);
  console.log('Old show seats after 2nd backfill:', afterSecondBackfill.rows[0].count);

  // Test duplicate category validation in Zod schema
  console.log('\n--- Extra: Duplicate category in request payload ---');
  const dupRes = await fetch(`http://localhost:3000/events/${event.id}/shows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      venueId: venue.id,
      startsAt: '2026-12-02T10:00:00.000Z',
      endsAt: '2026-12-02T12:00:00.000Z',
      categoryPrices: [
        { category: 'REGULAR', pricePaise: 50000 },
        { category: 'REGULAR', pricePaise: 60000 },
      ],
    }),
  });
  const dupData = await dupRes.json();
  console.log('Duplicate category status:', dupRes.status, dupData);

  await pgClient.end();
}

run().catch(console.error);
