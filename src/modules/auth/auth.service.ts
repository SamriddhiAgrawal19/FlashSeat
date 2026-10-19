import { randomBytes, createHash } from 'crypto';
import { PoolClient } from 'pg';
import { env } from '../../config/env';
import { RegisterRequest, LoginRequest } from './auth.schema';
import * as repo from './auth.repository';
import { hashPassword, verifyPassword } from './password';
import { signAccessToken } from './jwt';

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// Helper to generate a random token and its hash
function generateRefreshToken() {
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

function getRefreshTokenExpiry() {
  const date = new Date();
  date.setDate(date.getDate() + env.REFRESH_TOKEN_EXPIRY_DAYS);
  return date;
}

export async function register(client: PoolClient, data: RegisterRequest) {
  const existingUser = await repo.findUserByEmail(client, data.email);
  if (existingUser) {
    throw new AuthError(409, 'Email already in use');
  }

  const hashed = await hashPassword(data.password);
  let user;
  try {
    user = await repo.createUser(client, data.name, data.email, hashed, data.role);
  } catch (err: any) {
    // Lost the registration race against a concurrent same-email register: report
    // exactly what the pre-check above reports so both paths look identical.
    if (err?.code === '23505' && err?.constraint === 'users_email_key') {
      throw new AuthError(409, 'Email already in use');
    }
    throw err;
  }

  if (data.role === 'ORGANIZER' && data.organization_name) {
    await repo.createOrganizerProfile(client, user.id, data.organization_name);
  }

  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  const { token: refreshToken, hash: refreshTokenHash } = generateRefreshToken();

  await repo.createRefreshToken(client, refreshTokenHash, user.id, getRefreshTokenExpiry());

  const { password_hash, ...userWithoutPassword } = user;
  return { user: userWithoutPassword, accessToken, refreshToken };
}

export async function login(client: PoolClient, data: LoginRequest) {
  const user = await repo.findUserByEmail(client, data.email);
  if (!user) {
    throw new AuthError(401, 'Invalid credentials');
  }

  const isValid = await verifyPassword(data.password, user.password_hash);
  if (!isValid) {
    throw new AuthError(401, 'Invalid credentials');
  }

  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  const { token: refreshToken, hash: refreshTokenHash } = generateRefreshToken();

  await repo.createRefreshToken(client, refreshTokenHash, user.id, getRefreshTokenExpiry());

  return { accessToken, refreshToken };
}

export async function refresh(client: PoolClient, oldRefreshToken: string) {
  const oldHash = createHash('sha256').update(oldRefreshToken).digest('hex');
  const tokenRow = await repo.findRefreshTokenByHash(client, oldHash);

  if (!tokenRow) {
    throw new AuthError(401, 'Invalid refresh token');
  }

  if (tokenRow.revoked_at !== null) {
    // A revoked token was used. This is a sign of token theft.
    // For now, we just reject it. A stricter version would revoke the whole token family
    // by revoking all tokens for this user.
    throw new AuthError(401, 'Invalid refresh token');
  }

  if (new Date() > tokenRow.expires_at) {
    throw new AuthError(401, 'Refresh token expired');
  }

  // Token is valid. Rotate it.
  await repo.revokeRefreshToken(client, oldHash);

  const user = await repo.findUserById(client, tokenRow.user_id);
  if (!user) {
    throw new AuthError(401, 'User no longer exists');
  }

  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  const { token: newRefreshToken, hash: newRefreshTokenHash } = generateRefreshToken();

  await repo.createRefreshToken(client, newRefreshTokenHash, user.id, getRefreshTokenExpiry());

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(client: PoolClient, refreshToken: string) {
  const hash = createHash('sha256').update(refreshToken).digest('hex');
  await repo.revokeRefreshToken(client, hash);
}
