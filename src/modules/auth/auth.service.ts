import { randomBytes, createHash } from 'crypto';
import { PoolClient } from 'pg';
import pino from 'pino';
import { withTransaction } from '../../db/pool';
import { env } from '../../config/env';
import { RegisterRequest, LoginRequest } from './auth.schema';
import * as repo from './auth.repository';
import { hashPassword, verifyPassword } from './password';
import { signAccessToken } from './jwt';
import { ConflictError, UnauthorizedError } from '../../utils/errors';

const logger = pino({ name: 'auth' });

// Hashed once at module load with the SAME hashPassword (argon2) as real passwords
// so the "unknown/inactive user" path costs the same as the real one — a timing
// oracle would otherwise reveal whether an email is registered.
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(32).toString('hex'));

function generateRefreshToken() {
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

async function issueTokenPair(client: PoolClient, userId: string, role: string) {
  const accessToken = signAccessToken({ userId, role });
  const { token: refreshToken, hash: refreshTokenHash } = generateRefreshToken();
  await repo.createRefreshToken(client, refreshTokenHash, userId, env.REFRESH_TOKEN_EXPIRY_DAYS);
  return { accessToken, refreshToken };
}

export async function register(client: PoolClient, data: RegisterRequest) {
  // The pre-check must see deactivated accounts too: the email is taken either way.
  const existingUser = await repo.findUserByEmail(client, data.email, true);
  if (existingUser) {
    throw new ConflictError('Email already in use', 'EMAIL_TAKEN');
  }

  const hashed = await hashPassword(data.password);
  let user;
  try {
    user = await repo.createUser(client, data.name, data.email, hashed, data.role);
  } catch (err: any) {
    // Lost the registration race against a concurrent same-email register: report
    // exactly the same error as the pre-check above.
    if (err?.code === '23505' && err?.constraint === 'users_email_key') {
      throw new ConflictError('Email already in use', 'EMAIL_TAKEN');
    }
    throw err;
  }

  if (data.role === 'ORGANIZER' && data.organization_name) {
    await repo.createOrganizerProfile(client, user.id, data.organization_name);
  }

  const tokens = await issueTokenPair(client, user.id, user.role);
  const { password_hash, ...userWithoutPassword } = user;
  return { user: userWithoutPassword, ...tokens };
}

export async function login(client: PoolClient, data: LoginRequest) {
  const user = await repo.findUserByEmail(client, data.email); // active users only

  // Same error and same cost for: wrong password, unknown email, inactive user.
  const isValid = await verifyPassword(data.password, user?.password_hash ?? (await DUMMY_PASSWORD_HASH));
  if (!user || !isValid) {
    throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
  }

  return issueTokenPair(client, user.id, user.role);
}

type RefreshOutcome =
  | { kind: 'ok'; tokens: { accessToken: string; refreshToken: string } }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'reuse'; userId: string };

export async function refresh(rawToken: string) {
  const oldHash = createHash('sha256').update(rawToken).digest('hex');

  // ONE transaction. The failure cases return an outcome instead of throwing:
  // theft containment (revoking all of a user's tokens) must COMMIT, and a throw
  // inside withTransaction would roll it back. The 401 is only raised after the
  // commit (below) so the security action survives the rejection.
  const outcome: RefreshOutcome = await withTransaction(async (client) => {
    const tokenRow = await repo.lookupRefreshTokenForUpdate(client, oldHash);
    if (!tokenRow) {
      return { kind: 'invalid' };
    }
    if (tokenRow.is_revoked) {
      // Reuse of a rotated/revoked token = theft or leak: contain it.
      await repo.revokeAllRefreshTokensForUser(client, tokenRow.user_id);
      return { kind: 'reuse', userId: tokenRow.user_id };
    }
    if (tokenRow.is_expired) {
      // Expiry is not theft: nothing else is revoked.
      return { kind: 'expired' };
    }
    const user = await repo.findUserById(client, tokenRow.user_id);
    if (!user) {
      await repo.revokeRefreshToken(client, oldHash);
      return { kind: 'invalid' };
    }
    await repo.revokeRefreshToken(client, oldHash);
    const tokens = await issueTokenPair(client, user.id, user.role);
    return { kind: 'ok', tokens };
  });

  if (outcome.kind === 'ok') {
    return outcome.tokens;
  }
  if (outcome.kind === 'reuse') {
    logger.warn({ userId: outcome.userId }, 'Refresh token reuse detected; revoked all of the user\'s tokens');
  }
  // The same 401 for every failure: the client must not learn which case it was.
  throw new UnauthorizedError('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
}

export async function logout(client: PoolClient, refreshToken: string) {
  const hash = createHash('sha256').update(refreshToken).digest('hex');
  await repo.revokeRefreshToken(client, hash);
}
