import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Action, Input } from './ui';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busyLabel: string;
  tone: 'primary' | 'danger';
  busy: boolean;
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string;
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/** An in-page confirmation (not a modal): it opens under the action that asked for it. */
export function ConfirmPanel({ title, children, confirmLabel, cancelLabel = 'Keep as is', busyLabel, tone, busy, requireText, error, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState('');
  const headingId = useId();
  const ref = useRef<HTMLElement>(null);
  const matches = requireText === undefined || typed.trim() === requireText.trim();

  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  return (
    <section
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onCancel();
      }}
      className={cn('border-l-2 bg-surface px-4 py-4 focus:outline-none sm:px-5', tone === 'danger' ? 'border-danger' : 'border-lime')}
    >
      <h2 id={headingId} className="text-[15px] font-medium text-text">
        {title}
      </h2>
      <div className="mt-2 text-[14px] leading-relaxed text-text-2">{children}</div>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && !busy) onConfirm();
        }}
      >
        {requireText !== undefined && (
          <Input
            id={`${headingId}-confirm`}
            label={`Type the event title to confirm`}
            hint={<span className="font-mono text-text-2">{requireText}</span>}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            className="max-w-[28rem]"
          />
        )}
        {error && <div className="mt-3 text-[14px] text-danger">{error}</div>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Action type="submit" tone={tone} busy={busy} disabled={!matches}>
            {busy ? busyLabel : confirmLabel}
          </Action>
          <Action tone="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Action>
        </div>
      </form>
    </section>
  );
}
