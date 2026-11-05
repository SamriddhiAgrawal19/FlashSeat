import type { KeyboardEvent } from 'react';
import type { RegisterRole } from '../../lib/auth/authApi';
import { cn } from '../../lib/cn';

const OPTIONS: Array<{ value: RegisterRole; label: string }> = [
  { value: 'ATTENDEE', label: 'I want to attend' },
  { value: 'ORGANIZER', label: "I'm an organizer" },
];

/** Two-option segmented control, built as a radio group (arrow keys switch, one tab stop). */
export function RoleToggle({ value, onChange }: { value: RegisterRole; onChange: (role: RegisterRole) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const next = value === 'ATTENDEE' ? 'ORGANIZER' : 'ATTENDEE';
    onChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
  };

  return (
    <div>
      <p id="role-label" className="label-mono text-text-2">
        Account type
      </p>
      <div role="radiogroup" aria-labelledby="role-label" onKeyDown={onKeyDown} className="mt-2 grid grid-cols-2 border border-rule">
        {OPTIONS.map((option, i) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-value={option.value}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={cn(
                'h-12 px-3 text-[15px] font-medium tracking-[-0.01em] transition-colors focus-visible:outline-offset-[-2px]',
                i > 0 && 'border-l border-rule',
                on ? 'bg-lime text-bg' : 'text-text-2 hover:text-text',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
