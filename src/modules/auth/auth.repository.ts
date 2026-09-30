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

export interface RefreshTokenRow {
  token_hash: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
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

export async function findUserByEmail(client: PoolClient, email: string): Promise<UserRow | null> {
  const result = await client.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

export async function findUserById(client: PoolClient, id: string): Promise<UserRow | null> {
  const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function createRefreshToken(client: PoolClient, tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
  await client.query(
    'INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [tokenHash, userId, expiresAt]
  );
}

export async function findRefreshTokenByHash(client: PoolClient, tokenHash: string): Promise<RefreshTokenRow | null> {
  const result = await client.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  return result.rows[0] || null;
}

export async function revokeRefreshToken(client: PoolClient, tokenHash: string): Promise<void> {
  await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [tokenHash]);
}

export async function revokeAllRefreshTokensForUser(client: PoolClient, userId: string): Promise<void> {
  await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1', [userId]);
}
