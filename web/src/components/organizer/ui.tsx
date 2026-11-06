// Small building blocks for the organizer dashboard (docs/organizer-dashboard-design.html): fields
// with mono labels and dark inputs (coral focus ring), buttons, breadcrumbs, headers, cards.
// Styles in ./organizer.css.
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import './organizer.css';

interface ShellProps {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ id, label, error, hint, optional, className, children }: ShellProps) {
  return (
    <div className={cn('og-field', className)}>
      <label htmlFor={id} className="og-label">
        <span>{label}</span>
        {optional && <span className="og-optional">optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="og-field-error" style={{ margin: 0 }}>
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="og-hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: ReactNode): string | undefined {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'prefix'> &
  Omit<ShellProps, 'children'> & { inputClassName?: string; inputStyle?: CSSProperties; prefix?: string };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { id, label, error, hint, optional, className, inputClassName, inputStyle, prefix, ...rest },
  ref,
) {
  return (
    <Field id={id} label={label} error={error} hint={hint} optional={optional} className={className}>
      <div className="og-control">
        {prefix && (
          <span aria-hidden="true" className="og-prefix">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={cn('og-input', prefix && 'has-prefix', inputClassName)}
          style={inputStyle}
          {...rest}
        />
      </div>
    </Field>
  );
});

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & Omit<ShellProps, 'children'>;

export function Textarea({ id, label, error, hint, optional, className, ...rest }: TextareaProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint} optional={optional} className={className}>
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} className="og-input" {...rest} />
    </Field>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & Omit<ShellProps, 'children'> & { children: ReactNode };

export function Select({ id, label, error, hint, optional, className, children, ...rest }: SelectProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint} optional={optional} className={className}>
      <div className="og-control">
        <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} className="og-input" {...rest}>
          {children}
        </select>
        <ChevronDown aria-hidden="true" strokeWidth={1.5} size={16} className="og-chevron" />
      </div>
    </Field>
  );
}

/** primary = white, accent = coral (booking-style actions), secondary = outlined, danger = coral outline. */
type ActionTone = 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost';

export const actionClass = (tone: ActionTone = 'secondary', small = false) => cn('og-btn', `og-btn-${tone}`, small && 'is-sm');

interface ActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ActionTone;
  busy?: boolean;
  small?: boolean;
}

/** Dashboard button. While `busy` it is disabled and shows a spinner. */
export function Action({ tone = 'secondary', busy = false, small = false, className, children, disabled, type = 'button', ...rest }: ActionProps) {
  return (
    <button type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={cn(actionClass(tone, small), className)} {...rest}>
      {busy && <span aria-hidden="true" className="og-spin" />}
      {children}
    </button>
  );
}

export function ActionLink({ to, tone = 'secondary', small = false, className, children }: { to: string; tone?: ActionTone; small?: boolean; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={cn(actionClass(tone, small), className)}>
      {children}
    </Link>
  );
}

/** The arrow that slides on hover of its button. */
export function Arr() {
  return (
    <span aria-hidden="true" className="site-arr">
      →
    </span>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="og-crumbs">
      <ol>
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`}>
            {i > 0 && <span aria-hidden="true">/</span>}
            {item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Page title row: optional crumbs or eyebrow above, actions on the right (wrapping under on phones). */
export function PageHeader({
  title,
  eyebrow,
  crumbs,
  actions,
  small = false,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  small?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="og-head">
      <div className="og-head-text">
        {crumbs && <Breadcrumbs items={crumbs} />}
        {eyebrow && <span className="og-eyebrow">{eyebrow}</span>}
        <h1 className={cn('og-h1', small && 'is-sm')}>{title}</h1>
        {children}
      </div>
      {actions && <div className="og-head-actions">{actions}</div>}
    </header>
  );
}

/** A titled card. */
export function Panel({ title, meta, actions, children, className, flush = false }: { title?: ReactNode; meta?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn('og-card', flush && 'is-clip', className)}>
      {(title || actions) && (
        <div className="og-card-head">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
            {title && <h2 className="og-card-title">{title}</h2>}
            {meta && <span className="og-card-meta">{meta}</span>}
          </div>
          {actions && <div className="og-card-actions">{actions}</div>}
        </div>
      )}
      {flush ? children : <div className="og-card-body">{children}</div>}
    </section>
  );
}

/** A form-level error (role="alert") or an info note. */
export function InlineAlert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('og-alert', tone === 'info' && 'is-info')}>
      {children}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={cn('og-skel', className)} style={style} />;
}
