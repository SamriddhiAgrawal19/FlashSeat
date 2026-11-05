import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { useReveal } from '../site/hooks';

// Illustrative demo, exactly as in the design: no API calls, no real holds.
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const SEATS = 14;
const MAX = 6;
const INITIAL = ['E7', 'E8'];

const priceFor = (r: number) => (r < 2 ? 899 : r < 5 ? 599 : 399);
const isTaken = (r: number, s: number) => (r === 0 && s > 3 && s < 12) || (r * 5 + s * 3) % 7 === 0;
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** "A3" before "A10", rows in order. */
function bySeat(a: string, b: string): number {
  return a.charAt(0) === b.charAt(0) ? parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10) : a < b ? -1 : 1;
}

export function TryIt() {
  const [selected, setSelected] = useState<string[]>(INITIAL);
  const [note, setNote] = useState(false);
  const reveal = useReveal<HTMLDivElement>();
  const mapRef = useRef<HTMLDivElement>(null);

  // On narrow screens the map scrolls sideways; start it centred on the aisle, like a real seat map.
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.scrollWidth > map.clientWidth) map.scrollLeft = (map.scrollWidth - map.clientWidth) / 2;
  }, []);

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      setSelected(selected.filter((x) => x !== id));
      setNote(false);
      return;
    }
    if (selected.length >= MAX) {
      setNote(true);
      return;
    }
    setSelected([...selected, id]);
    setNote(false);
  };

  const total = selected.reduce((sum, id) => sum + priceFor(ROWS.indexOf(id.charAt(0))), 0);
  const chips = [...selected].sort(bySeat);

  return (
    <section className="lp-try" aria-labelledby="try-title">
      <div ref={reveal.ref} className={cn('lp-wrap lp-try-in', reveal.className)}>
        <div className="lp-try-text">
          <span className="lp-eyebrow">TRY IT</span>
          <h2 id="try-title" className="lp-h2 lp-h2-lg">
            Go on,
            <br />
            <span className="lp-dim">pick a seat.</span>
          </h2>
          <p className="lp-try-lede">
            This is how every show works on FlashSeat. Tap the seats you want, see the price change, and they're kept for you while you
            check out.
          </p>
          <div className="lp-basket">
            <div className="lp-basket-head">
              <span className="lp-eyebrow" style={{ letterSpacing: '0.1em' }}>
                YOUR SEATS · {selected.length}/{MAX}
              </span>
              <span className="lp-total" aria-live="polite">
                {rupees(total)}
              </span>
            </div>
            <div className="lp-chips">
              {chips.map((id) => (
                <span key={id} className="lp-chip">
                  {id}
                </span>
              ))}
              {chips.length === 0 && (
                <span style={{ fontSize: 13, color: 'var(--lp-dim)', alignSelf: 'center' }}>No seats yet. Tap one on the map.</span>
              )}
            </div>
            {note && (
              <span role="status" className="lp-note">
                You can pick up to 6 seats at a time.
              </span>
            )}
            <button
              type="button"
              className="lp-link-btn"
              onClick={() => {
                setSelected([]);
                setNote(false);
              }}
            >
              Clear selection
            </button>
          </div>
        </div>

        <div ref={mapRef} className="lp-map">
          <div className="lp-map-in" role="group" aria-label="Demo seat map">
            <div className="lp-stage" style={{ width: '70%' }} />
            <span className="lp-stage-label" style={{ fontSize: 10, marginBottom: 14 }}>
              STAGE
            </span>
            {ROWS.map((label, r) => (
              <div key={label} className="lp-map-row">
                <span className="lp-map-label">{label}</span>
                {Array.from({ length: SEATS }, (_, i) => i + 1).map((s) => {
                  const id = `${label}${s}`;
                  const on = selected.includes(id);
                  const taken = isTaken(r, s);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={cn('lp-pk', on ? 'lp-pk-s' : taken && 'lp-pk-t')}
                      style={s === 8 ? { marginLeft: 18 } : undefined}
                      aria-label={`Row ${label}, seat ${s}, ₹${priceFor(r)}${on ? ', selected' : taken ? ', taken' : ', available'}`}
                      aria-pressed={on}
                      aria-disabled={taken || undefined}
                      onClick={() => !taken && toggle(id)}
                    />
                  );
                })}
                <span className="lp-map-label" style={{ textAlign: 'right' }}>
                  {label}
                </span>
              </div>
            ))}
            <div className="lp-legend">
              <span>
                <i style={{ border: '1px solid rgba(255,255,255,0.35)' }} />
                Available
              </span>
              <span>
                <i style={{ background: '#FF6B4A' }} />
                Yours
              </span>
              <span>
                <i style={{ background: '#2E2E33' }} />
                Taken
              </span>
              <span className="lp-mono" style={{ color: 'var(--lp-dim)' }}>
                A–B ₹899 · C–E ₹599 · F–H ₹399
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
