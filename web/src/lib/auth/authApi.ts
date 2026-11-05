import { request } from '../api';
import type { Role } from './jwt';

// Shapes from src/modules/auth/auth.schema.ts and auth.controller.ts.

export type RegisterRole = Extract<Role, 'ATTENDEE' | 'ORGANIZER'>;

/** POST /auth/register body. organization_name is required when role is ORGANIZER. */
export interface RegisterBody {
  name: string;
  email: string;
  password: string;
  role: RegisterRole;
  organization_name?: string;
}

/** The user row returned by register (password_hash removed). */
export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** 201 { user, accessToken } plus the refreshToken cookie. */
export function registerRequest(body: RegisterBody): Promise<{ user: RegisteredUser; accessToken: string }> {
  return request('/auth/register', { method: 'POST', body });
}

/** 200 { accessToken } plus the refreshToken cookie. 401 INVALID_CREDENTIALS, 429 RATE_LIMITED. */
export function loginRequest(email: string, password: string): Promise<{ accessToken: string }> {
  return request('/auth/login', { method: 'POST', body: { email, password } });
}

/** Rules mirrored from registerSchema/loginSchema so the form can check before submitting. */
export const PASSWORD_MIN_LENGTH = 8;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
