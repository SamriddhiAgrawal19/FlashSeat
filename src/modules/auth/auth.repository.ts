import { PoolClient } from 'pg';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: Date;
  updated_at: Date;
}

/** The public user shape (register's user, never password_hash) plus the organizer's organization name. */
export interface MeRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  organization_name: string | null;
}

export interface RefreshTokenLockRow {
  id: string;
  user_id: string;
  is_revoked: boolean;
  is_expired: boolean;
}

export async function createUser(client: PoolClient, name: string, email: string, passwordHash: string, role: string): Promise<UserRow> {
  const result = await client.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, email, passwordHash, role]
  );
  return result.rows[0];
}

export async function createOrganizerProfile(client: PoolClient, userId: string, organizationName: string): Promise<void> {
  await client.query(
    'INSERT INTO organizer_profiles (user_id, organization_name) VALUES ($1, $2)',
    [userId, organizationName]
  );
}

// includeInactive: only the registration duplicate-email pre-check needs to see
// deactivated accounts (an existing email is taken regardless of is_active);
// every login-style lookup must only find active users.
export async function findUserByEmail(client: PoolClient, email: string, includeInactive = false): Promise<UserRow | null> {
  const result = await client.query(
    `SELECT * FROM users WHERE email = $1 ${includeInactive ? '' : 'AND is_active = true'}`,
    [email]
  );
  return result.rows[0] || null;
}

export async function findUserById(client: PoolClient, id: string): Promise<UserRow | null> {
  const result = await client.query('SELECT * FROM users WHERE id = $1 AND is_active = true', [id]);
  return result.rows[0] || null;
}

// Lists columns explicitly so password_hash can never leak. Inactive users are returned too:
// the service decides how to reject them.
export async function findMeById(client: PoolClient, id: string): Promise<MeRow | null> {
  const result = await client.query<MeRow>(
    `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.updated_at, op.organization_name
       FROM users u
       LEFT JOIN organizer_profiles op ON op.user_id = u.id
      WHERE u.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

// expires_at is built from the DB clock (make_interval), never a JS Date.
export async function createRefreshToken(client: PoolClient, tokenHash: string, userId: string, expiryDays: number): Promise<void> {
  await client.query(
    `INSERT INTO refresh_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [tokenHash, userId, expiryDays]
  );
}

// FOR UPDATE serializes concurrent refreshes of the same token so rotation has
// exactly one winner. The row is returned regardless of status so the caller can
// tell "reused (revoked)" apart from "unknown token".
export async function lookupRefreshTokenForUpdate(client: PoolClient, tokenHash: string): Promise<RefreshTokenLockRow | null> {
  const result = await client.query<RefreshTokenLockRow>(
    `SELECT id, user_id, revoked_at IS NOT NULL AS is_revoked, expires_at <= now() AS is_expired
       FROM refresh_tokens
      WHERE token_hash = $1
        FOR UPDATE`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function revokeRefreshToken(client: PoolClient, tokenHash: string): Promise<void> {
  await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [tokenHash]);
}

// Deterministic id order so concurrent revocations of one user's tokens cannot
// deadlock each other on the row locks.
export async function revokeAllRefreshTokensForUser(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE id IN (SELECT id FROM refresh_tokens
                    WHERE user_id = $1 AND revoked_at IS NULL
                    ORDER BY id FOR UPDATE)`,
    [userId]
  );
}
