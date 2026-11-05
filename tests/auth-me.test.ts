/**
 * GET /auth/me: the current user, read fresh from the database.
 */
import { describe, expect, it } from 'vitest';
import { api, deactivateUser, hasErrorShape, register } from './helpers';

const USER_KEYS = ['created_at', 'email', 'id', 'is_active', 'name', 'organization_name', 'role', 'updated_at'];

describe('GET /auth/me', () => {
  it('returns the logged-in attendee (register user shape + organization_name null)', async () => {
    const u = await register('me_att');
    const res = await api('GET', '/auth/me', { token: u.token });
    expect(res.status).toBe(200);
    expect(Object.keys(res.data.user).sort()).toEqual(USER_KEYS);
    expect(res.data.user).toMatchObject({ id: u.id, name: u.body.name, email: u.body.email, role: 'ATTENDEE', is_active: true, organization_name: null });
  });

  it('includes organization_name for an organizer', async () => {
    const org = await register('me_org', { role: 'ORGANIZER' });
    const res = await api('GET', '/auth/me', { token: org.token });
    expect(res.status).toBe(200);
    expect(res.data.user.role).toBe('ORGANIZER');
    expect(res.data.user.organization_name).toBe(org.body.organization_name);
  });

  it('never returns password_hash', async () => {
    const u = await register('me_pw');
    const res = await api('GET', '/auth/me', { token: u.token });
    expect(res.status).toBe(200);
    expect(res.bodyText).not.toContain('password');
  });

  it('no token => 401 UNAUTHORIZED', async () => {
    const res = await api('GET', '/auth/me');
    expect(res.status).toBe(401);
    expect(hasErrorShape(res.data)).toBe(true);
    expect(res.data.error.code).toBe('UNAUTHORIZED');
  });

  it('deactivated user with a still-valid token => 401 INVALID_TOKEN', async () => {
    const u = await register('me_off');
    await deactivateUser(u.id);
    const res = await api('GET', '/auth/me', { token: u.token });
    expect(res.status).toBe(401);
    expect(hasErrorShape(res.data)).toBe(true);
    expect(res.data.error.code).toBe('INVALID_TOKEN');
  });
});
