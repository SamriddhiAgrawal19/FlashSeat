import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { EMAIL_PATTERN, PASSWORD_MIN_LENGTH, type RegisterRole } from '../../lib/auth/authApi';
import { fieldErrorsFrom } from '../../lib/auth/formErrors';
import { useAuth } from '../../lib/auth/useAuth';
import { describeNetworkOrRateLimit } from './FormParts';
import { FormAlert, PasswordField, RoleCards, StrengthMeter, SubmitButton, TextField } from './AuthFields';

type Field = 'name' | 'email' | 'password' | 'organizationName';
// Visual order of the fields (organization sits under the name), for "focus the first error".
const FIELD_ORDER: Field[] = ['name', 'organizationName', 'email', 'password'];

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

/**
 * Sign up. Same logic as before the redesign: register returns a token, so the user is logged in
 * and <GuestOnly> sends them on. `loginInstead(email)` switches to the Log in tab with that email.
 */
export function RegisterForm({
  loginLink,
  loginInstead,
}: {
  loginLink: ReactNode;
  loginInstead: (email: string, label: string) => ReactNode;
}) {
  const { register } = useAuth();
  const [role, setRole] = useState<RegisterRole>('ATTENDEE');
  const [values, setValues] = useState<Values>({ name: '', email: '', password: '', organizationName: '' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const alertRef = useRef<HTMLDivElement>(null);

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
            An account with this email already exists. {loginInstead(values.email.trim(), 'Log in instead?')}
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

  const ref = (field: Field) => (el: HTMLInputElement | null) => {
    refs.current[field] = el;
  };

  return (
    <form noValidate onSubmit={onSubmit} className="au-form au-form-signup" aria-labelledby="signup-title">
      <div className="au-head">
        <span className="site-eyebrow">Join FlashSeat</span>
        <h1 id="signup-title" className="au-h1">
          <span className="au-w">Your</span> <span className="au-w" style={{ animationDelay: '.06s' }}>next</span>{' '}
          <span className="au-w" style={{ animationDelay: '.12s' }}>night</span>{' '}
          <span className="au-w site-serif" style={{ animationDelay: '.18s' }}>starts here.</span>
        </h1>
      </div>
      <RoleCards value={role} onChange={setRole} />
      <TextField
        ref={ref('name')}
        id="register-name"
        label="Your name"
        name="name"
        autoComplete="name"
        placeholder="Asha Kulkarni"
        value={values.name}
        onChange={set('name')}
        error={errors.name}
        required
      />
      {/* Only for organizers: revealed (animated) when "Host events" is picked, required then. */}
      {organizer && (
        <TextField
          ref={ref('organizationName')}
          className="au-reveal"
          id="register-organization"
          label="Organization"
          name="organization"
          autoComplete="organization"
          placeholder="Your company, club or college society"
          value={values.organizationName}
          onChange={set('organizationName')}
          error={errors.organizationName}
          required
        />
      )}
      <TextField
        ref={ref('email')}
        id="register-email"
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={values.email}
        onChange={set('email')}
        error={errors.email}
        required
      />
      <PasswordField
        ref={ref('password')}
        id="register-password"
        label="Password"
        name="password"
        autoComplete="new-password"
        placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
        value={values.password}
        onChange={set('password')}
        error={errors.password}
        describedBy="register-password-hint"
        below={<StrengthMeter id="register-password-hint" length={values.password.length} />}
        required
      />
      {formError && <FormAlert ref={alertRef}>{formError}</FormAlert>}
      <SubmitButton busy={busy} busyLabel="Creating account…">
        {organizer ? 'Create organizer account' : 'Create account'}
      </SubmitButton>
      <p className="au-foot">Already have an account? {loginLink}</p>
    </form>
  );
}
