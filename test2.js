const http = require('http');

async function run() {
  const baseUrl = 'http://localhost:3000';

  async function post(path, body, token = '') {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });
    return { status: res.status, data: await res.json() };
  }

  async function patch(path, body, token = '') {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });
    return { status: res.status, data: await res.json() };
  }

  async function get(path, token = '') {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    });
    return { status: res.status, data: await res.json() };
  }

  // Set up Org A and Org B
  const orgA = (await post('/auth/register', { name: 'Org A', email: 'orga@example.com', password: 'password123', role: 'ORGANIZER', organization_name: 'Org A' })).data;
  const orgB = (await post('/auth/register', { name: 'Org B', email: 'orgb@example.com', password: 'password123', role: 'ORGANIZER', organization_name: 'Org B' })).data;
  const tokenA = orgA.accessToken;
  const tokenB = orgB.accessToken;

  console.log('1. Org A creates venue & bulk seats');
  const venueRes = await post('/venues', { name: 'Test Venue', address: '123 Main St', city: 'Test City' }, tokenA);
  const venueId = venueRes.data.id;
  await post(`/venues/${venueId}/seats/bulk`, { mode: 'GRID', section: 'MAIN', rows: ['A', 'B', 'C', 'D', 'E'], seatsPerRow: 10, category: 'REGULAR' }, tokenA);
  const myVenues = await get('/venues/mine', tokenA);
  console.log('GET /venues/mine:', myVenues.data.map(v => ({ id: v.id, seat_count: v.seat_count })));

  console.log('\n2. Org A creates event (DRAFT), publish fails (zero shows) -> 409');
  const eventRes = await post('/events', { title: 'Test Event', description: 'Desc', category: 'MUSIC' }, tokenA);
  const eventId = eventRes.data.id;
  const publishFail = await post(`/events/${eventId}/publish`, {}, tokenA);
  console.log('Publish zero shows:', publishFail.status, publishFail.data);

  console.log('\n3. Org A creates show -> publish succeeds');
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const endsAt = new Date(Date.now() + 86400000 + 7200000).toISOString();
  await post(`/events/${eventId}/shows`, {
    venueId, startsAt, endsAt, categoryPrices: [{ category: 'REGULAR', pricePaise: 10000 }]
  }, tokenA);
  const publishSuccess = await post(`/events/${eventId}/publish`, {}, tokenA);
  console.log('Publish after show:', publishSuccess.status, publishSuccess.data);

  console.log('\n4. Org A tries overlapping show at same venue -> 409');
  const overlapStartsAt = new Date(Date.now() + 86400000 + 3600000).toISOString();
  const overlapEndsAt = new Date(Date.now() + 86400000 + 10800000).toISOString();
  const overlapFail = await post(`/events/${eventId}/shows`, {
    venueId, startsAt: overlapStartsAt, endsAt: overlapEndsAt, categoryPrices: [{ category: 'REGULAR', pricePaise: 10000 }]
  }, tokenA);
  console.log('Overlapping show:', overlapFail.status, overlapFail.data);

  console.log('\n5. Org B tries to PATCH Org A event -> 404');
  const patchFail = await patch(`/events/${eventId}`, { title: 'Hacked' }, tokenB);
  console.log('PATCH Org B -> Org A:', patchFail.status, patchFail.data);

  console.log('\n6. Unauthenticated GET /events returns only published events');
  const eventsList = await get('/events');
  console.log('List published events:', eventsList.status, eventsList.data.events.map(e => ({ id: e.id, title: e.title, status: e.status })));

  console.log('\n7. GET /events/:eventId for DRAFT event -> 404');
  const draftEventRes = await post('/events', { title: 'Draft Event', description: 'Desc', category: 'MUSIC' }, tokenA);
  const draftId = draftEventRes.data.id;
  const getDraftFail = await get(`/events/${draftId}`);
  console.log('GET draft event:', getDraftFail.status, getDraftFail.data);
}

run().catch(console.error);
