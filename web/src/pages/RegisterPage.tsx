import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { AuthLayout } from '../components/auth/AuthLayout';
import { TextField } from '../components/auth/FormField';
import { describeNetworkOrRateLimit, FormAlert, SubmitButton } from '../components/auth/FormParts';
import { PasswordInput } from '../components/auth/PasswordInput';
import { RoleToggle } from '../components/auth/RoleToggle';
import { ApiError } from '../lib/api';
import { EMAIL_PATTERN, PASSWORD_MIN_LENGTH, type RegisterRole } from '../lib/auth/authApi';
import { fieldErrorsFrom } from '../lib/auth/formErrors';
import { useAuth } from '../lib/auth/useAuth';
import { cn } from '../lib/cn';
import { PHOTOS } from '../lib/photos';

type Field = 'name' | 'email' | 'password' | 'organizationName';
const FIELD_ORDER: Field[] = ['name', 'email', 'password', 'organizationName'];

interface Values {
  name: string;
  email: string;
  password: string;
  organizationName: string;
}

// Mirrors registerSchema (src/modules/auth/auth.schema.ts): name non-empty, valid email,
// password at least 8 characters, organization_name required for organizers.
function validate(values: Values, role: RegisterRole): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  if (!values.name.trim()) errors.name = 'Enter your name.';
  if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = 'Enter a valid email address.';
  if (values.password.length < PASSWORD_MIN_LENGTH) errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (role === 'ORGANIZER' && !values.organizationName.trim()) errors.organizationName = 'Enter your organization name.';
  return errors;
}

/** Live password hint, matching the backend rule exactly (length only). */
function PasswordHint({ password }: { password: string }) {
  const ok = password.length >= PASSWORD_MIN_LENGTH;
  return (
    <span className={cn('flex items-center gap-2 transition-colors', ok ? 'text-lime' : 'text-text-2')}>
      <Check aria-hidden="true" className={cn('size-3.5 transition-opacity', ok ? 'opacity-100' : 'opacity-40')} strokeWidth={2.5} />
      At least {PASSWORD_MIN_LENGTH} characters
      <span className="sr-only">{ok ? '(met)' : '(not met yet)'}</span>
    </span>
  );
}

/** /register. Register returns a token, so the user is logged in and <GuestOnly> sends them on. */
export function RegisterPage() {
  const { register } = useAuth();
  const [params] = useSearchParams();
  const [role, setRole] = useState<RegisterRole>('ATTENDEE');
  const [values, setValues] = useState<Values>({ name: '', email: '', password: '', organizationName: '' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Create an account · FlashSeat';
  }, []);

  useEffect(() => {
    if (attempt === 0) return;
    if (formError) {
      alertRef.current?.focus();
      return;
    }
    const first = FIELD_ORDER.find((f) => errors[f]);
    if (first) refs.current[first]?.focus();
  }, [attempt, errors, formError]);

  const set = (field: keyof Values) => (event: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: event.target.value }));

  const next = params.get('next');
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const organizer = role === 'ORGANIZER';

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const local = validate(values, role);
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      await register({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
        role,
        ...(organizer ? { organization_name: values.organizationName.trim() } : {}),
      });
    } catch (error) {
      const server = fieldErrorsFrom(error);
      if (Object.keys(server).length > 0) {
        setErrors({ name: server.name, email: server.email, password: server.password, organizationName: server.organization_name });
        if (server.role) setFormError(server.role);
      } else if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setFormError(
          <span>
            An account with this email already exists.{' '}
            <Link to={loginHref} className="font-medium text-lime underline underline-offset-4">
              Log in instead?
            </Link>
          </span>,
        );
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
    <AuthLayout photo={PHOTOS.comedy} eyebrow="Join FlashSeat" title="Your next night" accent="starts" rest=" here.">
      {formError && <FormAlert ref={alertRef}>{formError}</FormAlert>}
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <RoleToggle value={role} onChange={setRole} />
        <TextField
          ref={(el) => {
            refs.current.name = el;
          }}
          id="register-name"
          label="Name"
          name="name"
          autoComplete="name"
          value={values.name}
          onChange={set('name')}
          error={errors.name}
          required
        />
        <TextField
          ref={(el) => {
            refs.current.email = el;
          }}
          id="register-email"
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChange={set('email')}
          error={errors.email}
          required
        />
        <PasswordInput
          ref={(el) => {
            refs.current.password = el;
          }}
          id="register-password"
          label="Password"
          name="password"
          autoComplete="new-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
          hint={<PasswordHint password={values.password} />}
          required
        />

        {/* Organization name: revealed with a height animation (grid rows 0fr -> 1fr); inert while hidden. */}
        <div
          className={cn(
            // -mt-6 cancels the form's gap; the pt-6 inside animates with the height instead.
            '-mt-6 grid transition-[grid-template-rows,opacity] duration-300 ease-out',
            organizer ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
          inert={!organizer}
        >
          <div className="overflow-hidden pt-6">
            <TextField
              ref={(el) => {
                refs.current.organizationName = el;
              }}
              id="register-organization"
              label="Organization name"
              name="organization"
              autoComplete="organization"
              value={values.organizationName}
              onChange={set('organizationName')}
              error={errors.organizationName}
              hint="Shown to people booking your events."
              required={organizer}
            />
          </div>
        </div>

        <SubmitButton busy={busy} busyLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>
      <p className="mt-8 text-[15px] text-text-2">
        Already have an account?{' '}
        <Link to={loginHref} className="font-medium text-text underline decoration-text/30 underline-offset-4 hover:text-lime hover:decoration-lime">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
