const { Client } = require('pg');
const { execSync } = require('child_process');

async function main() {
  const pgClient = new Client('postgres://flashseat:flashseat@localhost:5432/flashseat');
  await pgClient.connect();

  console.log('--- Cleaning database ---');
  await pgClient.query('TRUNCATE users CASCADE');

  const baseUrl = 'http://localhost:3000';

  // 1. Setup Organizer & Event & Show with 30 seats
  const orgRes = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Organizer',
      email: 'org5@test.com',
      password: 'password123',
      role: 'ORGANIZER',
      organization_name: 'Org 5',
    }),
  });
  const org = await orgRes.json();
  const orgToken = org.accessToken;

  // Venue with 30 seats (3 rows of 10)
  const venueRes = await fetch(`${baseUrl}/venues`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${orgToken}`,
    },
    body: JSON.stringify({
      name: 'Step 5 Arena',
      address: '500 Main St',
      city: 'Delhi',
    }),
  });
  const venue = await venueRes.json();

  await fetch(`${baseUrl}/venues/${venue.id}/seats/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${orgToken}`,
    },
    body: JSON.stringify({
      mode: 'GRID',
      section: 'MAIN',
      rows: ['A', 'B', 'C'],
      seatsPerRow: 10,
      category: 'REGULAR',
    }),
  });

  const eventRes = await fetch(`${baseUrl}/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${orgToken}`,
    },
    body: JSON.stringify({
      title: 'Checkout Event',
      category: 'MUSIC',
    }),
  });
  const event = await eventRes.json();

  const startsAt = new Date(Date.now() + 86400000 * 5).toISOString();
  const endsAt = new Date(Date.now() + 86400000 * 5 + 7200000).toISOString();

  const showRes = await fetch(`${baseUrl}/events/${event.id}/shows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${orgToken}`,
    },
    body: JSON.stringify({
      venueId: venue.id,
      startsAt,
      endsAt,
      categoryPrices: [{ category: 'REGULAR', pricePaise: 50000 }],
    }),
  });
  const show = await showRes.json();

  await fetch(`${baseUrl}/events/${event.id}/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${orgToken}` },
  });

  // Register users
  const userARes = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'User A',
      email: 'usera5@test.com',
      password: 'password123',
      role: 'ATTENDEE',
    }),
  });
  const userA = await userARes.json();
  const tokenA = userA.accessToken;

  const userBRes = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'User B',
      email: 'userb5@test.com',
      password: 'password123',
      role: 'ATTENDEE',
    }),
  });
  const userB = await userBRes.json();
  const tokenB = userB.accessToken;

  const seatMap = await (await fetch(`${baseUrl}/shows/${show.id}/seats`)).json();
  const allSeats = seatMap.sections.flatMap(s => s.rows.flatMap(r => r.seats));
  console.log(`Available seats in show: ${allSeats.length}`);

  // -------------------------------------------------------------
  // Test 1: Hold 2 seats -> checkout -> 201, PENDING_PAYMENT, totalPaise, zero booking_seats
  // -------------------------------------------------------------
  console.log('\n--- Test 1: Hold 2 seats -> Checkout ---');
  const hold1Res = await fetch(`${baseUrl}/shows/${show.id}/reservations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
      'Idempotency-Key': 't1-hold-key',
    },
    body: JSON.stringify({ seatIds: [allSeats[0].id, allSeats[1].id] }),
  });
  const hold1 = await hold1Res.json();
  const res1Id = hold1.reservation.id;

  const co1Res = await fetch(`${baseUrl}/reservations/${res1Id}/checkout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const co1 = await co1Res.json();
  console.log('Checkout status:', co1Res.status);
  console.log('Booking details:', co1.booking);

  const t1BookingSeatsCount = await pgClient.query('SELECT count(*)::int as count FROM booking_seats WHERE booking_id = $1', [co1.booking.id]);
  const t1ShowSeats = await pgClient.query('SELECT status FROM show_seats WHERE id = ANY($1::uuid[])', [[allSeats[0].id, allSeats[1].id]]);

  const pass1 =
    co1Res.status === 201 &&
    co1.booking.status === 'PENDING_PAYMENT' &&
    co1.booking.totalPaise === 100000 &&
    co1.booking.payBefore !== undefined &&
    t1BookingSeatsCount.rows[0].count === 0 &&
    t1ShowSeats.rows.every(r => r.status === 'HELD');
  console.log('Test 1:', pass1 ? 'PASS' : 'FAIL');

  // -------------------------------------------------------------
  // Test 2: Checkout again -> 200, same booking id, still one booking row
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Checkout again (idempotent replay) ---');
  const co2Res = await fetch(`${baseUrl}/reservations/${res1Id}/checkout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const co2 = await co2Res.json();
  console.log('Checkout again status:', co2Res.status);

  const t2BookingCount = await pgClient.query('SELECT count(*)::int as count FROM bookings WHERE reservation_id = $1', [res1Id]);
  const pass2 =
    co2Res.status === 200 &&
    co2.booking.id === co1.booking.id &&
    t2BookingCount.rows[0].count === 1;
  console.log('Test 2:', pass2 ? 'PASS' : 'FAIL');

  // -------------------------------------------------------------
  // Test 3: Another user checks out my reservation -> 404
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Other user checks out my reservation -> 404 ---');
  const co3Res = await fetch(`${baseUrl}/reservations/${res1Id}/checkout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  console.log('Other user checkout status:', co3Res.status);
  const pass3 = co3Res.status === 404;
  console.log('Test 3:', pass3 ? 'PASS' : 'FAIL');

  // -------------------------------------------------------------
  // Test 4: Reservation expires_at in the past -> checkout -> 409 RESERVATION_NOT_ACTIVE
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Reservation expires_at in past -> 409 RESERVATION_NOT_ACTIVE ---');
  // Hold a seat with user B
  const holdBRes = await fetch(`${baseUrl}/shows/${show.id}/reservations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenB}`,
      'Idempotency-Key': 't4-hold-key',
    },
    body: JSON.stringify({ seatIds: [allSeats[2].id] }),
  });
  const holdB = await holdBRes.json();
  const resBId = holdB.reservation.id;

  // Push expires_at into past in psql
  await pgClient.query(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [resBId]);

  const coBRes = await fetch(`${baseUrl}/reservations/${resBId}/checkout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  const coBData = await coBRes.json();
  console.log('Expired reservation checkout status:', coBRes.status, coBData);
  const pass4 =
    coBRes.status === 409 &&
    coBData.error?.code === 'RESERVATION_NOT_ACTIVE';
  console.log('Test 4:', pass4 ? 'PASS' : 'FAIL');

  // -------------------------------------------------------------
  // Test 5: Hold lost (held_until in past, another user takes seat -> 409 HOLD_LOST)
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Hold lost -> 409 HOLD_LOST ---');
  // Register User C
  const userCRes = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'User C',
      email: 'userc5@test.com',
      password: 'password123',
      role: 'ATTENDEE',
    }),
  });
  const userC = await userCRes.json();
  const tokenC = userC.accessToken;

  // User C holds seat 3
  const holdCRes = await fetch(`${baseUrl}/shows/${show.id}/reservations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenC}`,
      'Idempotency-Key': 't5-hold-key',
    },
    body: JSON.stringify({ seatIds: [allSeats[3].id] }),
  });
  const holdC = await holdCRes.json();
  const resCId = holdC.reservation.id;

  // Push ONLY held_until into past for seat 3
  await pgClient.query(`UPDATE show_seats SET held_until = now() - interval '1 minute' WHERE id = $1`, [allSeats[3].id]);

  // User B takes seat 3 (since hold expired)
  const takeRes = await fetch(`${baseUrl}/shows/${show.id}/reservations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenB}`,
      'Idempotency-Key': 't5-take-key',
    },
    body: JSON.stringify({ seatIds: [allSeats[3].id] }),
  });
  console.log('User B takes seat status:', takeRes.status);

  // User C attempts checkout on resCId -> 409 HOLD_LOST
  const coCRes = await fetch(`${baseUrl}/reservations/${resCId}/checkout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenC}` },
  });
  const coCData = await coCRes.json();
  console.log('User C checkout status:', coCRes.status, coCData);

  const pass5 =
    coCRes.status === 409 &&
    coCData.error?.code === 'HOLD_LOST';
  console.log('Test 5:', pass5 ? 'PASS' : 'FAIL');

  // -------------------------------------------------------------
  // Test 6: confirm-mock -> 200 CONFIRMED, booking_seats created, ticketCodes present
  // -------------------------------------------------------------
  console.log('\n--- Test 6: confirm-mock -> 200 CONFIRMED ---');
  const confirmRes = await fetch(`${baseUrl}/bookings/${co1.booking.id}/confirm-mock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const confirmData = await confirmRes.json();
  console.log('Confirm status:', confirmRes.status);
  console.log('Confirmed booking:', confirmData.booking);

  const dbSeatsAfterConfirm = await pgClient.query('SELECT status, booking_id, reservation_id, held_until FROM show_seats WHERE id = ANY($1::uuid[])', [[allSeats[0].id, allSeats[1].id]]);
  const dbTickets = await pgClient.query('SELECT id, ticket_code, released_at FROM booking_seats WHERE booking_id = $1', [co1.booking.id]);
  const dbResAfterConfirm = await pgClient.query('SELECT status FROM reservations WHERE id = $1', [res1Id]);
  const mapAfterConfirm = await (await fetch(`${baseUrl}/shows/${show.id}/seats`)).json();
  const seat0Status = mapAfterConfirm.sections[0].rows[0].seats.find(s => s.id === allSeats[0].id)?.status;

  const pass6 =
    confirmRes.status === 200 &&
    confirmData.booking.status === 'CONFIRMED' &&
    confirmData.booking.confirmedAt !== null &&
    confirmData.booking.seats.every(s => typeof s.ticketCode === 'string' && s.ticketCode.length > 0) &&
    dbSeatsAfterConfirm.rows.every(r => r.status === 'BOOKED' && r.booking_id === co1.booking.id && r.reservation_id === null && r.held_until === null) &&
    dbTickets.rowCount === 2 &&
    dbResAfterConfirm.rows[0].status === 'CONFIRMED' &&
    seat0Status === 'BOOKED';
  console.log('Test 6:', pass6 ? 'PASS' : 'FAIL');

  // -------------------------------------------------------------
  // Test 7: confirm-mock again -> 200 same result, no extra rows
  // -------------------------------------------------------------
  console.log('\n--- Test 7: confirm-mock again (idempotent replay) ---');
  const confirmAgainRes = await fetch(`${baseUrl}/bookings/${co1.booking.id}/confirm-mock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const confirmAgainData = await confirmAgainRes.json();
  console.log('Confirm again status:', confirmAgainRes.status);

  const dbTicketsAgain = await pgClient.query('SELECT count(*)::int as count FROM booking_seats WHERE booking_id = $1', [co1.booking.id]);
  const pass7 =
    confirmAgainRes.status === 200 &&
    confirmAgainData.booking.id === co1.booking.id &&
    confirmAgainData.booking.status === 'CONFIRMED' &&
    dbTicketsAgain.rows[0].count === 2;
  console.log('Test 7:', pass7 ? 'PASS' : 'FAIL');

  // -------------------------------------------------------------
  // Test 8: Another user tries to hold one of those booked seats -> 409 SEATS_UNAVAILABLE
  // -------------------------------------------------------------
  console.log('\n--- Test 8: Another user holds booked seat -> 409 SEATS_UNAVAILABLE ---');
  const holdBookedRes = await fetch(`${baseUrl}/shows/${show.id}/reservations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenB}`,
      'Idempotency-Key': 't8-hold-booked',
    },
    body: JSON.stringify({ seatIds: [allSeats[0].id] }),
  });
  const holdBookedData = await holdBookedRes.json();
  console.log('Hold booked seat status:', holdBookedRes.status, holdBookedData);
  const pass8 =
    holdBookedRes.status === 409 &&
    holdBookedData.error?.code === 'SEATS_UNAVAILABLE';
  console.log('Test 8:', pass8 ? 'PASS' : 'FAIL');

  // -------------------------------------------------------------
  // Test 9: confirm-mock after hold expired -> 409 HOLD_LOST and nothing modified
  // -------------------------------------------------------------
  console.log('\n--- Test 9: confirm-mock after hold expired -> 409 HOLD_LOST ---');
  // User C holds seat 4, checks out
  const holdC2Res = await fetch(`${baseUrl}/shows/${show.id}/reservations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenC}`,
      'Idempotency-Key': 't9-hold-key',
    },
    body: JSON.stringify({ seatIds: [allSeats[4].id] }),
  });
  const holdC2 = await holdC2Res.json();
  const resC2Id = holdC2.reservation.id;

  const coC2Res = await fetch(`${baseUrl}/reservations/${resC2Id}/checkout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenC}` },
  });
  const coC2 = await coC2Res.json();
  const bC2Id = coC2.booking.id;

  // Push reservation expires_at and held_until into past
  await pgClient.query(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [resC2Id]);
  await pgClient.query(`UPDATE show_seats SET held_until = now() - interval '1 minute' WHERE id = $1`, [allSeats[4].id]);

  const confirmExpiredRes = await fetch(`${baseUrl}/bookings/${bC2Id}/confirm-mock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenC}` },
  });
  const confirmExpiredData = await confirmExpiredRes.json();
  console.log('Confirm expired hold status:', confirmExpiredRes.status, confirmExpiredData);

  const bC2Db = await pgClient.query('SELECT status FROM bookings WHERE id = $1', [bC2Id]);
  const seat4Db = await pgClient.query('SELECT status FROM show_seats WHERE id = $1', [allSeats[4].id]);

  const pass9 =
    confirmExpiredRes.status === 409 &&
    confirmExpiredData.error?.code === 'HOLD_LOST' &&
    bC2Db.rows[0].status === 'PENDING_PAYMENT' &&
    seat4Db.rows[0].status === 'HELD';
  console.log('Test 9:', pass9 ? 'PASS' : 'FAIL');

  // -------------------------------------------------------------
  // Test 11: GET /bookings/mine shows booking; ticketCode present only when CONFIRMED; other user gets 404
  // -------------------------------------------------------------
  console.log('\n--- Test 11: GET /bookings/mine and GET /bookings/:id ---');
  const myBookingsRes = await fetch(`${baseUrl}/bookings/mine`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const myBookings = await myBookingsRes.json();
  console.log('GET /bookings/mine count:', myBookings.bookings.length);
  console.log('Sample booking in list:', myBookings.bookings[0]);

  // Check ticketCode is present on confirmed booking
  const hasTicketCodes = myBookings.bookings[0].seats.every(s => typeof s.ticketCode === 'string');

  // User B tries to GET User A's booking -> 404
  const otherGetRes = await fetch(`${baseUrl}/bookings/${co1.booking.id}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  console.log('User B gets User A booking status:', otherGetRes.status);

  const pass11 =
    myBookingsRes.status === 200 &&
    myBookings.bookings.length >= 1 &&
    hasTicketCodes &&
    otherGetRes.status === 404;
  console.log('Test 11:', pass11 ? 'PASS' : 'FAIL');

  // -------------------------------------------------------------
  // Test 12: DELETE reservation with pending booking -> 204, booking CANCELLED, seats AVAILABLE; DELETE confirmed -> 409
  // -------------------------------------------------------------
  console.log('\n--- Test 12: DELETE pending booking vs confirmed ---');
  // User C holds seat 5, checks out
  const holdC3Res = await fetch(`${baseUrl}/shows/${show.id}/reservations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenC}`,
      'Idempotency-Key': 't12-hold-key',
    },
    body: JSON.stringify({ seatIds: [allSeats[5].id] }),
  });
  const holdC3 = await holdC3Res.json();
  const resC3Id = holdC3.reservation.id;

  const coC3Res = await fetch(`${baseUrl}/reservations/${resC3Id}/checkout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenC}` },
  });
  const coC3 = await coC3Res.json();
  const bC3Id = coC3.booking.id;

  // DELETE pending reservation -> 204
  const delPendingRes = await fetch(`${baseUrl}/reservations/${resC3Id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenC}` },
  });
  console.log('Delete pending reservation status:', delPendingRes.status);

  const bC3Db = await pgClient.query('SELECT status, cancelled_at FROM bookings WHERE id = $1', [bC3Id]);
  const seat5Db = await pgClient.query('SELECT status, reservation_id FROM show_seats WHERE id = $1', [allSeats[5].id]);
  console.log('Booking after delete:', bC3Db.rows[0]);
  console.log('Seat 5 after delete:', seat5Db.rows[0]);

  // DELETE confirmed reservation -> 409
  const delConfirmedRes = await fetch(`${baseUrl}/reservations/${res1Id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  console.log('Delete confirmed reservation status:', delConfirmedRes.status);

  const pass12 =
    delPendingRes.status === 204 &&
    bC3Db.rows[0].status === 'CANCELLED' &&
    bC3Db.rows[0].cancelled_at !== null &&
    seat5Db.rows[0].status === 'AVAILABLE' &&
    seat5Db.rows[0].reservation_id === null &&
    delConfirmedRes.status === 409;
  console.log('Test 12:', pass12 ? 'PASS' : 'FAIL');

  console.log('\n========================================');
  console.log(`Test 1: ${pass1 ? 'PASS' : 'FAIL'}`);
  console.log(`Test 2: ${pass2 ? 'PASS' : 'FAIL'}`);
  console.log(`Test 3: ${pass3 ? 'PASS' : 'FAIL'}`);
  console.log(`Test 4: ${pass4 ? 'PASS' : 'FAIL'}`);
  console.log(`Test 5: ${pass5 ? 'PASS' : 'FAIL'}`);
  console.log(`Test 6: ${pass6 ? 'PASS' : 'FAIL'}`);
  console.log(`Test 7: ${pass7 ? 'PASS' : 'FAIL'}`);
  console.log(`Test 8: ${pass8 ? 'PASS' : 'FAIL'}`);
  console.log(`Test 9: ${pass9 ? 'PASS' : 'FAIL'}`);
  console.log(`Test 11: ${pass11 ? 'PASS' : 'FAIL'}`);
  console.log(`Test 12: ${pass12 ? 'PASS' : 'FAIL'}`);
  console.log('========================================');

  await pgClient.end();
}

main().catch(console.error);
