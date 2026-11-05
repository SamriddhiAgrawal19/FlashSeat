import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AuthLayout } from '../components/auth/AuthLayout';
import { TextField } from '../components/auth/FormField';
import { describeNetworkOrRateLimit, FormAlert, SubmitButton } from '../components/auth/FormParts';
import { PasswordInput } from '../components/auth/PasswordInput';
import { ApiError } from '../lib/api';
import { EMAIL_PATTERN } from '../lib/auth/authApi';
import { fieldErrorsFrom } from '../lib/auth/formErrors';
import { useAuth } from '../lib/auth/useAuth';
import { PHOTOS } from '../lib/photos';

type Field = 'email' | 'password';

function validate(email: string, password: string): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

/** /login. On success the session becomes authenticated and <GuestOnly> sends the user on. */
export function LoginPage() {
  const { login } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Log in · FlashSeat';
  }, []);

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

  const next = params.get('next');
  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : '/register';

  return (
    <AuthLayout photo={PHOTOS.emptyAuditorium} eyebrow="Welcome back" title="Log in to" accent="FlashSeat" rest=".">
      {formError && <FormAlert ref={alertRef}>{formError}</FormAlert>}
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <TextField
          ref={emailRef}
          id="login-email"
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          required
        />
        <PasswordInput
          ref={passwordRef}
          id="login-password"
          label="Password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
        />
        <SubmitButton busy={busy} busyLabel="Logging in…">
          Log in
        </SubmitButton>
      </form>
      <p className="mt-8 text-[15px] text-text-2">
        New here?{' '}
        <Link to={registerHref} className="font-medium text-text underline decoration-text/30 underline-offset-4 hover:text-lime hover:decoration-lime">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
