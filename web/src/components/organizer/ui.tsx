// Small building blocks for the organizer dashboard: dense fields, headers, breadcrumbs, panels.
// Calmer and tighter than the public site: 40px controls, 14px text on desktop, hairlines.
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

/** 16px on phones (no iOS zoom on focus), 14px from sm up. */
export const controlClass =
  'w-full min-w-0 rounded-[2px] border bg-surface px-3 text-[16px] text-text placeholder:text-text-3 transition-colors sm:text-[14px] ' +
  'focus-visible:border-lime focus-visible:outline-none disabled:opacity-60';

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
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="label-mono flex items-baseline justify-between gap-3 text-text-2">
        <span>{label}</span>
        {optional && <span className="text-text-3 normal-case tracking-normal">optional</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="mt-1.5 text-[13px] text-text-3">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: ReactNode): string | undefined {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & Omit<ShellProps, 'children'> & { inputClassName?: string; prefix?: string };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { id, label, error, hint, optional, className, inputClassName, prefix, ...rest },
  ref,
) {
  return (
    <Field id={id} label={label} error={error} hint={hint} optional={optional} className={className}>
      <div className="relative">
        {prefix && (
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-[13px] text-text-3">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={cn(controlClass, 'h-10', prefix && 'pl-7', error ? 'border-danger' : 'border-rule', inputClassName)}
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
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClass, 'min-h-28 resize-y py-2.5 leading-relaxed', error ? 'border-danger' : 'border-rule')}
        {...rest}
      />
    </Field>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & Omit<ShellProps, 'children'> & { children: ReactNode };

export function Select({ id, label, error, hint, optional, className, children, ...rest }: SelectProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint} optional={optional} className={className}>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={cn(controlClass, 'h-10 appearance-none pr-9', error ? 'border-danger' : 'border-rule')}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown aria-hidden="true" strokeWidth={1.5} className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-2" />
      </div>
    </Field>
  );
}

type ActionTone = 'primary' | 'secondary' | 'danger' | 'ghost';

const ACTION_TONES: Record<ActionTone, string> = {
  primary: 'bg-lime text-bg hover:bg-lime-hover',
  secondary: 'border border-text/25 text-text hover:border-text/60',
  danger: 'border border-danger/50 text-danger hover:border-danger hover:bg-danger/10',
  ghost: 'text-text-2 hover:text-text',
};

export const actionClass = (tone: ActionTone = 'secondary') =>
  cn(
    'inline-flex h-9 items-center justify-center gap-2 rounded-[2px] px-3.5 text-[14px] font-medium tracking-[-0.01em] whitespace-nowrap',
    'transition-[background-color,border-color,color] duration-150 disabled:pointer-events-none disabled:opacity-50',
    ACTION_TONES[tone],
  );

interface ActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ActionTone;
  busy?: boolean;
}

/** Compact dashboard button. While `busy` it is disabled and shows a spinner. */
export function Action({ tone = 'secondary', busy = false, className, children, disabled, type = 'button', ...rest }: ActionProps) {
  return (
    <button type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={cn(actionClass(tone), className)} {...rest}>
      {busy && <LoaderCircle aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />}
      {children}
    </button>
  );
}

export function ActionLink({ to, tone = 'secondary', className, children }: { to: string; tone?: ActionTone; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={cn(actionClass(tone), className)}>
      {children}
    </Link>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="label-mono min-w-0 text-text-3">
      <ol className="flex min-w-0 items-center gap-2">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className={cn('flex min-w-0 items-center gap-2', i === items.length - 1 && 'truncate')}>
            {i > 0 && <span aria-hidden="true">/</span>}
            {item.to ? (
              <Link to={item.to} className="shrink-0 text-text-2 hover:text-text">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate text-text-2">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Page title row: optional crumbs and eyebrow above, actions on the right (wrapping under on phones). */
export function PageHeader({
  title,
  eyebrow,
  crumbs,
  actions,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-rule pb-6">
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4', crumbs && 'mt-4')}>
        <div className="min-w-0">
          {eyebrow && <div className="label-mono text-text-2">{eyebrow}</div>}
          <h1 className={cn('text-[1.75rem] leading-tight font-medium tracking-[-0.03em] text-text break-words sm:text-[2rem]', eyebrow ? 'mt-2' : undefined)}>
            {title}
          </h1>
          {children}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A titled block with a hairline frame. */
export function Panel({ title, meta, actions, children, className }: { title?: ReactNode; meta?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-[2px] border border-rule', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-baseline gap-3">
            {title && <h2 className="text-[15px] font-medium tracking-[-0.01em] text-text">{title}</h2>}
            {meta && <span className="label-mono text-text-3">{meta}</span>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="px-4 py-4 sm:px-5 sm:py-5">{children}</div>
    </section>
  );
}

/** A form-level error with a left rule. */
export function InlineAlert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('border-l-2 bg-surface px-4 py-3 text-[14px] text-text', tone === 'error' ? 'border-danger' : 'border-text/40')}>
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('bg-text/[0.07] motion-safe:animate-breathe', className)} />;
}
