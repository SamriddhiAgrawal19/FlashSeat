import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../lib/api';
import { EMAIL_PATTERN } from '../../lib/auth/authApi';
import { fieldErrorsFrom } from '../../lib/auth/formErrors';
import { useAuth } from '../../lib/auth/useAuth';
import { describeNetworkOrRateLimit } from './FormParts';
import { FormAlert, PasswordField, SubmitButton, TextField } from './AuthFields';

type Field = 'email' | 'password';

function validate(email: string, password: string): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

/**
 * Log in. Same logic as before the redesign: on success the session becomes authenticated and
 * <GuestOnly> sends the user on (to a safe ?next, else by role).
 */
export function LoginForm({ initialEmail, signupLink }: { initialEmail: string; signupLink: ReactNode }) {
  const { login } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  // Arriving from "Log in instead?" with the email filled in: start on the password.
  useEffect(() => {
    if (initialEmail) passwordRef.current?.focus();
  }, [initialEmail]);

  // After a failed submit, move focus to the first problem: the form error, else the first bad field.
  useEffect(() => {
    if (attempt === 0) return;
    if (formError) alertRef.current?.focus();
    else if (errors.email) emailRef.current?.focus();
    else if (errors.password) passwordRef.current?.focus();
  }, [attempt, errors, formError]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const local = validate(email, password);
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (error) {
      const fieldErrors = fieldErrorsFrom(error);
      if (Object.keys(fieldErrors).length > 0) {
        setErrors({ email: fieldErrors.email, password: fieldErrors.password });
      } else if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        setFormError("That email and password don't match an account.");
      } else if (error instanceof ApiError) {
        setFormError(describeNetworkOrRateLimit(error.code, error.retryAfterSeconds) ?? error.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
      setBusy(false);
      setAttempt((n) => n + 1);
    }
  };

  return (
    <form noValidate onSubmit={onSubmit} className="au-form" aria-labelledby="login-title">
      <div className="au-head">
        <span className="site-eyebrow">Welcome back</span>
        <h1 id="login-title" className="au-h1">
          <span className="au-w">Your</span> <span className="au-w" style={{ animationDelay: '.06s' }}>seat</span>{' '}
          <span className="au-w" style={{ animationDelay: '.12s' }}>is</span>{' '}
          <span className="au-w site-serif" style={{ animationDelay: '.18s' }}>waiting.</span>
        </h1>
      </div>
      <TextField
        ref={emailRef}
        id="login-email"
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        required
      />
      <PasswordField
        ref={passwordRef}
        id="login-password"
        label="Password"
        name="password"
        autoComplete="current-password"
        placeholder="Your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        required
      />
      {formError && <FormAlert ref={alertRef}>{formError}</FormAlert>}
      <SubmitButton busy={busy} busyLabel="Logging in…">
        Log in
      </SubmitButton>
      <p className="au-foot">New to FlashSeat? {signupLink}</p>
    </form>
  );
}

/** A link that keeps the current query (?next=) and replaces the history entry. */
export function SwitchLink({ to, search, state, children }: { to: string; search: string; state?: unknown; children: ReactNode }) {
  return (
    <Link to={{ pathname: to, search }} replace state={state}>
      {children}
    </Link>
  );
}
