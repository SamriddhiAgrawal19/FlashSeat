import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export const inputClass =
  'h-12 w-full min-w-0 border bg-surface px-4 text-[16px] text-text placeholder:text-text-2/70 transition-colors ' +
  'focus-visible:border-lime focus-visible:outline-none';

interface FieldShellProps {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}

/** Label above, control, then either the error (in place of the hint) or the hint. */
export function FieldShell({ id, label, error, hint, children }: FieldShellProps) {
  return (
    <div>
      <label htmlFor={id} className="label-mono block text-text-2">
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="mt-2 text-sm text-text-2">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
}

/** A labelled text input wired for errors: aria-invalid and aria-describedby. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, error, hint, className, ...rest },
  ref,
) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(inputClass, error ? 'border-danger' : 'border-rule', className)}
        {...rest}
      />
    </FieldShell>
  );
});
