import { Link } from 'react-router';
import { GITHUB_URL, NAV_LINKS } from '../layout/navLinks';

export function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-in">
        <span style={{ color: 'var(--lp-text)', fontWeight: 600 }}>FlashSeat</span>
        <nav aria-label="Footer">
          <ul className="lp-footer-links">
            {NAV_LINKS.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="lp-navl">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="lp-navl">
                GitHub<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          </ul>
        </nav>
        <span className="lp-mono" style={{ fontSize: 11, letterSpacing: '0.1em' }}>
          © 2026 FLASHSEAT
        </span>
      </div>
    </footer>
  );
}
