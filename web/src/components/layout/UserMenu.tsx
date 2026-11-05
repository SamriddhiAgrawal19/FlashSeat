import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronDown } from 'lucide-react';
import type { SessionUser } from '../../lib/auth/session';
import { displayName, initials, useAuth } from '../../lib/auth/useAuth';
import { cn } from '../../lib/cn';

export interface AccountLink {
  label: string;
  to: string;
}

/** Account destinations for a user (organizer dashboard only for organizers). */
export function accountLinks(user: SessionUser): AccountLink[] {
  return [
    { label: 'My bookings', to: '/bookings' },
    ...(user.role === 'ORGANIZER' ? [{ label: 'Organizer dashboard', to: '/organizer' }] : []),
  ];
}

export function Avatar({ user, className }: { user: SessionUser; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('grid size-8 shrink-0 place-items-center rounded-full bg-lime text-[13px] font-semibold tracking-[-0.02em] text-bg', className)}
    >
      {initials(user)}
    </span>
  );
}

const itemClass =
  'flex w-full items-center px-4 py-2.5 text-left text-[15px] text-text-2 transition-colors hover:bg-text/[0.04] hover:text-lime focus-visible:bg-text/[0.04] focus-visible:text-lime focus-visible:outline-none';

/** Desktop account menu: avatar + first name; Escape closes, arrows move, outside click closes. */
export function UserMenu({ user }: { user: SessionUser }) {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const location = useLocation();

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="group flex h-10 items-center gap-2.5 rounded-[2px] pr-1 pl-1 text-[15px] text-text/90 transition-colors hover:text-lime"
      >
        <Avatar user={user} />
        <span className="max-w-[10rem] truncate">{displayName(user)}</span>
        <ChevronDown aria-hidden="true" strokeWidth={1.5} className={cn('size-4 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute top-[calc(100%+0.5rem)] right-0 z-50 w-60 border border-rule bg-surface py-2 shadow-[0_24px_48px_-24px_rgb(0_0_0/0.8)] motion-safe:animate-fade-in"
        >
          {user.email && <p className="label-mono truncate border-b border-rule px-4 pt-1 pb-3 text-text-2">{user.email}</p>}
          <div className="pt-1">
            {accountLinks(user).map((link) => (
              <Link key={link.to} to={link.to} role="menuitem" tabIndex={-1} className={itemClass}>
                {link.label}
              </Link>
            ))}
          </div>
          <div className="mt-1 border-t border-rule pt-1">
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => void logout()} className={itemClass}>
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
