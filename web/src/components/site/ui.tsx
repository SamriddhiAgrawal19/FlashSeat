import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/cn';
import { showDateParts } from '../../lib/format';

// Small shared pieces of the v2 look (styles in components/site/site.css).

/** Mono uppercase section label ("EXPLORE", "ABOUT"). */
export function Eyebrow({ children, className, as: Tag = 'span' }: { children: ReactNode; className?: string; as?: 'span' | 'p' | 'h2' }) {
  return <Tag className={cn('site-eyebrow', className)}>{children}</Tag>;
}

/** The arrow that slides on hover of its button (or of any parent with .site-arr-host). */
export function Arrow({ down = false }: { down?: boolean }) {
  return (
    <span aria-hidden="true" className={cn('site-arr', down && 'site-arr-down')}>
      {down ? '↓' : '→'}
    </span>
  );
}

type Variant = 'primary' | 'accent' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface CommonProps {
  size?: Size;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}
type AsLink = CommonProps & { to: string; onClick?: () => void };
type AsButton = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'children'> & { to?: undefined };
export type SiteButtonProps = AsLink | AsButton;

function SiteButton({ variant, size = 'md', className, style, children, ...rest }: SiteButtonProps & { variant: Variant }) {
  const classes = cn('site-btn', `site-btn-${variant}`, `site-btn-${size}`, className);
  if (rest.to !== undefined) {
    return (
      <Link to={rest.to} onClick={rest.onClick} className={classes} style={style}>
        {children}
      </Link>
    );
  }
  const { to: _to, type = 'button', ...buttonProps } = rest;
  return (
    <button type={type} className={classes} style={style} {...buttonProps}>
      {children}
    </button>
  );
}

/** White button (main action on dark). Pass `to` for a link, otherwise it is a <button>. */
export const PrimaryButton = (props: SiteButtonProps) => <SiteButton variant="primary" {...props} />;
/** Coral button (booking actions: "Choose seats", "Select seats"). */
export const AccentButton = (props: SiteButtonProps) => <SiteButton variant="accent" {...props} />;
/** Outlined button (secondary actions, pagination). */
export const GhostButton = (props: SiteButtonProps) => <SiteButton variant="ghost" {...props} />;

/** A pill toggle (category filter). `pressed` is exposed as aria-pressed. */
export function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="site-chip" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}
/** Same thing under the name the design calls it. */
export const PillButton = Chip;

/** A text tab with the coral underline when pressed (date filter). */
export function Tab({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="site-tab" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * Day + month ("14" over "NOV") from an ISO date. `overlay` sits on a photo (cards); `plain` sits
 * in a list (show rows). Decorative: callers give the full date in text too.
 */
export function DateBlock({ iso, variant = 'plain', className }: { iso: string; variant?: 'overlay' | 'plain'; className?: string }) {
  const parts = showDateParts(iso);
  if (!parts) return null;
  return (
    <span aria-hidden="true" className={cn('site-date', variant === 'overlay' ? 'site-date-overlay' : 'site-date-plain', className)}>
      <span className="site-date-day">{parts.day.padStart(2, '0')}</span>
      <span className="site-date-mon">{parts.month.toUpperCase()}</span>
    </span>
  );
}

/**
 * A thin progress bar that fills from the left once (1.6s). `value` is 0..1. Decorative: the
 * text next to it carries the number.
 */
export function FillBar({ value, tone = 'text', width = 72, height = 4 }: { value: number; tone?: 'text' | 'accent'; width?: number | string; height?: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span aria-hidden="true" className="site-bar" style={{ width, height }}>
      <span className="site-bar-fill" style={{ width: `${pct}%`, background: tone === 'accent' ? 'var(--accent)' : 'var(--text)' }} />
    </span>
  );
}
