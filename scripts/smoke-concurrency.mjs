const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SHOW_ID = process.env.SHOW_ID;

if (!SHOW_ID) {
  console.error('ERROR: SHOW_ID environment variable is required.');
  console.error('Usage: BASE_URL=http://localhost:3000 SHOW_ID=<uuid> node scripts/smoke-concurrency.mjs');
  process.exit(1);
}

function printHistogram(statusCodes) {
  const counts = {};
  for (const code of statusCodes) {
    counts[code] = (counts[code] || 0) + 1;
  }
  console.log('Status code histogram:', counts);
  return counts;
}

async function main() {
  console.log(`Connecting to ${BASE_URL} for show ${SHOW_ID}...`);

  // 1. Register N=20 fresh attendee users
  console.log('Registering 20 fresh attendee users...');
  const users = [];
  for (let i = 0; i < 20; i++) {
    const email = `attendee_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}@example.com`;
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Attendee ${i}`,
        email,
        password: 'Passw0rd!123',
        role: 'ATTENDEE',
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to register user ${i}: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    users.push({ id: data.user.id, token: data.accessToken, email });
  }
  console.log('20 users registered successfully.');

  // 2. Fetch seat map to get available seat ids
  const seatMapRes = await fetch(`${BASE_URL}/shows/${SHOW_ID}/seats`);
  if (!seatMapRes.ok) {
    throw new Error(`Failed to fetch seat map: ${seatMapRes.status} ${await seatMapRes.text()}`);
  }
  const seatMap = await seatMapRes.json();
  const allSeats = seatMap.sections.flatMap((s) => s.rows.flatMap((r) => r.seats));
  const availableSeats = allSeats.filter((s) => s.status === 'AVAILABLE');

  if (availableSeats.length < 3) {
    throw new Error(`Need at least 3 available seats for concurrency tests, found ${availableSeats.length}`);
  }
  console.log(`Found ${availableSeats.length} available seats.`);

  // ---------------------------------------------------------
  // Scenario 1 (contention): 20 users request the SAME single seat
  // ---------------------------------------------------------
  console.log('\n--- Scenario 1 (Contention): 20 users requesting the SAME single seat ---');
  const targetSeatId = availableSeats[0].id;
  const scen1Requests = users.map((u, i) =>
    fetch(`${BASE_URL}/shows/${SHOW_ID}/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${u.token}`,
        'Idempotency-Key': `scen1-${Date.now()}-u${i}-${Math.random().toString(36).slice(2, 10)}`,
      },
      body: JSON.stringify({ seatIds: [targetSeatId] }),
    }).then(async (res) => ({
      status: res.status,
      body: await res.json().catch(() => null),
      user: u,
    }))
  );

  const scen1Results = await Promise.all(scen1Requests);
  const scen1Codes = scen1Results.map((r) => r.status);
  const scen1Histo = printHistogram(scen1Codes);

  const scen1Pass =
    scen1Histo[201] === 1 &&
    scen1Histo[409] === 19 &&
    !scen1Codes.some((c) => c >= 500);

  console.log(`Scenario 1: ${scen1Pass ? 'PASS' : 'FAIL'}`);

  // Winner releases via DELETE
  const scen1Winner = scen1Results.find((r) => r.status === 201);
  if (scen1Winner?.body?.reservation?.id) {
    const delRes = await fetch(`${BASE_URL}/reservations/${scen1Winner.body.reservation.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${scen1Winner.user.token}` },
    });
    if (delRes.status !== 204) {
      console.warn(`Warning: winner release returned status ${delRes.status}`);
    }
  }

  // ---------------------------------------------------------
  // Scenario 2 (deadlock check): 30 rounds of [A,B,C] vs [C,B,A]
  // ---------------------------------------------------------
  console.log('\n--- Scenario 2 (Deadlock check): 30 rounds of [A,B,C] vs [C,B,A] ---');
  const seatsABC = [availableSeats[0].id, availableSeats[1].id, availableSeats[2].id];
  const seatsCBA = [availableSeats[2].id, availableSeats[1].id, availableSeats[0].id];

  let scen2AllRoundsPass = true;
  const scen2AllCodes = [];

  for (let round = 1; round <= 30; round++) {
    // RATE_LIMIT_RESERVATION_USER_LIMIT caps hold() calls per user per window;
    // 30 rounds on one fixed pair would exceed it, so each round draws from
    // the pool of 20 already-registered users instead of reusing users[0/1].
    const user1 = users[(round - 1) % users.length];
    const user2 = users[(round - 1 + 10) % users.length];
    const req1 = fetch(`${BASE_URL}/shows/${SHOW_ID}/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1.token}`,
        'Idempotency-Key': `scen2-r${round}-u1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
      body: JSON.stringify({ seatIds: seatsABC }),
    }).then(async (res) => ({
      user: user1,
      status: res.status,
      body: await res.json().catch(() => null),
    }));

    const req2 = fetch(`${BASE_URL}/shows/${SHOW_ID}/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user2.token}`,
        'Idempotency-Key': `scen2-r${round}-u2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
      body: JSON.stringify({ seatIds: seatsCBA }),
    }).then(async (res) => ({
      user: user2,
      status: res.status,
      body: await res.json().catch(() => null),
    }));

    const roundResults = await Promise.all([req1, req2]);
    const roundCodes = roundResults.map((r) => r.status);
    scen2AllCodes.push(...roundCodes);

    const hasOne201 = roundCodes.filter((c) => c === 201).length === 1;
    const hasOne409 = roundCodes.filter((c) => c === 409).length === 1;
    const hasNo5xx = !roundCodes.some((c) => c >= 500);

    if (!hasOne201 || !hasOne409 || !hasNo5xx) {
      scen2AllRoundsPass = false;
      console.error(`Round ${round} failed: codes =`, roundCodes);
    }

    // Release winner
    const roundWinner = roundResults.find((r) => r.status === 201);
    if (roundWinner?.body?.reservation?.id) {
      await fetch(`${BASE_URL}/reservations/${roundWinner.body.reservation.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${roundWinner.user.token}` },
      });
    }
  }

  printHistogram(scen2AllCodes);
  console.log(`Scenario 2: ${scen2AllRoundsPass ? 'PASS' : 'FAIL'}`);

  // ---------------------------------------------------------
  // Scenario 3 (idempotency race): 10 identical requests concurrently
  // ---------------------------------------------------------
  console.log('\n--- Scenario 3 (Idempotency race): 10 identical requests in parallel ---');
  const userForRace = users[2];
  const sameKey = `scen3-idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const seatsForRace = [availableSeats[0].id, availableSeats[1].id];

  const scen3Requests = Array.from({ length: 10 }, () =>
    fetch(`${BASE_URL}/shows/${SHOW_ID}/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userForRace.token}`,
        'Idempotency-Key': sameKey,
      },
      body: JSON.stringify({ seatIds: seatsForRace }),
    }).then(async (res) => ({
      status: res.status,
      body: await res.json().catch(() => null),
    }))
  );

  const scen3Results = await Promise.all(scen3Requests);
  const scen3Codes = scen3Results.map((r) => r.status);
  printHistogram(scen3Codes);

  const reservationIds = new Set(
    scen3Results.map((r) => r.body?.reservation?.id).filter(Boolean)
  );

  console.log('Unique reservation IDs received:', Array.from(reservationIds));

  const allSuccessful = scen3Codes.every((c) => c === 200 || c === 201);
  const hasAtLeastOne201 = scen3Codes.includes(201);
  const singleReservationId = reservationIds.size === 1;

  const scen3Pass = allSuccessful && hasAtLeastOne201 && singleReservationId;
  console.log(`Scenario 3: ${scen3Pass ? 'PASS' : 'FAIL'}`);

  // Cleanup winner hold
  const anyWinnerId = Array.from(reservationIds)[0];
  if (anyWinnerId) {
    await fetch(`${BASE_URL}/reservations/${anyWinnerId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userForRace.token}` },
    });
  }

  // Summary
  console.log('\n========================================');
  console.log(`Scenario 1: ${scen1Pass ? 'PASS' : 'FAIL'}`);
  console.log(`Scenario 2: ${scen2AllRoundsPass ? 'PASS' : 'FAIL'}`);
  console.log(`Scenario 3: ${scen3Pass ? 'PASS' : 'FAIL'}`);
  console.log('========================================');

  if (!scen1Pass || !scen2AllRoundsPass || !scen3Pass) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during smoke test:', err);
  process.exit(1);
});
