import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import '../components/auth/auth.css';
import { LoginForm, SwitchLink } from '../components/auth/LoginForm';
import { PhotoWall } from '../components/auth/PhotoWall';
import { RegisterForm } from '../components/auth/RegisterForm';
import { TicketMark } from '../components/site/SiteHeader';

type Mode = 'login' | 'signup';
const PATH: Record<Mode, string> = { login: '/login', signup: '/register' };

/**
 * /login and /register (docs/auth-page-design.html): one page, two routes. The segmented control
 * and the "Log in" / "Create an account" links switch the tab AND the URL (history replace),
 * keeping the query string, so ?next= survives. Both routes render this same element inside
 * <GuestOnly>, so the page stays mounted when switching and the indicator slides.
 * Location state { email } (from "Log in instead?") prefills the login email.
 */
export function AuthPage() {
  const { pathname, search, state } = useLocation();
  const navigate = useNavigate();
  const mode: Mode = pathname === '/register' ? 'signup' : 'login';
  const tabs = useRef<Record<Mode, HTMLButtonElement | null>>({ login: null, signup: null });
  const prefill = typeof (state as { email?: unknown } | null)?.email === 'string' ? (state as { email: string }).email : '';

  useEffect(() => {
    document.title = mode === 'login' ? 'Log in · FlashSeat' : 'Create an account · FlashSeat';
  }, [mode]);

  const go = (next: Mode) => {
    if (next !== mode) navigate({ pathname: PATH[next], search }, { replace: true });
  };

  // Tabs pattern: Left/Right (and Home/End) move between the two tabs and select them.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, Mode> = { ArrowLeft: 'login', Home: 'login', ArrowRight: 'signup', End: 'signup' };
    const next = keys[event.key];
    if (!next) return;
    event.preventDefault();
    go(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="au-page">
      <Link to="/" className="au-logo">
        <TicketMark />
        FlashSeat
      </Link>
      <PhotoWall />

      <div className="au-main">
        <div className="au-card">
          <div role="tablist" aria-label="Account" className="au-seg" data-mode={mode} onKeyDown={onTabKey}>
            <span className="au-seg-ind" aria-hidden="true" />
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                ref={(el) => {
                  tabs.current[m] = el;
                }}
                type="button"
                role="tab"
                id={`auth-tab-${m}`}
                aria-selected={mode === m}
                aria-controls={`auth-panel-${m}`}
                tabIndex={mode === m ? 0 : -1}
                className="au-seg-tab"
                onClick={() => go(m)}
              >
                {m === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>

          {/* Keyed by mode, so each switch replays the form swap animation with a fresh form. */}
          <div key={mode} role="tabpanel" id={`auth-panel-${mode}`} aria-labelledby={`auth-tab-${mode}`}>
            {mode === 'login' ? (
              <LoginForm
                initialEmail={prefill}
                signupLink={
                  <SwitchLink to={PATH.signup} search={search}>
                    Create an account
                  </SwitchLink>
                }
              />
            ) : (
              <RegisterForm
                loginLink={
                  <SwitchLink to={PATH.login} search={search}>
                    Log in
                  </SwitchLink>
                }
                loginInstead={(email, label) => (
                  <SwitchLink to={PATH.login} search={search} state={{ email }}>
                    {label}
                  </SwitchLink>
                )}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
