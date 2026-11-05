import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/cn';
import { FieldShell, inputClass } from './FormField';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
}

/** Password field with a show/hide toggle (a real button, announced via aria-pressed). */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { id, label, error, hint, className, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(inputClass, 'pr-14', error ? 'border-danger' : 'border-rule', className)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 grid w-12 place-items-center text-text-2 transition-colors hover:text-lime focus-visible:outline-offset-[-4px]"
        >
          {visible ? <EyeOff className="size-[18px]" strokeWidth={1.5} aria-hidden="true" /> : <Eye className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />}
        </button>
      </div>
    </FieldShell>
  );
});
