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
      className={cn('og-confirm og-panel-in', tone === 'danger' && 'is-danger')}
    >
      <h2 id={headingId}>
        {title}
      </h2>
      <div className="og-confirm-body">{children}</div>
      <form
        className="og-form"
        style={{ marginTop: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && !busy) onConfirm();
        }}
      >
        {requireText !== undefined && (
          <Input
            id={`${headingId}-confirm`}
            label={`Type the event title to confirm`}
            hint={<span style={{ fontFamily: 'var(--ff-mono)', color: 'var(--text-2)' }}>{requireText}</span>}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            className="og-confirm-input"
          />
        )}
        {error && (
          <div role="alert" className="og-error-text">
            {error}
          </div>
        )}
        <div className="og-head-actions">
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
