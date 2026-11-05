import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from './AuthProvider';

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** "Riya" from "Riya Sharma"; falls back to the email's local part, then "Account". */
export function displayName(user: { name?: string; email?: string }): string {
  const first = user.name?.trim().split(/\s+/)[0];
  if (first) return first;
  const local = user.email?.split('@')[0];
  return local || 'Account';
}

/** Two initials from the name ("RS"), else the first letter of the email. */
export function initials(user: { name?: string; email?: string }): string {
  const words = user.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length > 0) return words.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  return user.email?.charAt(0).toUpperCase() ?? '•';
}
