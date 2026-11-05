import { cn } from '../../lib/cn';
import { useReveal } from './hooks';

// Illustrative cards, exactly as in the design (no API data).
const BARS = [20, 28, 24, 40, 47, 56, 64];

function SeatIsYours() {
  return (
    <div className="lp-bcard">
      <h3 className="lp-bcard-title">The seat you pick is yours</h3>
      <p className="lp-bcard-text">Once you choose it, nobody else can book it, even when thousands are booking at once.</p>
      <div aria-hidden="true" style={{ marginTop: 'auto', paddingTop: 24, display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="lp-sq" style={{ background: '#FF6B4A', border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg className="lp-lock" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#08080A" strokeWidth="2" strokeLinecap="round">
            <path d="M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <span className="lp-sq" />
        <span className="lp-sq" />
        <span className="lp-mono" style={{ fontSize: 11, color: 'var(--lp-muted-2)', marginLeft: 4 }}>
          D9 · YOURS
        </span>
      </div>
    </div>
  );
}

function TicketsInPocket() {
  return (
    <div className="lp-bcard">
      <h3 className="lp-bcard-title">Tickets in your pocket</h3>
      <p className="lp-bcard-text">Every seat gets its own e-ticket code, ready at the door.</p>
      <div className="lp-ticket" aria-hidden="true">
        <span className="lp-scan" />
        <span className="lp-mono" style={{ fontSize: 10, letterSpacing: '0.1em', color: '#52525B' }}>
          ROW D · SEAT 9 · PREMIUM
        </span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>The Last Train to Lonavala</span>
        <div
          style={{
            marginTop: 'auto',
            borderTop: '1px dashed #A1A1AA',
            paddingTop: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span className="lp-type lp-mono" style={{ fontSize: 13 }}>
            FS-7K2Q-D9
          </span>
          <span className="lp-valid lp-mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#15803D' }}>
            <i style={{ width: 7, height: 7, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }} />
            VALID
          </span>
        </div>
      </div>
    </div>
  );
}

function ForOrganizers() {
  return (
    <div className="lp-bcard">
      <h3 className="lp-bcard-title">Made for organizers too</h3>
      <p className="lp-bcard-text">Set up your venue, schedule shows, set prices and watch every seat sell.</p>
      <div aria-hidden="true" style={{ marginTop: 'auto', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="lp-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--lp-muted-2)' }}>
          <span>SEATS SOLD</span>
          <span style={{ color: 'var(--lp-text)' }}>165 / 300</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: '#27272A', overflow: 'hidden' }}>
          <span className="lp-fill" style={{ width: '55%', background: '#FF6B4A' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 64 }}>
          {BARS.map((h, i) => (
            <span
              key={i}
              className="lp-bar"
              style={{ height: h, background: i === BARS.length - 1 ? '#FF6B4A' : '#3F3F46', animationDelay: `${(0.1 * i).toFixed(1)}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function WhyFlashSeat() {
  const reveal = useReveal<HTMLElement>();
  return (
    <section id="organizers" ref={reveal.ref} className={cn('lp-wrap lp-why', reveal.className)} aria-labelledby="why-title">
      <div className="lp-head-title">
        <span className="lp-eyebrow">WHY FLASHSEAT</span>
        <h2 id="why-title" className="lp-h2">
          Booking that feels
          <br />
          <span className="lp-dim">as good as the show.</span>
        </h2>
      </div>
      <div className="lp-bento">
        <SeatIsYours />
        <TicketsInPocket />
        <ForOrganizers />
      </div>
    </section>
  );
}
