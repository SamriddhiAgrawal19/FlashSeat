const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SHOW_ID = process.env.SHOW_ID;
const SEAT_MAP_CACHE_TTL_MS = Number(process.env.SEAT_MAP_CACHE_TTL_MS) || 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!SHOW_ID) {
  console.error('ERROR: SHOW_ID environment variable is required.');
  console.error('Usage: BASE_URL=http://localhost:3000 SHOW_ID=<uuid> node scripts/smoke-checkout.mjs');
  process.exit(1);
}

function printHistogram(statusCodes, label = 'Status code histogram') {
  const counts = {};
  for (const code of statusCodes) {
    counts[code] = (counts[code] || 0) + 1;
  }
  console.log(`${label}:`, counts);
  return counts;
}

async function registerUser(namePrefix) {
  const email = `${namePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: namePrefix,
      email,
      password: 'Passw0rd!123',
      role: 'ATTENDEE',
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to register user: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return { id: data.user.id, token: data.accessToken, email };
}

async function main() {
  console.log(`Connecting to ${BASE_URL} for show ${SHOW_ID}...`);

  // Check seat map availability
  const seatMapRes = await fetch(`${BASE_URL}/shows/${SHOW_ID}/seats`);
  if (!seatMapRes.ok) {
    throw new Error(`Failed to fetch seat map: ${seatMapRes.status} ${await seatMapRes.text()}`);
  }
  const seatMap = await seatMapRes.json();
  const allSeats = seatMap.sections.flatMap((s) => s.rows.flatMap((r) => r.seats));
  const availableSeats = allSeats.filter((s) => s.status === 'AVAILABLE');

  if (availableSeats.length < 25) {
    console.error(`ABORTING: Need at least 25 available seats for smoke:checkout, but found only ${availableSeats.length}. Please use a fresh show.`);
    process.exit(1);
  }
  console.log(`Found ${availableSeats.length} available seats.`);

  // -------------------------------------------------------------
  // Scenario A (checkout race): one user holds 2 seats, then 10 parallel checkout calls
  // -------------------------------------------------------------
  console.log('\n--- Scenario A (Checkout race): 1 user, 2 seats, 10 parallel checkouts ---');
  const userA = await registerUser('buyer_scenA');
  const seatsA = [availableSeats[0].id, availableSeats[1].id];

  const holdRes = await fetch(`${BASE_URL}/shows/${SHOW_ID}/reservations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userA.token}`,
      'Idempotency-Key': `scenA-hold-${Date.now()}`,
    },
    body: JSON.stringify({ seatIds: seatsA }),
  });
  if (!holdRes.ok) {
    throw new Error(`Failed to hold seats for Scenario A: ${holdRes.status} ${await holdRes.text()}`);
  }
  const holdData = await holdRes.json();
  const reservationIdA = holdData.reservation.id;

  // 10 parallel checkouts
  const checkoutRequests = Array.from({ length: 10 }, () =>
    fetch(`${BASE_URL}/reservations/${reservationIdA}/checkout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userA.token}` },
    }).then(async (res) => ({
      status: res.status,
      body: await res.json().catch(() => null),
    }))
  );

  const checkoutResults = await Promise.all(checkoutRequests);
  const checkoutCodes = checkoutResults.map((r) => r.status);
  const checkoutHisto = printHistogram(checkoutCodes, 'Checkout status codes');

  const bookingIdsA = new Set(checkoutResults.map((r) => r.body?.booking?.id).filter(Boolean));
  console.log('Unique booking IDs from parallel checkout:', Array.from(bookingIdsA));

  const count201 = checkoutHisto[201] || 0;
  const count200 = checkoutHisto[200] || 0;
  const scenAPass =
    count201 === 1 &&
    count200 === 9 &&
    bookingIdsA.size === 1 &&
    !checkoutCodes.some((c) => c >= 400);

  console.log(`Scenario A: ${scenAPass ? 'PASS' : 'FAIL'}`);

  // -------------------------------------------------------------
  // Scenario B (confirm race): 10 parallel confirm-mock on that booking
  // -------------------------------------------------------------
  console.log('\n--- Scenario B (Confirm race): 10 parallel confirm-mock calls ---');
  const bookingIdA = Array.from(bookingIdsA)[0];

  const confirmRequests = Array.from({ length: 10 }, () =>
    fetch(`${BASE_URL}/bookings/${bookingIdA}/confirm-mock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userA.token}` },
    }).then(async (res) => ({
      status: res.status,
      body: await res.json().catch(() => null),
    }))
  );

  const confirmResults = await Promise.all(confirmRequests);
  const confirmCodes = confirmResults.map((r) => r.status);
  const confirmHisto = printHistogram(confirmCodes, 'Confirm status codes');

  const allConfirmed = confirmResults.every(
    (r) => r.status === 200 && r.body?.booking?.status === 'CONFIRMED'
  );
  const confirmBookingIds = new Set(confirmResults.map((r) => r.body?.booking?.id).filter(Boolean));

  // Check seat map for those 2 seats. ENABLE_SEAT_MAP_CACHE: wait past the
  // documented staleness window instead of racing a cache entry warmed by
  // the initial availability check above.
  await sleep(SEAT_MAP_CACHE_TTL_MS + 250);
  const mapAfterConfirm = await (await fetch(`${BASE_URL}/shows/${SHOW_ID}/seats`)).json();
  const mapSeatsA = mapAfterConfirm.sections
    .flatMap((s) => s.rows.flatMap((r) => r.seats))
    .filter((s) => seatsA.includes(s.id));
  const seatsAreBooked = mapSeatsA.every((s) => s.status === 'BOOKED');

  const scenBPass =
    confirmHisto[200] === 10 &&
    allConfirmed &&
    confirmBookingIds.size === 1 &&
    seatsAreBooked;

  console.log(`Seats in seat map are BOOKED: ${seatsAreBooked}`);
  console.log(`Scenario B: ${scenBPass ? 'PASS' : 'FAIL'}`);

  // -------------------------------------------------------------
  // Scenario C (confirm vs release race): 20 rounds of confirm-mock vs DELETE
  // -------------------------------------------------------------
  console.log('\n--- Scenario C (Confirm vs Release race): 20 rounds ---');
  let scenCPass = true;
  const scenCConfirmCodes = [];
  const scenCDeleteCodes = [];

  for (let round = 0; round < 20; round++) {
    const seatId = availableSeats[2 + round].id;
    const user = await registerUser(`user_scenC_${round}`);

    // Hold 1 seat
    const hRes = await fetch(`${BASE_URL}/shows/${SHOW_ID}/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.token}`,
        'Idempotency-Key': `scenC-hold-${round}-${Date.now()}`,
      },
      body: JSON.stringify({ seatIds: [seatId] }),
    });
    if (!hRes.ok) {
      console.error(`Round ${round} hold failed: ${hRes.status}`);
      scenCPass = false;
      break;
    }
    const hData = await hRes.json();
    const resId = hData.reservation.id;

    // Checkout
    const cRes = await fetch(`${BASE_URL}/reservations/${resId}/checkout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}` },
    });
    if (!cRes.ok) {
      console.error(`Round ${round} checkout failed: ${cRes.status}`);
      scenCPass = false;
      break;
    }
    const cData = await cRes.json();
    const bId = cData.booking.id;

    // Race confirm-mock vs DELETE
    const [cResult, dResult] = await Promise.all([
      fetch(`${BASE_URL}/bookings/${bId}/confirm-mock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.token}` },
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
      fetch(`${BASE_URL}/reservations/${resId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${user.token}` },
      }).then(async (r) => ({ status: r.status })),
    ]);

    scenCConfirmCodes.push(cResult.status);
    scenCDeleteCodes.push(dResult.status);

    // Valid outcome: (confirm 200 and delete 409) OR (delete 204 and confirm 409)
    const outcome1 = cResult.status === 200 && dResult.status === 409;
    const outcome2 = cResult.status === 409 && dResult.status === 204;

    if (!outcome1 && !outcome2) {
      console.error(`Round ${round} invalid outcome: confirm=${cResult.status}, delete=${dResult.status}`);
      scenCPass = false;
    }

    // Verify consistency:
    const bCheck = await (
      await fetch(`${BASE_URL}/bookings/${bId}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      })
    ).json();

    // ENABLE_SEAT_MAP_CACHE: wait past the documented staleness window instead
    // of racing a cache entry warmed by an earlier read of this show's map.
    await sleep(SEAT_MAP_CACHE_TTL_MS + 250);
    const currentMap = await (await fetch(`${BASE_URL}/shows/${SHOW_ID}/seats`)).json();
    const currentSeat = currentMap.sections
      .flatMap((s) => s.rows.flatMap((r) => r.seats))
      .find((s) => s.id === seatId);

    if (bCheck.booking.status === 'CONFIRMED' && currentSeat.status !== 'BOOKED') {
      console.error(`Round ${round} consistency failed: booking CONFIRMED but seat is ${currentSeat.status}`);
      scenCPass = false;
    }
    if (bCheck.booking.status === 'CANCELLED' && currentSeat.status !== 'AVAILABLE') {
      console.error(`Round ${round} consistency failed: booking CANCELLED but seat is ${currentSeat.status}`);
      scenCPass = false;
    }
  }

  printHistogram(scenCConfirmCodes, 'Confirm statuses across 20 rounds');
  printHistogram(scenCDeleteCodes, 'Delete statuses across 20 rounds');
  console.log(`Scenario C: ${scenCPass ? 'PASS' : 'FAIL'}`);

  console.log('\n========================================');
  console.log(`Scenario A: ${scenAPass ? 'PASS' : 'FAIL'}`);
  console.log(`Scenario B: ${scenBPass ? 'PASS' : 'FAIL'}`);
  console.log(`Scenario C: ${scenCPass ? 'PASS' : 'FAIL'}`);
  console.log('========================================');

  if (!scenAPass || !scenBPass || !scenCPass) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during smoke:checkout:', err);
  process.exit(1);
});
