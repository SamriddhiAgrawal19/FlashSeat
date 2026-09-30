const http = require('http');

async function run() {
  const baseUrl = 'http://localhost:3000';

  async function post(path, body, cookie = '') {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { 'Cookie': cookie } : {})
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    const cookies = res.headers.get('set-cookie');
    return { status: res.status, data, cookies };
  }

  async function get(path, token) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  console.log('1. Register Attendee');
  const regAttendee = await post('/auth/register', {
    name: 'Attendee User',
    email: 'attendee@example.com',
    password: 'password123',
    role: 'ATTENDEE'
  });
  console.log('Register Attendee:', regAttendee.status, regAttendee.data);

  console.log('\n1. Register Organizer');
  const regOrganizer = await post('/auth/register', {
    name: 'Organizer User',
    email: 'organizer@example.com',
    password: 'password123',
    role: 'ORGANIZER',
    organization_name: 'Super Org'
  });
  console.log('Register Organizer:', regOrganizer.status, regOrganizer.data);

  console.log('\n1. Register Duplicate Email');
  const regDuplicate = await post('/auth/register', {
    name: 'Another',
    email: 'attendee@example.com',
    password: 'password123'
  });
  console.log('Register Duplicate:', regDuplicate.status, regDuplicate.data);

  console.log('\n2. Login Organizer');
  const loginRes = await post('/auth/login', {
    email: 'organizer@example.com',
    password: 'password123'
  });
  console.log('Login Organizer:', loginRes.status, loginRes.data);
  const orgToken = loginRes.data.accessToken;
  const refreshCookie = loginRes.cookies;
  console.log('Refresh Cookie:', refreshCookie);

  console.log('\n5. Protected Test - Organizer');
  const testOrg = await get('/protected-test', orgToken);
  console.log('Protected Test (Org):', testOrg.status, testOrg.data);

  console.log('\n5. Protected Test - Attendee');
  const testAttendee = await get('/protected-test', regAttendee.data.accessToken);
  console.log('Protected Test (Attendee):', testAttendee.status, testAttendee.data);

  console.log('\n3. Refresh');
  const refreshRes = await post('/auth/refresh', {}, refreshCookie);
  console.log('Refresh:', refreshRes.status, refreshRes.data);
  const newRefreshCookie = refreshRes.cookies;

  console.log('\n4. Logout');
  const logoutRes = await post('/auth/logout', {}, newRefreshCookie);
  console.log('Logout:', logoutRes.status, logoutRes.data);

  console.log('\n4. Refresh after logout');
  const refreshAfterLogout = await post('/auth/refresh', {}, newRefreshCookie);
  console.log('Refresh after logout:', refreshAfterLogout.status, refreshAfterLogout.data);
}

run().catch(console.error);
