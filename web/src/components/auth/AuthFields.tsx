import { forwardRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, type RegisterRole } from '../../lib/auth/authApi';
import { cn } from '../../lib/cn';

// Dark v2 form pieces for /login and /register (styles in components/auth/auth.css).

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  /** Shown as the mono caption inside the field box ("EMAIL"). */
  label: string;
  error?: string;
  /** Extra element ids that describe the input (e.g. the password hint). */
  describedBy?: string;
  className?: string;
}

function describedBy(id: string, error: string | undefined, extra?: string) {
  return [error ? `${id}-error` : null, extra ?? null].filter(Boolean).join(' ') || undefined;
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} role="alert" className="au-error">
      {error}
    </p>
  );
}

/** A labelled text input in a field box; the error (coral) sits under the box. */
export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { id, label, error, describedBy: extra, className, ...rest },
  ref,
) {
  return (
    <div className={cn('au-fieldwrap', className)}>
      <div className={cn('au-field', error && 'is-invalid')}>
        <label htmlFor={id}>
          <span className="au-label">{label.toUpperCase()}</span>
          <input
            ref={ref}
            id={id}
            className="au-input"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(id, error, extra)}
            {...rest}
          />
        </label>
      </div>
      <FieldError id={id} error={error} />
    </div>
  );
});

/** Password input with a SHOW / HIDE text toggle (a real button with aria-pressed). */
export const PasswordField = forwardRef<HTMLInputElement, Omit<FieldProps, 'type'> & { below?: ReactNode }>(function PasswordField(
  { id, label, error, describedBy: extra, below, className, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={cn('au-fieldwrap', className)}>
      <div className={cn('au-field', error && 'is-invalid')}>
        <label htmlFor={id}>
          <span className="au-label">{label.toUpperCase()}</span>
          <input
            ref={ref}
            id={id}
            type={visible ? 'text' : 'password'}
            className="au-input"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(id, error, extra)}
            {...rest}
          />
        </label>
        <button
          type="button"
          className="au-eye"
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? 'HIDE' : 'SHOW'}
        </button>
      </div>
      {below}
      <FieldError id={id} error={error} />
    </div>
  );
});

/**
 * Password strength per the design, driven only by the backend's rule (at least
 * PASSWORD_MIN_LENGTH characters): "8+ characters" -> "N more to go" -> "Looks good".
 * The bar fills toward that minimum and turns green once it is met.
 */
export function StrengthMeter({ id, length }: { id: string; length: number }) {
  const ok = length >= PASSWORD_MIN_LENGTH;
  const pct = Math.min(100, Math.round((length / PASSWORD_MIN_LENGTH) * 100));
  const hint = length === 0 ? `${PASSWORD_MIN_LENGTH}+ characters` : ok ? 'Looks good' : `${PASSWORD_MIN_LENGTH - length} more to go`;
  const color = length === 0 ? 'var(--muted-mono)' : ok ? '#4ADE80' : '#FF8A6E';
  return (
    <div className="au-meter">
      <span className="au-meter-track" aria-hidden="true">
        <span className="au-meter-fill" style={{ width: `${pct}%`, background: ok ? '#22C55E' : 'var(--accent)' }} />
      </span>
      <span id={id} className="au-hint" style={{ color }}>
        {hint}
      </span>
    </div>
  );
}

const ROLES: Array<{ value: RegisterRole; title: string; text: string; icon: ReactNode }> = [
  {
    value: 'ATTENDEE',
    title: 'Attend events',
    text: 'Book seats, keep tickets',
    icon: (
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M3 7a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4z" />
      </svg>
    ),
  },
  {
    value: 'ORGANIZER',
    title: 'Host events',
    text: 'Venues, shows, sales',
    icon: (
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 20V10l8-6 8 6v10" />
        <path d="M9 20v-6h6v6" />
      </svg>
    ),
  },
];

/** Role cards as a radio group: one tab stop, arrow keys move and select (as the old toggle did). */
export function RoleCards({ value, onChange }: { value: RegisterRole; onChange: (role: RegisterRole) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const next = value === 'ATTENDEE' ? 'ORGANIZER' : 'ATTENDEE';
    onChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label="I want to" className="au-roles" onKeyDown={onKeyDown}>
      {ROLES.map((role) => {
        const on = role.value === value;
        return (
          <button
            key={role.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={role.value}
            tabIndex={on ? 0 : -1}
            className="au-role"
            onClick={() => onChange(role.value)}
          >
            {role.icon}
            <span style={{ fontSize: 15, fontWeight: 600 }}>{role.title}</span>
            <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>{role.text}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Form-level error above the submit button. Focusable so the form can move focus to it. */
export const FormAlert = forwardRef<HTMLDivElement, { children: ReactNode }>(function FormAlert({ children }, ref) {
  return (
    <div ref={ref} role="alert" tabIndex={-1} className="au-alert">
      <i aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
});

/** White submit button with the sliding arrow; spinner and disabled while the request runs. */
export function SubmitButton({ busy, busyLabel, children }: { busy: boolean; busyLabel: string; children: ReactNode }) {
  return (
    <button type="submit" className="au-submit" disabled={busy} aria-busy={busy}>
      {busy ? (
        <>
          <LoaderCircle size={16} className="au-spin" aria-hidden="true" />
          {busyLabel}
        </>
      ) : (
        <>
          {children} <span className="site-arr" aria-hidden="true">→</span>
        </>
      )}
    </button>
  );
}
