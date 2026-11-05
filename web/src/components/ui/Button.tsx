import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary';
type Size = 'sm' | 'md' | 'lg';

interface StyleProps {
  variant?: Variant;
  size?: Size;
}

// Sharp edges, medium weight. Primary is the lime button; it darkens slightly on hover.
const base =
  'group inline-flex items-center justify-center gap-2 rounded-[2px] font-medium tracking-[-0.01em] whitespace-nowrap ' +
  'transition-[background-color,border-color,color,transform] duration-200 motion-safe:active:scale-[0.98] ' +
  'disabled:pointer-events-none disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary: 'bg-lime text-bg hover:bg-lime-hover',
  secondary: 'border border-text/25 text-text hover:border-lime hover:text-lime',
};

// Two CTA heights site-wide: 40px in the navbar, 48px everywhere else.
const sizes: Record<Size, string> = {
  sm: 'h-10 px-4 text-[15px]',
  md: 'h-12 px-6 text-[15px]',
  lg: 'h-12 px-7 text-base',
};

function buttonClasses({ variant = 'primary', size = 'md' }: StyleProps, className?: string): string {
  return cn(base, variants[variant], sizes[size], className);
}

/** "→" that slides 4px on hover of the enclosing `group`. */
export function Arrow({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block transition-transform duration-300 motion-safe:group-hover:translate-x-1', className)}
    >
      →
    </span>
  );
}

type ButtonProps = StyleProps & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant, size, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size }, className)} {...rest} />;
}

type ButtonLinkProps = StyleProps & LinkProps;

/** An in-app link styled as a button. */
export function ButtonLink({ variant, size, className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClasses({ variant, size }, className)} {...rest} />;
}

interface ArrowLinkProps extends Omit<LinkProps, 'children'> {
  children: ReactNode;
  /** Lime arrow (primary action) or a quieter secondary link. */
  tone?: 'primary' | 'secondary';
  /** 'lg' for section-level links such as "View all events" (17px, roomy hit area). */
  size?: 'md' | 'lg';
}

/** Text link with a trailing arrow that slides on hover. */
export function ArrowLink({ children, tone = 'primary', size = 'md', className, ...rest }: ArrowLinkProps) {
  return (
    <Link
      className={cn(
        'group inline-flex items-center gap-2 rounded-[2px] font-medium tracking-[-0.01em] transition-colors',
        size === 'lg' ? 'border-b border-text/25 py-2 text-[17px] hover:border-lime' : 'py-1 text-[15px]',
        tone === 'primary' ? 'text-text hover:text-lime' : 'text-text-2 hover:text-text',
        className,
      )}
      {...rest}
    >
      {children}
      {tone === 'primary' && <Arrow className="text-lime" />}
    </Link>
  );
}
