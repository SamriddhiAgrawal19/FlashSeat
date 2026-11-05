import { Link } from 'react-router';
import { GITHUB_URL, NAV_LINKS } from '../layout/navLinks';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-wrap site-footer-in">
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>FlashSeat</span>
        <nav aria-label="Footer">
          <ul className="site-footer-links">
            {NAV_LINKS.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="site-navl">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="site-navl">
                GitHub<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          </ul>
        </nav>
        <span className="site-mono" style={{ fontSize: 11, letterSpacing: '0.1em' }}>
          © 2026 FLASHSEAT
        </span>
      </div>
    </footer>
  );
}
